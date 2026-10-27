import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { jobs } from "@/server/db/schema";
import { claimNextJob, enqueueJob, jobCounts, markFailed, backoffMs } from "@/server/jobs/queue";
import { drainJobs } from "@/server/jobs/worker";
import { handlers } from "@/server/jobs/handlers";
import type { JobKind } from "@/server/jobs/queue";

describe("job queue", () => {
  it("enqueues once per idempotency key", async () => {
    const a = await enqueueJob(getDb(), { kind: "maintenance.purge", payload: {}, idempotencyKey: "k-1" });
    const b = await enqueueJob(getDb(), { kind: "maintenance.purge", payload: {}, idempotencyKey: "k-1" });
    expect(a.created).toBe(true);
    expect(b).toMatchObject({ created: false, id: a.id });
    expect(await getDb().select().from(jobs)).toHaveLength(1);
  });

  it("leases a job so a second claim does not take it", async () => {
    await enqueueJob(getDb(), { kind: "maintenance.purge", payload: {}, idempotencyKey: "lease" });
    const first = await claimNextJob();
    const second = await claimNextJob();
    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(first!.attempts).toBe(1);
  });

  it("reclaims a job whose lease expired (worker crashed)", async () => {
    await enqueueJob(getDb(), { kind: "maintenance.purge", payload: {}, idempotencyKey: "crash" });
    const claimed = await claimNextJob(new Date(Date.now()));
    expect(claimed).not.toBeNull();
    const later = new Date(Date.now() + 10 * 60_000);
    const reclaimed = await claimNextJob(later);
    expect(reclaimed?.id).toBe(claimed!.id);
    expect(reclaimed!.attempts).toBe(2);
  });

  it("marks a failing job as retrying with backoff, then failed after max attempts", async () => {
    const { id } = await enqueueJob(getDb(), { kind: "maintenance.purge", payload: {}, idempotencyKey: "fail", maxAttempts: 2 });
    const t0 = new Date();
    const job1 = await claimNextJob(t0);
    expect(await markFailed({ id: job1!.id, attempts: job1!.attempts, maxAttempts: job1!.maxAttempts }, "boom", t0)).toBe("retrying");
    const [pending] = await getDb().select().from(jobs).where(eq(jobs.id, id));
    expect(pending).toMatchObject({ status: "pending", attempts: 1 });
    expect(pending!.runAfter.getTime() - t0.getTime()).toBe(backoffMs(1));

    const t1 = new Date(t0.getTime() + backoffMs(1) + 1);
    const job2 = await claimNextJob(t1);
    expect(await markFailed({ id: job2!.id, attempts: job2!.attempts, maxAttempts: job2!.maxAttempts }, "boom again", t1)).toBe("failed");
    const counts = await jobCounts(t1);
    expect(counts.failed24h).toBe(1);
  });

  it("drains a job that succeeds and records the outcome", async () => {
    await enqueueJob(getDb(), { kind: "maintenance.purge", payload: {}, idempotencyKey: "ok" });
    const result = await drainJobs(10);
    expect(result).toMatchObject({ processed: 1, succeeded: 1 });
    const [row] = await getDb().select().from(jobs).where(eq(jobs.idempotencyKey, "ok"));
    expect(row).toMatchObject({ status: "succeeded" });
    expect(row!.finishedAt).toBeInstanceOf(Date);
  });

  it("does not swallow handler errors: the job shows the error and the retry state", async () => {
    const kind: JobKind = "import.cleanup_file";
    const original = handlers[kind];
    handlers[kind] = async () => {
      throw new Error("storage unreachable");
    };
    try {
      await enqueueJob(getDb(), { kind, payload: { importId: "00000000-0000-0000-0000-000000000000" }, idempotencyKey: "err", maxAttempts: 3 });
      const result = await drainJobs(10);
      expect(result).toMatchObject({ processed: 1, retrying: 1 });
      const [row] = await getDb().select().from(jobs).where(eq(jobs.idempotencyKey, "err"));
      expect(row).toMatchObject({ status: "pending", attempts: 1, lastError: "storage unreachable" });
    } finally {
      handlers[kind] = original;
    }
  });
});
