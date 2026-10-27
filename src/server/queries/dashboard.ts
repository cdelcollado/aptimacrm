import { and, desc, eq, isNull, lt, sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { activities, contacts, deals, imports, pipelineStages, tasks, users } from "@/server/db/schema";
import { isManagerOrAdmin, type Principal } from "@/server/authz/policy";
import { activityVisibility, dealVisibility, taskVisibility } from "@/server/queries/visibility";
import { pipelineTotals, stageConversion, winRate, type DealRow, type StageRow } from "@/server/domain/metrics";

export interface DashboardFilters {
  ownerId?: string | null;
}

/** Shared deal snapshot for dashboard, board and exports: visible, not archived, with stage history. */
export async function loadDealRows(principal: Principal, filters: { ownerId?: string | null } = {}) {
  const ownerClause = filters.ownerId ? sql`${deals.ownerId} = ${filters.ownerId}` : sql`true`;
  return getDb()
    .select({
      id: deals.id,
      title: deals.title,
      stageId: deals.stageId,
      status: deals.status,
      amountCents: deals.amountCents,
      ownerId: deals.ownerId,
      companyId: deals.companyId,
      visited: sql<string[]>`coalesce((
        select array_agg(distinct a.to_stage_id::text)
        from activities a
        where a.deal_id = ${deals.id} and a.to_stage_id is not null
      ), '{}')`,
    })
    .from(deals)
    .where(and(isNull(deals.archivedAt), dealVisibility(principal), ownerClause));
}

export async function loadStages(): Promise<StageRow[]> {
  const rows = await getDb().select().from(pipelineStages).orderBy(pipelineStages.position);
  return rows.map((r) => ({ id: r.id, name: r.name, position: r.position, kind: r.kind as StageRow["kind"] }));
}

export async function getDashboard(principal: Principal, filters: DashboardFilters = {}) {
  const db = getDb();
  const now = new Date();
  const stages = await loadStages();
  const rows = await loadDealRows(principal, filters);
  const dealRows: DealRow[] = rows.map((r) => ({
    id: r.id,
    stageId: r.stageId,
    status: r.status as DealRow["status"],
    amountCents: r.amountCents,
    visitedStageIds: parseUuidArray(r.visited),
  }));

  const [overdue] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(tasks)
    .where(and(eq(tasks.status, "open"), lt(tasks.dueAt, now), taskVisibility(principal), ownerFilter(tasks.ownerId, filters.ownerId)));

  const recent = await db
    .select({
      id: activities.id,
      kind: activities.kind,
      body: activities.body,
      occurredAt: activities.occurredAt,
      dealId: activities.dealId,
      dealTitle: deals.title,
      contactFirst: contacts.firstName,
      contactLast: contacts.lastName,
      actorName: users.name,
    })
    .from(activities)
    .leftJoin(deals, eq(deals.id, activities.dealId))
    .leftJoin(contacts, eq(contacts.id, activities.contactId))
    .leftJoin(users, eq(users.id, activities.actorId))
    .where(activityVisibility(principal))
    .orderBy(desc(activities.occurredAt))
    .limit(8);

  const recentImports = isManagerOrAdmin(principal)
    ? await db
        .select({ id: imports.id, fileName: imports.fileName, status: imports.status, kind: imports.kind, createdAt: imports.createdAt, totalRows: imports.totalRows })
        .from(imports)
        .orderBy(desc(imports.createdAt))
        .limit(3)
    : [];

  const owners = isManagerOrAdmin(principal)
    ? await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.active, true)).orderBy(users.name)
    : [];

  const totals = pipelineTotals(stages, dealRows);
  return {
    stages,
    totals,
    conversion: stageConversion(stages, dealRows),
    win: winRate(dealRows),
    overdueTasks: overdue?.n ?? 0,
    recentActivity: recent,
    recentImports,
    owners,
    generatedAt: now,
  };
}

function ownerFilter(column: typeof tasks.ownerId, ownerId: string | null | undefined) {
  return ownerId ? eq(column, ownerId) : sql`true`;
}

export function parseUuidArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") return value.replace(/[{}]/g, "").split(",").filter(Boolean);
  return [];
}


