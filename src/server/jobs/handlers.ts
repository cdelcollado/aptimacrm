import { logger } from "@/server/log/logger";
import { parseImportJob } from "@/server/domain/imports/parse-job";
import { cleanupImportFile } from "@/server/domain/imports/cleanup";
import { purgeOldData } from "@/server/domain/retention";
import type { JobKind } from "@/server/jobs/queue";

export interface JobContext {
  jobId: string;
  requestId: string;
  attempt: number;
}

export type JobHandler = (payload: Record<string, unknown>, ctx: JobContext) => Promise<void>;

/**
 * Handlers must be re-entrant: a retry after a partial failure has to converge to the same
 * end state. Each one checks its own terminal state before doing side effects.
 */
export const handlers: Partial<Record<JobKind, JobHandler>> = {
  "import.parse": async (payload, ctx) => {
    await parseImportJob(String(payload.importId), ctx.requestId);
  },
  "import.cleanup_file": async (payload, ctx) => {
    await cleanupImportFile(String(payload.importId), ctx.requestId);
  },
  "maintenance.purge": async (_payload, ctx) => {
    const counts = await purgeOldData(new Date());
    logger.info("retention.purged", { ...counts, requestId: ctx.requestId });
  },
};
