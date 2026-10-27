import { auditEvents } from "@/server/db/schema";
import type { DbOrTx } from "@/server/db/client";

export interface AuditInput {
  actorId: string | null;
  action: string;
  subjectType: string;
  subjectId: string | null;
  metadata?: Record<string, unknown>;
  requestId?: string | null;
}

/**
 * Append one audit event. Callers pass the transaction handle so the audit row commits or
 * rolls back together with the change it describes. Metadata must hold ids and counts only.
 */
export async function recordAudit(db: DbOrTx, input: AuditInput): Promise<void> {
  await db.insert(auditEvents).values({
    actorId: input.actorId,
    action: input.action,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    metadata: input.metadata ?? {},
    requestId: input.requestId ?? null,
  });
}
