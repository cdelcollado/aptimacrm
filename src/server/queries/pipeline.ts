import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { companies, deals, tasks, users } from "@/server/db/schema";
import type { Principal } from "@/server/authz/policy";
import { companyNameVisible } from "@/server/queries/visibility";
import { loadDealRows, loadStages } from "@/server/queries/dashboard";
import { pipelineTotals, type DealRow } from "@/server/domain/metrics";

export interface BoardFilters {
  ownerId?: string | null;
  overdueOnly?: boolean;
  q?: string | null;
}

export interface BoardCard {
  id: string;
  title: string;
  amountCents: number;
  version: number;
  stageId: string;
  ownerName: string;
  ownerId: string;
  companyName: string;
  companyRestricted: boolean;
  nextTaskDueOn: string | null;
  nextTaskOverdue: boolean;
}

/** Pipeline board: open deals grouped by stage, with per-stage totals and card context. */
export async function getBoard(principal: Principal, filters: BoardFilters = {}) {
  const db = getDb();
  const now = new Date();
  const stages = await loadStages();
  const scoped = await loadDealRows(principal, { ownerId: filters.ownerId });

  const ids = scoped.map((d) => d.id);
  const detailRows = ids.length
    ? await db
        .select({
          id: deals.id,
          title: deals.title,
          amountCents: deals.amountCents,
          version: deals.version,
          stageId: deals.stageId,
          status: deals.status,
          ownerId: deals.ownerId,
          ownerName: users.name,
          companyId: companies.id,
          companyName: companies.name,
          companyOwnerId: companies.ownerId,
        })
        .from(deals)
        .innerJoin(users, eq(users.id, deals.ownerId))
        .innerJoin(companies, eq(companies.id, deals.companyId))
        .where(inArray(deals.id, ids))
    : [];

  const nextTasks = ids.length
    ? await db
        .select({ dealId: tasks.dealId, dueOn: tasks.dueOn, dueAt: tasks.dueAt })
        .from(tasks)
        .where(and(inArray(tasks.dealId, ids), eq(tasks.status, "open")))
        .orderBy(asc(tasks.dueAt))
    : [];
  const nextByDeal = new Map<string, { dueOn: string; dueAt: Date }>();
  for (const t of nextTasks) if (t.dealId && !nextByDeal.has(t.dealId)) nextByDeal.set(t.dealId, { dueOn: t.dueOn, dueAt: t.dueAt });

  const q = filters.q?.trim().toLowerCase() ?? "";
  const cards: Array<BoardCard & { status: string }> = detailRows
    .filter((r) => !q || r.title.toLowerCase().includes(q) || r.companyName.toLowerCase().includes(q))
    .map((r) => {
      const next = nextByDeal.get(r.id);
      const overdue = next ? next.dueAt.getTime() < now.getTime() : false;
      const visible = companyNameVisible(principal, r.companyOwnerId);
      return {
        id: r.id,
        title: r.title,
        amountCents: r.amountCents,
        version: r.version,
        stageId: r.stageId,
        status: r.status,
        ownerId: r.ownerId,
        ownerName: r.ownerName,
        companyName: visible ? r.companyName : "[restricted]",
        companyRestricted: !visible,
        nextTaskDueOn: next?.dueOn ?? null,
        nextTaskOverdue: overdue,
      };
    })
    .filter((c) => (filters.overdueOnly ? c.nextTaskOverdue : true));

  const dealRows: DealRow[] = scoped.map((d) => ({
    id: d.id,
    stageId: d.stageId,
    status: d.status as DealRow["status"],
    amountCents: d.amountCents,
    visitedStageIds: [],
  }));
  const totals = pipelineTotals(stages, dealRows);

  return {
    stages: stages.map((s) => ({
      ...s,
      cards: cards.filter((c) => c.stageId === s.id && c.status === "open"),
      total: totals.perStage.find((t) => t.stageId === s.id) ?? { count: 0, valueCents: 0 },
    })),
    openValueCents: totals.openValueCents,
    openCount: totals.openCount,
    closedStages: stages.filter((s) => s.kind !== "open"),
  };
}

export async function ownerOptions(): Promise<Array<{ id: string; name: string }>> {
  return getDb().select({ id: users.id, name: users.name }).from(users).where(eq(users.active, true)).orderBy(users.name);
}


