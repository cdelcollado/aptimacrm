import { and, inArray, lt, sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { imports, inboundEmails, jobs, sessions } from "@/server/db/schema";

/**
 * Retention policy (see README). Archived business records are never purged here; activities and
 * audit events are append-only and are never deleted by the application.
 */
export const RETENTION = {
  importRowsDays: 90,
  inboundExcerptDays: 180,
  jobsDays: 30,
} as const;

export async function purgeOldData(now: Date): Promise<{ sessions: number; imports: number; inboundExcerpts: number; jobs: number }> {
  const db = getDb();
  const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);

  const expiredSessions = await db
    .delete(sessions)
    .where(lt(sessions.expiresAt, now))
    .returning({ id: sessions.id });

  // Import rows (which hold personal data) are removed with their import after the retention window.
  const removedImports = await db
    .delete(imports)
    .where(and(inArray(imports.status, ["completed", "failed", "cancelled"]), lt(imports.createdAt, daysAgo(RETENTION.importRowsDays))))
    .returning({ id: imports.id });

  // Keep the hash and metadata for dedupe; drop the message text after the window.
  const excerpts = await db
    .update(inboundEmails)
    .set({ bodyExcerpt: "", subject: "" })
    .where(and(lt(inboundEmails.receivedAt, daysAgo(RETENTION.inboundExcerptDays)), sql`${inboundEmails.bodyExcerpt} <> ''`))
    .returning({ id: inboundEmails.id });

  const finishedJobs = await db
    .delete(jobs)
    .where(and(inArray(jobs.status, ["succeeded", "failed"]), lt(jobs.finishedAt, daysAgo(RETENTION.jobsDays))))
    .returning({ id: jobs.id });


  return {
    sessions: expiredSessions.length,
    imports: removedImports.length,
    inboundExcerpts: excerpts.length,
    jobs: finishedJobs.length,
  };
}
