/**
 * Pure metric math. The queries feed plain rows in; these functions return numbers or null
 * when a rate has no denominator. Null is shown as "—" in the UI, never as 0%.
 */

export type StageKind = "open" | "won" | "lost";

export interface StageRow {
  id: string;
  name: string;
  position: number;
  kind: StageKind;
}

export interface DealRow {
  id: string;
  stageId: string;
  status: StageKind;
  amountCents: number;
  /** Every stage id the deal has been in (from the activity history), including the current one. */
  visitedStageIds: string[];
}

export interface StageTotal {
  stageId: string;
  count: number;
  valueCents: number;
}

/** Sum of open deal values per stage and in total. Lost and won deals are excluded. */
export function pipelineTotals(stages: StageRow[], deals: DealRow[]): { perStage: StageTotal[]; openValueCents: number; openCount: number } {
  const perStage: StageTotal[] = stages
    .filter((s) => s.kind === "open")
    .sort((a, b) => a.position - b.position)
    .map((s) => ({ stageId: s.id, count: 0, valueCents: 0 }));
  let openValueCents = 0;
  let openCount = 0;
  for (const deal of deals) {
    if (deal.status !== "open") continue;
    openCount += 1;
    openValueCents += deal.amountCents;
    const bucket = perStage.find((b) => b.stageId === deal.stageId);
    if (bucket) {
      bucket.count += 1;
      bucket.valueCents += deal.amountCents;
    }
  }
  return { perStage, openValueCents, openCount };
}

/**
 * Stage conversion between consecutive non-lost stages: of the deals that ever reached stage i,
 * the share that also ever reached the next stage. Lost deals count toward the stages they reached.
 */
export function stageConversion(stages: StageRow[], deals: DealRow[]): Array<{ fromStageId: string; toStageId: string; reached: number; converted: number; rate: number | null }> {
  const ordered = stages.filter((s) => s.kind !== "lost").sort((a, b) => a.position - b.position);
  const result: Array<{ fromStageId: string; toStageId: string; reached: number; converted: number; rate: number | null }> = [];
  for (let i = 0; i < ordered.length - 1; i++) {
    const from = ordered[i]!;
    const to = ordered[i + 1]!;
    const reached = deals.filter((d) => d.stageId === from.id || d.visitedStageIds.includes(from.id));
    const converted = reached.filter((d) => d.stageId === to.id || d.visitedStageIds.includes(to.id)).length;
    result.push({
      fromStageId: from.id,
      toStageId: to.id,
      reached: reached.length,
      converted,
      rate: safeRate(converted, reached.length),
    });
  }
  return result;
}

/** Won / (won + lost) over closed deals. Null when nothing has closed yet. */
export function winRate(deals: DealRow[]): { won: number; lost: number; rate: number | null } {
  const won = deals.filter((d) => d.status === "won").length;
  const lost = deals.filter((d) => d.status === "lost").length;
  return { won, lost, rate: safeRate(won, won + lost) };
}

/** Ratio in [0, 1] with two-decimal rounding, or null for an empty denominator. */
export function safeRate(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 100) / 100;
}

/** Format cents as EUR for display in the given locale. */
export function formatEuro(cents: number, locale: string): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(cents / 100);
}

export function formatPercent(rate: number | null, locale: string): string {
  if (rate === null) return "—";
  return new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 }).format(rate);
}
