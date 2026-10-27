import { and, asc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getDb } from "@/server/db/client";
import { activities, companies, contacts, deals, pipelineStages, users } from "@/server/db/schema";
import { canExportDeals, canExportFull, type Principal } from "@/server/authz/policy";
import { csvSafeCell } from "@/server/domain/imports/csv";
import { recordAudit } from "@/server/domain/audit";
import { getConfig } from "@/server/config";
import { withTx } from "@/server/db/client";
import { dealVisibility } from "@/server/queries/visibility";

export type ExportKind = "deals" | "contacts" | "companies" | "activities";

const HEADERS: Record<ExportKind, string[]> = {
  deals: ["deal_id", "title", "status", "stage", "amount_eur", "owner", "company", "primary_contact", "expected_close_on", "created_at", "closed_at"],
  contacts: ["contact_id", "first_name", "last_name", "email", "phone", "company", "owner", "status", "created_at"],
  companies: ["company_id", "name", "domain", "owner", "status", "created_at"],
  activities: ["activity_id", "kind", "source", "deal_id", "contact_id", "company_id", "actor", "occurred_at", "body"],
};

/**
 * Deal snapshot for managers and admins: honours the same filter as the board, is visibility-scoped,
 * and carries no contact email or phone. Full CRM exports (admin only) are a separate function.
 */
export async function dealSnapshotCsv(principal: Principal, filters: { ownerId?: string | null; stageId?: string | null; status?: string | null }, requestId?: string | null) {
  if (!canExportDeals(principal)) return null;
  const db = getDb();
  const owner = alias(users, "owner");
  const rows = await db
    .select({
      id: deals.id,
      title: deals.title,
      status: deals.status,
      stage: pipelineStages.name,
      amountCents: deals.amountCents,
      ownerName: owner.name,
      company: companies.name,
      contactFirst: contacts.firstName,
      contactLast: contacts.lastName,
      expectedCloseOn: deals.expectedCloseOn,
      createdAt: deals.createdAt,
      closedAt: deals.closedAt,
    })
    .from(deals)
    .innerJoin(pipelineStages, eq(pipelineStages.id, deals.stageId))
    .innerJoin(companies, eq(companies.id, deals.companyId))
    .innerJoin(owner, eq(owner.id, deals.ownerId))
    .leftJoin(contacts, eq(contacts.id, deals.primaryContactId))
    .where(
      and(
        dealVisibility(principal),
        sql`${deals.archivedAt} is null`,
        filters.ownerId ? eq(deals.ownerId, filters.ownerId) : sql`true`,
        filters.stageId ? eq(deals.stageId, filters.stageId) : sql`true`,
        filters.status ? eq(deals.status, filters.status) : sql`true`,
      ),
    )
    .orderBy(asc(deals.createdAt));

  const lines = [HEADERS.deals.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.id,
        r.title,
        r.status,
        r.stage,
        (r.amountCents / 100).toFixed(2),
        r.ownerName,
        r.company,
        r.contactFirst ? `${r.contactFirst} ${r.contactLast}`.trim() : "",
        r.expectedCloseOn,
        r.createdAt,
        r.closedAt,
      ]
        .map(csvSafeCell)
        .join(","),
    );
  }
  await withTx((tx) =>
    recordAudit(tx, {
      actorId: principal.userId,
      action: "export.deals",
      subjectType: "export",
      subjectId: null,
      metadata: { rows: rows.length, filters },
      requestId: requestId ?? null,
    }),
  );
  return { csv: lines.join("\n") + "\n", rows: rows.length, filename: `deals-${stamp()}.csv` };
}

/** Full CRM export. Admin only. Every request is audited, including the row counts. */
export async function fullExportCsv(principal: Principal, kind: ExportKind, requestId?: string | null) {
  if (!canExportFull(principal)) return null;
  const db = getDb();
  let lines: string[];
  if (kind === "contacts") {
    const rows = await db
      .select({ id: contacts.id, first: contacts.firstName, last: contacts.lastName, email: contacts.email, phone: contacts.phone, company: companies.name, owner: users.name, status: contacts.status, createdAt: contacts.createdAt })
      .from(contacts)
      .leftJoin(companies, eq(companies.id, contacts.companyId))
      .innerJoin(users, eq(users.id, contacts.ownerId))
      .orderBy(asc(contacts.createdAt));
    lines = rows.map((r) => [r.id, r.first, r.last, r.email, r.phone, r.company, r.owner, r.status, r.createdAt].map(csvSafeCell).join(","));
  } else if (kind === "companies") {
    const rows = await db
      .select({ id: companies.id, name: companies.name, domain: companies.domainNormalized, owner: users.name, status: companies.status, createdAt: companies.createdAt })
      .from(companies)
      .innerJoin(users, eq(users.id, companies.ownerId))
      .orderBy(asc(companies.createdAt));
    lines = rows.map((r) => [r.id, r.name, r.domain, r.owner, r.status, r.createdAt].map(csvSafeCell).join(","));
  } else if (kind === "activities") {
    const rows = await db
      .select({ id: activities.id, kind: activities.kind, source: activities.source, dealId: activities.dealId, contactId: activities.contactId, companyId: activities.companyId, actor: users.name, occurredAt: activities.occurredAt, body: activities.body })
      .from(activities)
      .leftJoin(users, eq(users.id, activities.actorId))
      .orderBy(asc(activities.occurredAt));
    lines = rows.map((r) => [r.id, r.kind, r.source, r.dealId, r.contactId, r.companyId, r.actor, r.occurredAt, r.body].map(csvSafeCell).join(","));
  } else {
    const rows = await db
      .select({ id: deals.id, title: deals.title, status: deals.status, stage: pipelineStages.name, amountCents: deals.amountCents, owner: users.name, company: companies.name, expectedCloseOn: deals.expectedCloseOn, createdAt: deals.createdAt, closedAt: deals.closedAt })
      .from(deals)
      .innerJoin(pipelineStages, eq(pipelineStages.id, deals.stageId))
      .innerJoin(companies, eq(companies.id, deals.companyId))
      .innerJoin(users, eq(users.id, deals.ownerId))
      .orderBy(asc(deals.createdAt));
    lines = rows.map((r) => [r.id, r.title, r.status, r.stage, (r.amountCents / 100).toFixed(2), r.owner, r.company, r.expectedCloseOn, r.createdAt, r.closedAt].map(csvSafeCell).join(","));
  }

  const header = HEADERS[kind].join(",");
  const count = lines.length;
  await withTx((tx) =>
    recordAudit(tx, {
      actorId: principal.userId,
      action: "export.full",
      subjectType: "export",
      subjectId: null,
      metadata: { kind, rows: count },
      requestId: requestId ?? null,
    }),
  );
  return { csv: [header, ...lines].join("\n") + "\n", rows: count, filename: `aptima-${kind}-${stamp()}.csv` };
}

function stamp(): string {
  return new Date().toISOString().slice(0, 10) + "-" + getConfig().orgTimezone.replace("/", "-");
}


