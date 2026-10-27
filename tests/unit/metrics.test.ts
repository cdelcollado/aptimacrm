import { describe, expect, it } from "vitest";
import { formatEuro, pipelineTotals, safeRate, stageConversion, winRate, type DealRow, type StageRow } from "@/server/domain/metrics";
import { addCalendarDays, localDateOf, taskDueInstant, zonedLocalToInstant, zoneOffsetMinutes } from "@/server/domain/time";

const stages: StageRow[] = [
  { id: "q", name: "Qualificació", position: 0, kind: "open" },
  { id: "p", name: "Proposta", position: 1, kind: "open" },
  { id: "n", name: "Negociació", position: 2, kind: "open" },
  { id: "w", name: "Guanyat", position: 3, kind: "won" },
  { id: "l", name: "Perdut", position: 4, kind: "lost" },
];

const deal = (over: Partial<DealRow> & Pick<DealRow, "id" | "stageId" | "status">): DealRow => ({
  amountCents: 1000,
  visitedStageIds: [],
  ...over,
});

describe("pipelineTotals", () => {
  it("sums only open deals, per stage and in total, in integer cents", () => {
    const deals = [
      deal({ id: "1", stageId: "q", status: "open", amountCents: 12550 }),
      deal({ id: "2", stageId: "p", status: "open", amountCents: 100 }),
      deal({ id: "3", stageId: "w", status: "won", amountCents: 999999 }),
    ];
    const totals = pipelineTotals(stages, deals);
    expect(totals.openValueCents).toBe(12650);
    expect(totals.openCount).toBe(2);
    expect(totals.perStage.find((s) => s.stageId === "q")).toEqual({ stageId: "q", count: 1, valueCents: 12550 });
    expect(totals.perStage.find((s) => s.stageId === "w")).toBeUndefined();
  });
});

describe("stageConversion", () => {
  it("counts a deal as reaching a stage when it is there now or the history says it was", () => {
    const deals = [
      deal({ id: "1", stageId: "p", status: "open", visitedStageIds: ["q", "p"] }),
      deal({ id: "2", stageId: "q", status: "open", visitedStageIds: ["q"] }),
      deal({ id: "3", stageId: "w", status: "won", visitedStageIds: ["q", "p", "n", "w"] }),
      deal({ id: "4", stageId: "l", status: "lost", visitedStageIds: ["q", "p", "l"] }),
    ];
    const rows = stageConversion(stages, deals);
    const qp = rows.find((r) => r.fromStageId === "q" && r.toStageId === "p")!;
    expect(qp).toMatchObject({ reached: 4, converted: 3, rate: 0.75 });
    const pn = rows.find((r) => r.fromStageId === "p" && r.toStageId === "n")!;
    expect(pn).toMatchObject({ reached: 3, converted: 1 });
  });

  it("returns null rates when nothing has reached the stage yet", () => {
    const rows = stageConversion(stages, []);
    expect(rows.every((r) => r.rate === null)).toBe(true);
  });

  it("never includes the lost stage in the sequence", () => {
    const rows = stageConversion(stages, []);
    expect(rows.some((r) => r.toStageId === "l" || r.fromStageId === "l")).toBe(false);
  });
});

describe("winRate", () => {
  it("is won over closed, ignoring open deals", () => {
    const deals = [
      deal({ id: "1", stageId: "w", status: "won" }),
      deal({ id: "2", stageId: "w", status: "won" }),
      deal({ id: "3", stageId: "l", status: "lost" }),
      deal({ id: "4", stageId: "q", status: "open" }),
    ];
    expect(winRate(deals)).toEqual({ won: 2, lost: 1, rate: 0.67 });
  });
  it("is null with no closed deals", () => {
    expect(winRate([deal({ id: "1", stageId: "q", status: "open" })]).rate).toBeNull();
  });
});

describe("safeRate and formatting", () => {
  it("returns null for a zero denominator", () => {
    expect(safeRate(0, 0)).toBeNull();
    expect(safeRate(1, 4)).toBe(0.25);
  });
  it("formats cents as euros in the viewer's locale", () => {
    expect(formatEuro(1250050, "es-ES").replace(/\s/g, " ")).toContain("12.500,50");
  });
});

describe("timezone handling", () => {
  it("converts a Madrid wall-clock time to the correct UTC instant in summer and winter", () => {
    expect(zonedLocalToInstant("2026-07-01T10:00", "Europe/Madrid")?.toISOString()).toBe("2026-07-01T08:00:00.000Z");
    expect(zonedLocalToInstant("2026-01-15T10:00", "Europe/Madrid")?.toISOString()).toBe("2026-01-15T09:00:00.000Z");
  });

  it("reports the offset in force at an instant", () => {
    expect(zoneOffsetMinutes(new Date("2026-07-01T00:00:00Z"), "Europe/Madrid")).toBe(120);
    expect(zoneOffsetMinutes(new Date("2026-01-01T00:00:00Z"), "Europe/Madrid")).toBe(60);
  });

  it("rejects malformed local times", () => {
    expect(zonedLocalToInstant("tomorrow", "Europe/Madrid")).toBeNull();
  });

  it("makes a task due on a day overdue only after that local day has ended", () => {
    const due = taskDueInstant("2026-10-24", "Europe/Madrid")!;
    expect(due.toISOString()).toBe("2026-10-24T22:00:00.000Z");
  });

  it("adds calendar days without timezone drift", () => {
    expect(addCalendarDays("2026-02-27", 2)).toBe("2026-03-01");
  });

  it("gives the local calendar date of an instant", () => {
    expect(localDateOf(new Date("2026-10-24T23:30:00Z"), "Europe/Madrid")).toBe("2026-10-25");
  });
});
