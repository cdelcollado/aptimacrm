import { canReopen, type Principal } from "@/server/authz/policy";

/**
 * Pure transition rules for a deal's stage. No I/O: the transaction service loads the rows,
 * calls decideStageMove, then applies the result inside the same transaction.
 */

export type StageKind = "open" | "won" | "lost";

export interface StageRef {
  id: string;
  kind: StageKind;
}

export type StageMoveDecision =
  | { kind: "noop" }
  | { kind: "move"; reopen: boolean; newStatus: StageKind; closeNow: boolean }
  | { kind: "reject"; code: "forbidden" | "reason_required"; message: string };

export function decideStageMove(input: {
  from: StageRef;
  to: StageRef;
  principal: Principal;
  reason: string | null;
}): StageMoveDecision {
  const { from, to, principal, reason } = input;

  if (from.id === to.id) return { kind: "noop" };

  const reopen = from.kind !== "open";
  if (reopen) {
    if (!canReopen(principal)) {
      return { kind: "reject", code: "forbidden", message: "Only managers can reopen a closed deal" };
    }
    if (!reason || reason.trim().length < 3) {
      return { kind: "reject", code: "reason_required", message: "A reason of at least 3 characters is required to reopen" };
    }
  }

  return {
    kind: "move",
    reopen,
    newStatus: to.kind,
    closeNow: to.kind !== "open",
  };
}

/** Whether a stage kind counts toward the win-rate denominator. */
export function isClosedKind(kind: StageKind): boolean {
  return kind === "won" || kind === "lost";
}
