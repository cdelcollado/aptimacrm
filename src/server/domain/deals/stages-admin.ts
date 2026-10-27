import { asc, eq, sql } from "drizzle-orm";
import { withTx } from "@/server/db/client";
import { deals, pipelineStages } from "@/server/db/schema";
import { canManageStages, type Principal } from "@/server/authz/policy";
import { conflict, forbidden, notFound, ValidationError } from "@/server/errors";
import { recordAudit } from "@/server/domain/audit";
import { cleanText } from "@/server/security/guards";

export const STAGE_KINDS = ["open", "won", "lost"] as const;
type StageKind = (typeof STAGE_KINDS)[number];

export interface StageEdit {
  id: string;
  name: string;
  kind: string;
}

/**
 * Stage configuration. Names and kinds are editable, order is editable, deletion is refused while a
 * stage holds deals. Changing a stage's kind is refused while deals sit in it, because the deal
 * status trigger only checks deals, not stage rows.
 */
export async function saveStages(principal: Principal, edits: StageEdit[], requestId?: string | null): Promise<void> {
  if (!canManageStages(principal)) throw forbidden();
  const cleaned = edits.map((e) => {
    const name = cleanText(e.name, 60);
    if (!name) throw new ValidationError({ [`name:${e.id}`]: "required" });
    if (!(STAGE_KINDS as readonly string[]).includes(e.kind)) throw new ValidationError({ [`kind:${e.id}`]: "invalid" });
    return { id: e.id, name, kind: e.kind as StageKind };
  });
  if (cleaned.length === 0) throw new ValidationError({ stages: "empty" });

  await withTx(async (tx) => {
    const current = await tx.select().from(pipelineStages).orderBy(asc(pipelineStages.position)).for("update");
    const byId = new Map(current.map((s) => [s.id, s]));
    for (const e of cleaned) {
      const row = byId.get(e.id);
      if (!row) throw notFound("Stage");
      if (row.kind !== e.kind) {
        const [inUse] = await tx.select({ id: deals.id }).from(deals).where(eq(deals.stageId, row.id)).limit(1);
        if (inUse) throw new ValidationError({ [`kind:${e.id}`]: "in_use" }, "A stage with deals cannot change its type");
      }
    }
    for (const e of cleaned) {
      await tx.update(pipelineStages).set({ name: e.name, kind: e.kind }).where(eq(pipelineStages.id, e.id));
    }
    await recordAudit(tx, {
      actorId: principal.userId,
      action: "stage.configured",
      subjectType: "pipeline_stage",
      subjectId: null,
      metadata: { count: cleaned.length },
      requestId: requestId ?? null,
    });
  });
}

/** Reorder by moving one stage up or down. Uses a deferred unique check inside one transaction. */
export async function moveStage(principal: Principal, stageId: string, direction: "up" | "down", requestId?: string | null): Promise<void> {
  if (!canManageStages(principal)) throw forbidden();
  await withTx(async (tx) => {
    await tx.execute(sql`set constraints pipeline_stages_position_key deferred`);
    const stages = await tx.select().from(pipelineStages).orderBy(asc(pipelineStages.position)).for("update");
    const idx = stages.findIndex((s) => s.id === stageId);
    if (idx < 0) throw notFound("Stage");
    const swapWith = direction === "up" ? idx - 1 : idx + 1;
    const other = stages[swapWith];
    if (!other) return;
    const a = stages[idx]!;
    await tx.update(pipelineStages).set({ position: -1 }).where(eq(pipelineStages.id, a.id));
    await tx.update(pipelineStages).set({ position: a.position }).where(eq(pipelineStages.id, other.id));
    await tx.update(pipelineStages).set({ position: other.position }).where(eq(pipelineStages.id, a.id));
    await recordAudit(tx, { actorId: principal.userId, action: "stage.reordered", subjectType: "pipeline_stage", subjectId: a.id, metadata: { direction }, requestId: requestId ?? null });
  });
}

export async function addStage(principal: Principal, input: { name: string; kind: string }, requestId?: string | null): Promise<void> {
  if (!canManageStages(principal)) throw forbidden();
  const name = cleanText(input.name, 60);
  if (!name) throw new ValidationError({ name: "required" });
  if (!(STAGE_KINDS as readonly string[]).includes(input.kind)) throw new ValidationError({ kind: "invalid" });
  await withTx(async (tx) => {
    const [max] = await tx.select({ m: sql<number>`coalesce(max(${pipelineStages.position}), 0)::int` }).from(pipelineStages);
    const [row] = await tx.insert(pipelineStages).values({ name, kind: input.kind, position: (max?.m ?? 0) + 1 }).returning({ id: pipelineStages.id });
    await recordAudit(tx, { actorId: principal.userId, action: "stage.created", subjectType: "pipeline_stage", subjectId: row!.id, requestId: requestId ?? null });
  });
}

export async function deleteStage(principal: Principal, stageId: string, requestId?: string | null): Promise<void> {
  if (!canManageStages(principal)) throw forbidden();
  await withTx(async (tx) => {
    const [inUse] = await tx.select({ id: deals.id }).from(deals).where(eq(deals.stageId, stageId)).limit(1);
    if (inUse) throw conflict("This stage holds deals and cannot be deleted");
    const [count] = await tx.select({ n: sql<number>`count(*)::int` }).from(pipelineStages);
    if ((count?.n ?? 0) <= 1) throw new ValidationError({ stage: "last" }, "The pipeline needs at least one stage");
    await tx.delete(pipelineStages).where(eq(pipelineStages.id, stageId));
    await recordAudit(tx, { actorId: principal.userId, action: "stage.deleted", subjectType: "pipeline_stage", subjectId: stageId, requestId: requestId ?? null });
  });
}


