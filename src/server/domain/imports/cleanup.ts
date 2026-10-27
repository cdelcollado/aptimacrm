import { eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { getStorage } from "@/server/adapters/storage";
import { imports } from "@/server/db/schema";
import { importObjectKey } from "@/server/domain/imports/keys";
import { logger } from "@/server/log/logger";

/**
 * Deletes the staged CSV once an import is completed or cancelled. Idempotent: deleting a
 * missing object is success, and `file_key` is cleared only after the delete succeeds, so a
 * retry after a crash converges.
 */
export async function cleanupImportFile(importId: string, requestId: string): Promise<void> {
  const db = getDb();
  const [imp] = await db.select().from(imports).where(eq(imports.id, importId)).limit(1);
  if (!imp || imp.fileKey === null) return;
  if (imp.status !== "completed" && imp.status !== "cancelled" && imp.status !== "failed") {
    logger.info("import.cleanup_skipped", { importId, status: imp.status, requestId });
    return;
  }
  const result = await getStorage().delete(importObjectKey(importId));
  if (!result.ok) throw new Error(`storage delete failed: ${result.error.code}`);
  await db.update(imports).set({ fileKey: null }).where(eq(imports.id, importId));
  logger.info("import.file_deleted", { importId, requestId });
}
