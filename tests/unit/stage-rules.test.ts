import { describe, expect, it } from "vitest";
import { decideStageMove } from "@/server/domain/deals/stage-rules";
import type { Principal } from "@/server/authz/policy";

const who = (role: Principal["role"]): Principal => ({ userId: "u-" + role, name: role, role, locale: "es" });
const open = { id: "s-open", kind: "open" as const };
const open2 = { id: "s-open2", kind: "open" as const };
const won = { id: "s-won", kind: "won" as const };
const lost = { id: "s-lost", kind: "lost" as const };

describe("decideStageMove", () => {
  it("is a no-op when the target is the current stage", () => {
    expect(decideStageMove({ from: open, to: open, principal: who("salesperson"), reason: null })).toEqual({ kind: "noop" });
  });

  it("moves between open stages without a reason", () => {
    expect(decideStageMove({ from: open, to: open2, principal: who("salesperson"), reason: null })).toEqual({
      kind: "move",
      reopen: false,
      newStatus: "open",
      closeNow: false,
    });
  });

  it("closes a deal when it moves into won or lost", () => {
    expect(decideStageMove({ from: open, to: won, principal: who("salesperson"), reason: null })).toMatchObject({ newStatus: "won", closeNow: true });
    expect(decideStageMove({ from: open, to: lost, principal: who("salesperson"), reason: null })).toMatchObject({ newStatus: "lost", closeNow: true });
  });

  it("refuses to reopen a closed deal for a salesperson", () => {
    expect(decideStageMove({ from: won, to: open, principal: who("salesperson"), reason: "motiu vàlid" })).toMatchObject({ kind: "reject", code: "forbidden" });
  });

  it("requires a reason of at least three characters to reopen", () => {
    expect(decideStageMove({ from: won, to: open, principal: who("manager"), reason: null })).toMatchObject({ kind: "reject", code: "reason_required" });
    expect(decideStageMove({ from: won, to: open, principal: who("manager"), reason: "ok" })).toMatchObject({ kind: "reject", code: "reason_required" });
  });

  it("lets a manager reopen with a reason and marks it as a reopen", () => {
    expect(decideStageMove({ from: lost, to: open, principal: who("manager"), reason: "El client ha tornat" })).toEqual({
      kind: "move",
      reopen: true,
      newStatus: "open",
      closeNow: false,
    });
  });

  it("lets an admin reopen as well", () => {
    expect(decideStageMove({ from: won, to: open, principal: who("admin"), reason: "Error de l'equip" })).toMatchObject({ kind: "move", reopen: true });
  });
});
