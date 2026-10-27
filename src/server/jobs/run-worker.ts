import { getConfig } from "@/server/config";
import { logger } from "@/server/log/logger";
import { drainJobs } from "@/server/jobs/worker";
import { enqueueJob } from "@/server/jobs/queue";
import { getDb } from "@/server/db/client";

/**
 * `npm run worker`: long-running process. Polls the job table, runs what is due, and
 * schedules the daily retention purge (idempotent per day).
 */
const POLL_MS = Number(process.env.WORKER_POLL_MS ?? 2000);
let stopping = false;

process.on("SIGINT", () => (stopping = true));
process.on("SIGTERM", () => (stopping = true));

async function scheduleDailyPurge(): Promise<void> {
  const day = new Date().toISOString().slice(0, 10);
  await enqueueJob(getDb(), { kind: "maintenance.purge", payload: {}, idempotencyKey: `maintenance.purge:${day}` });
}

async function main() {
  getConfig();
  logger.info("worker.started", { pollMs: POLL_MS });
  let lastPurgeCheck = 0;
  while (!stopping) {
    if (Date.now() - lastPurgeCheck > 60 * 60_000) {
      lastPurgeCheck = Date.now();
      await scheduleDailyPurge().catch((err) => logger.error("worker.schedule_failed", { error: String(err) }));
    }
    const result = await drainJobs(50).catch((err) => {
      logger.error("worker.drain_failed", { error: err instanceof Error ? err.message : String(err) });
      return null;
    });
    if (!result || result.processed === 0) await new Promise((r) => setTimeout(r, POLL_MS));
  }
  logger.info("worker.stopped", {});
  process.exit(0);
}

main();
