import { logger, newRequestId } from "@/server/log/logger";
import { backoffMs, claimNextJob, markFailed, markSucceeded, type ClaimedJob } from "@/server/jobs/queue";
import { handlers, type JobContext } from "@/server/jobs/handlers";

export interface DrainResult {
  processed: number;
  succeeded: number;
  retrying: number;
  failed: number;
}

/** Run one claimed job and record its outcome. Errors are logged with the job id, never swallowed. */
export async function runOne(job: ClaimedJob, now = new Date()): Promise<"succeeded" | "retrying" | "failed"> {
  const correlation = job.requestId ?? newRequestId();
  const ctx: JobContext = { jobId: job.id, requestId: correlation, attempt: job.attempts };
  const handler = handlers[job.kind];
  if (!handler) {
    await markFailed(job, `no handler for ${job.kind}`, now);
    logger.error("job.no_handler", { jobId: job.id, kind: job.kind, requestId: correlation });
    return "failed";
  }
  try {
    await handler(job.payload, ctx);
    await markSucceeded(job.id, now);
    logger.info("job.succeeded", { jobId: job.id, kind: job.kind, attempt: job.attempts, requestId: correlation });
    return "succeeded";
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const outcome = await markFailed(job, message, now);
    logger.warn("job.attempt_failed", {
      jobId: job.id,
      kind: job.kind,
      attempt: job.attempts,
      maxAttempts: job.maxAttempts,
      outcome,
      nextDelayMs: outcome === "retrying" ? backoffMs(job.attempts) : undefined,
      error: message,
      requestId: correlation,
    });
    return outcome === "retrying" ? "retrying" : "failed";
  }
}

/** Process up to `limit` runnable jobs and return. Used by tests and by the long-running worker. */
export async function drainJobs(limit = 100, now = new Date()): Promise<DrainResult> {
  const result: DrainResult = { processed: 0, succeeded: 0, retrying: 0, failed: 0 };
  for (let i = 0; i < limit; i++) {
    const job = await claimNextJob(now);
    if (!job) break;
    const outcome = await runOne(job, now);
    result.processed += 1;
    result[outcome === "succeeded" ? "succeeded" : outcome === "retrying" ? "retrying" : "failed"] += 1;
  }
  return result;
}
