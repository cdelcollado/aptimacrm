import { eq, sql } from "drizzle-orm";
import { getDb, type DbOrTx } from "@/server/db/client";
import { jobs } from "@/server/db/schema";

/**
 * Postgres-backed job queue. Claims use FOR UPDATE SKIP LOCKED so several workers can run.
 * A job is `pending` while waiting (including after a failed attempt: that is "retrying"
 * when attempts > 0), `running` while leased, then `succeeded` or `failed` (terminal).
 */

export const LEASE_MS = 2 * 60 * 1000;

export type JobKind = "import.parse" | "import.cleanup_file" | "maintenance.purge";

export interface EnqueueInput {
  kind: JobKind;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  maxAttempts?: number;
  requestId?: string | null;
}

/** Enqueue once per idempotency key. A repeat enqueue is a no-op that returns the existing id. */
export async function enqueueJob(db: DbOrTx, input: EnqueueInput): Promise<{ id: string; created: boolean }> {
  const inserted = await db
    .insert(jobs)
    .values({
      kind: input.kind,
      payload: input.payload,
      idempotencyKey: input.idempotencyKey,
      maxAttempts: input.maxAttempts ?? 5,
      requestId: input.requestId ?? null,
      // Same clock and precision as the claim query. A DB default (microseconds) can sit just
      // after a millisecond-precision JS timestamp and be missed by the same-millisecond claim.
      runAfter: new Date(),
    })
    .onConflictDoNothing({ target: jobs.idempotencyKey })
    .returning({ id: jobs.id });
  if (inserted[0]) return { id: inserted[0].id, created: true };
  const [existing] = await db.select({ id: jobs.id }).from(jobs).where(eq(jobs.idempotencyKey, input.idempotencyKey)).limit(1);
  return { id: existing!.id, created: false };
}

export interface ClaimedJob {
  id: string;
  kind: JobKind;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
  requestId: string | null;
}

/** Lease the oldest runnable job. Expired leases count as runnable (the worker crashed). */
export async function claimNextJob(now = new Date()): Promise<ClaimedJob | null> {
  const db = getDb();
  const rows = await db.execute<{
    id: string;
    kind: JobKind;
    payload: Record<string, unknown>;
    attempts: number;
    max_attempts: number;
    request_id: string | null;
  }>(sql`
    update jobs set
      status = 'running',
      attempts = attempts + 1,
      locked_until = ${new Date(now.getTime() + LEASE_MS)}
    where id = (
      select id from jobs
      where (status = 'pending' and run_after <= ${now})
         or (status = 'running' and locked_until < ${now})
      order by run_after asc
      limit 1
      for update skip locked
    )
    returning id, kind, payload, attempts, max_attempts, request_id
  `);
  const row = rows.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    kind: row.kind,
    payload: row.payload,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    requestId: row.request_id,
  };
}

export async function markSucceeded(jobId: string, now = new Date()): Promise<void> {
  await getDb()
    .update(jobs)
    .set({ status: "succeeded", finishedAt: now, lockedUntil: null, lastError: null })
    .where(eq(jobs.id, jobId));
}

/**
 * Exponential backoff: 5 s, 10 s, 20 s, ... capped at 10 min. After maxAttempts the job is
 * `failed` and stays visible in /api/health and the import screen.
 */
export function backoffMs(attempt: number): number {
  return Math.min(5_000 * 2 ** Math.max(0, attempt - 1), 10 * 60_000);
}

export async function markFailed(job: Pick<ClaimedJob, "id" | "attempts" | "maxAttempts">, message: string, now = new Date()): Promise<"retrying" | "failed"> {
  const exhausted = job.attempts >= job.maxAttempts;
  await getDb()
    .update(jobs)
    .set({
      status: exhausted ? "failed" : "pending",
      runAfter: exhausted ? now : new Date(now.getTime() + backoffMs(job.attempts)),
      lockedUntil: null,
      lastError: message.slice(0, 500),
      finishedAt: exhausted ? now : null,
    })
    .where(eq(jobs.id, job.id));
  return exhausted ? "failed" : "retrying";
}

export async function jobCounts(now = new Date()): Promise<{ pending: number; retrying: number; running: number; failed24h: number }> {
  const db = getDb();
  const [row] = await db.execute<{ pending: number; retrying: number; running: number; failed24h: number }>(sql`
    select
      count(*) filter (where status = 'pending' and attempts = 0)::int as pending,
      count(*) filter (where status = 'pending' and attempts > 0)::int as retrying,
      count(*) filter (where status = 'running')::int as running,
      count(*) filter (where status = 'failed' and finished_at > ${new Date(now.getTime() - 24 * 3600_000)})::int as "failed24h"
    from jobs
  `).then((r) => r.rows);
  return row ?? { pending: 0, retrying: 0, running: 0, failed24h: 0 };
}


