import { and, eq, sql } from "drizzle-orm";
import { withTx } from "@/server/db/client";
import { activities, deals, pipelineStages } from "@/server/db/schema";
import { canMutate, type Principal } from "@/server/authz/policy";
import { conflict, DomainError, notFound, ValidationError } from "@/server/errors";
import { recordAudit } from "@/server/domain/audit";
import { decideStageMove, type StageKind } from "@/server/domain/deals/stage-rules";
import { cleanText } from "@/server/security/guards";
import { logger } from "@/server/log/logger";

export interface MoveDealInput {
  dealId: string;
  toStageId: string;
  expectedVersion: number;
  principal: Principal;
  reason?: string | null;
  requestId?: string | null;
  /** Test seam: lets an integration test fail the transaction after the deal row changes. */
  afterDealUpdate?: () => void | Promise<void>;
}

export interface MoveDealResult {
  changed: boolean;
  dealId: string;
  fromStageName: string | null;
  toStageName: string;
  version: number;
}

/**
 * The only place a deal changes stage. One transaction: lock the deal row, check visibility,
 * optimistic version, decide, update the deal, append the stage_change activity and the audit
 * event. Any failure rolls all of it back, so board, detail and totals can never disagree.
 */
export async function moveDealStage(input: MoveDealInput): Promise<MoveDealResult> {
  const reason = cleanText(input.reason ?? null, 500);

  try {
    return await withTx(async (tx) => {
      const [deal] = await tx.select().from(deals).where(eq(deals.id, input.dealId)).for("update").limit(1);
      // A deal the principal cannot mutate is reported as not found, not forbidden.
      if (!deal || !canMutate(input.principal, deal)) throw notFound("Deal");

      if (deal.version !== input.expectedVersion) {
        throw conflict(`Deal changed by someone else (version ${deal.version}, expected ${input.expectedVersion})`);
      }

      const [from] = await tx.select().from(pipelineStages).where(eq(pipelineStages.id, deal.stageId)).limit(1);
      const [to] = await tx.select().from(pipelineStages).where(eq(pipelineStages.id, input.toStageId)).limit(1);
      if (!from || !to) throw new ValidationError({ toStageId: "unknown_stage" }, "Unknown pipeline stage");

      const decision = decideStageMove({
        from: { id: from.id, kind: from.kind as StageKind },
        to: { id: to.id, kind: to.kind as StageKind },
        principal: input.principal,
        reason,
      });

      if (decision.kind === "reject") {
        if (decision.code === "reason_required") {
          throw new ValidationError({ reason: "required" }, decision.message);
        }
        throw new DomainError("forbidden", decision.message);
      }

      if (decision.kind === "noop") {
        return { changed: false, dealId: deal.id, fromStageName: from.name, toStageName: to.name, version: deal.version };
      }

      const now = new Date();
      const [updated] = await tx
        .update(deals)
        .set({
          stageId: to.id,
          status: decision.newStatus,
          closedAt: decision.closeNow ? now : null,
          stageEnteredAt: now,
          version: sql`${deals.version} + 1`,
          updatedAt: now,
        })
        .where(and(eq(deals.id, deal.id), eq(deals.version, input.expectedVersion)))
        .returning({ version: deals.version });

      if (!updated) throw conflict("Deal changed while the move was in progress");

      await input.afterDealUpdate?.();

      await tx.insert(activities).values({
        kind: "stage_change",
        source: "manual",
        dealId: deal.id,
        companyId: deal.companyId,
        actorId: input.principal.userId,
        body: reason ?? "",
        occurredAt: now,
        fromStageId: from.id,
        toStageId: to.id,
        metadata: { reopen: decision.reopen },
      });

      await recordAudit(tx, {
        actorId: input.principal.userId,
        action: "stage.changed",
        subjectType: "deal",
        subjectId: deal.id,
        metadata: { fromStageId: from.id, toStageId: to.id, reopen: decision.reopen },
        requestId: input.requestId ?? null,
      });

      return {
        changed: true,
        dealId: deal.id,
        fromStageName: from.name,
        toStageName: to.name,
        version: updated.version,
      };
    });
  } catch (err) {
    if (!(err instanceof DomainError)) {
      logger.error("deal.stage_move_failed", {
        dealId: input.dealId,
        requestId: input.requestId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
    throw err;
  }
}
