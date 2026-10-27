import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { getStorage } from "@/server/adapters/storage";
import { jobCounts } from "@/server/jobs/queue";
import { newRequestId, logger } from "@/server/log/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Diagnostic endpoint: database latency, storage reachability, job backlog. No secrets, no PII. */
export async function GET() {
  const requestId = newRequestId();
  const started = Date.now();
  let db: { ok: boolean; latencyMs?: number; error?: string } = { ok: false };
  try {
    await getDb().execute(sql`select 1`);
    db = { ok: true, latencyMs: Date.now() - started };
  } catch (err) {
    db = { ok: false, error: err instanceof Error ? err.message.slice(0, 120) : "unknown" };
  }

  const storage = await getStorage().ping();
  const jobs = db.ok ? await jobCounts() : null;
  const healthy = db.ok && storage.ok;
  if (!healthy) logger.warn("health.degraded", { db: db.ok, storage: storage.ok, requestId });

  return NextResponse.json(
    {
      status: healthy ? "ok" : "degraded",
      checks: {
        database: db,
        storage: storage.ok ? { ok: true, latencyMs: storage.value.latencyMs } : { ok: false, code: storage.error.code },
      },
      jobs,
      requestId,
    },
    { status: db.ok ? 200 : 503, headers: { "cache-control": "no-store", "x-request-id": requestId } },
  );
}
