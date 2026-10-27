import { and, desc, eq, ilike, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getDb } from "@/server/db/client";
import { activities, companies, contacts, deals, tasks, users } from "@/server/db/schema";
import type { Principal } from "@/server/authz/policy";
import { canRead } from "@/server/authz/policy";
import { activityVisibility, companyVisibility, contactVisibility, taskVisibility } from "@/server/queries/visibility";

export interface DirectoryFilters {
  q?: string | null;
  status?: "active" | "archived";
  ownerId?: string | null;
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

export async function listContacts(principal: Principal, filters: DirectoryFilters = {}) {
  const db = getDb();
  const owner = alias(users, "owner");
  const q = filters.q?.trim() ? `%${escapeLike(filters.q.trim())}%` : null;
  const status = filters.status ?? "active";

  return db
    .select({
      id: contacts.id,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      email: contacts.email,
      emailNormalized: contacts.emailNormalized,
      companyName: companies.name,
      ownerId: contacts.ownerId,
      ownerName: owner.name,
      status: contacts.status,
      openDeals: sql<number>`(select count(*)::int from deals d where d.primary_contact_id = ${contacts.id} and d.status = 'open' and d.archived_at is null)`,
      lastActivityAt: sql<Date | null>`(select max(a.occurred_at) from activities a where a.contact_id = ${contacts.id})`,
      hasDuplicate: sql<boolean>`exists (select 1 from contacts dup where dup.email_normalized = ${contacts.emailNormalized} and dup.id <> ${contacts.id} and dup.status = 'active')`,
    })
    .from(contacts)
    .leftJoin(companies, eq(companies.id, contacts.companyId))
    .innerJoin(owner, eq(owner.id, contacts.ownerId))
    .where(
      and(
        eq(contacts.status, status === "archived" ? "archived" : "active"),
        contactVisibility(principal),
        filters.ownerId ? eq(contacts.ownerId, filters.ownerId) : sql`true`,
        q
          ? or(
              ilike(contacts.firstName, q),
              ilike(contacts.lastName, q),
              ilike(contacts.email, q),
              ilike(companies.name, q),
            )
          : sql`true`,
      ),
    )
    .orderBy(contacts.firstName, contacts.lastName)
    .limit(200);
}

export async function listCompanies(principal: Principal, filters: DirectoryFilters = {}) {
  const db = getDb();
  const owner = alias(users, "owner");
  const q = filters.q?.trim() ? `%${escapeLike(filters.q.trim())}%` : null;
  const status = filters.status ?? "active";
  return db
    .select({
      id: companies.id,
      name: companies.name,
      domain: companies.domainNormalized,
      ownerId: companies.ownerId,
      ownerName: owner.name,
      status: companies.status,
      openDeals: sql<number>`(select count(*)::int from deals d where d.company_id = ${companies.id} and d.status = 'open' and d.archived_at is null)`,
      lastActivityAt: sql<Date | null>`(select max(a.occurred_at) from activities a where a.company_id = ${companies.id})`,
      hasDuplicate: sql<boolean>`exists (select 1 from companies c2 where c2.status = 'active' and c2.id <> ${companies.id} and (c2.name_normalized = ${companies.nameNormalized} or (c2.domain_normalized is not null and c2.domain_normalized = ${companies.domainNormalized})))`,
    })
    .from(companies)
    .innerJoin(owner, eq(owner.id, companies.ownerId))
    .where(
      and(
        eq(companies.status, status === "archived" ? "archived" : "active"),
        companyVisibility(principal),
        filters.ownerId ? eq(companies.ownerId, filters.ownerId) : sql`true`,
        q ? or(ilike(companies.name, q), ilike(companies.domainNormalized, q)) : sql`true`,
      ),
    )
    .orderBy(companies.name)
    .limit(200);
}

export async function getContactDetail(principal: Principal, contactId: string) {
  const db = getDb();
  const [row] = await db
    .select({ contact: contacts, companyName: companies.name, companyOwnerId: companies.ownerId, ownerName: users.name })
    .from(contacts)
    .leftJoin(companies, eq(companies.id, contacts.companyId))
    .innerJoin(users, eq(users.id, contacts.ownerId))
    .where(and(eq(contacts.id, contactId), contactVisibility(principal)))
    .limit(1);
  if (!row) return null;

  const contactDeals = await db
    .select({ id: deals.id, title: deals.title, status: deals.status, amountCents: deals.amountCents })
    .from(deals)
    .where(and(eq(deals.primaryContactId, contactId), dealsVisibleTo(principal)))
    .orderBy(desc(deals.createdAt))
    .limit(50);

  const timeline = await db
    .select({ id: activities.id, kind: activities.kind, body: activities.body, occurredAt: activities.occurredAt, source: activities.source })
    .from(activities)
    .where(and(eq(activities.contactId, contactId), activityVisibility(principal)))
    .orderBy(desc(activities.occurredAt))
    .limit(100);

  const duplicates = await db
    .select({ id: contacts.id, firstName: contacts.firstName, lastName: contacts.lastName, ownerId: contacts.ownerId })
    .from(contacts)
    .where(and(eq(contacts.status, "active"), ne(contacts.id, contactId), row.contact.emailNormalized ? eq(contacts.emailNormalized, row.contact.emailNormalized) : sql`false`));

  return {
    contact: row.contact,
    companyName: row.companyName,
    companyVisible: !row.companyOwnerId || canRead(principal, { ownerId: row.companyOwnerId }),
    ownerName: row.ownerName,
    deals: contactDeals,
    timeline,
    duplicates: duplicates.filter((d) => canRead(principal, { ownerId: d.ownerId })),
    canMutate: canRead(principal, { ownerId: row.contact.ownerId }),
  };
}

export async function getCompanyDetail(principal: Principal, companyId: string) {
  const db = getDb();
  const [company] = await db
    .select({ company: companies, ownerName: users.name })
    .from(companies)
    .innerJoin(users, eq(users.id, companies.ownerId))
    .where(and(eq(companies.id, companyId), companyVisibility(principal)))
    .limit(1);
  if (!company) return null;
  const companyContacts = await db
    .select({ id: contacts.id, firstName: contacts.firstName, lastName: contacts.lastName, email: contacts.email })
    .from(contacts)
    .where(and(eq(contacts.companyId, companyId), eq(contacts.status, "active"), contactVisibility(principal)))
    .orderBy(contacts.firstName)
    .limit(100);
  const companyDeals = await db
    .select({ id: deals.id, title: deals.title, status: deals.status, amountCents: deals.amountCents })
    .from(deals)
    .where(and(eq(deals.companyId, companyId), dealsVisibleTo(principal)))
    .orderBy(desc(deals.createdAt))
    .limit(100);
  return { company: company.company, ownerName: company.ownerName, contacts: companyContacts, deals: companyDeals, canMutate: canRead(principal, { ownerId: company.company.ownerId }) };
}

export async function listOwnerOptions() {
  return getDb().select({ id: users.id, name: users.name }).from(users).where(eq(users.active, true)).orderBy(users.name);
}

export async function listOverdueTasks(principal: Principal, filter: "overdue" | "open" | "completed" = "overdue") {
  const now = new Date();
  const conditions = [taskVisibility(principal)];
  if (filter === "completed") conditions.push(eq(tasks.status, "completed"));
  else {
    conditions.push(eq(tasks.status, "open"));
    if (filter === "overdue") conditions.push(sql`${tasks.dueAt} < ${now}`);
  }
  return getDb()
    .select({
      id: tasks.id,
      title: tasks.title,
      dueOn: tasks.dueOn,
      dueAt: tasks.dueAt,
      status: tasks.status,
      version: tasks.version,
      ownerName: users.name,
      dealId: tasks.dealId,
      dealTitle: deals.title,
    })
    .from(tasks)
    .innerJoin(users, eq(users.id, tasks.ownerId))
    .leftJoin(deals, eq(deals.id, tasks.dealId))
    .where(and(...conditions))
    .orderBy(tasks.dueAt)
    .limit(300);
}

export function dealsVisibleTo(principal: Principal) {
  return principal.role === "salesperson" ? eq(deals.ownerId, principal.userId) : sql`true`;
}



export async function listContactsForCompany(principal: Principal, companyId: string) {
  return getDb()
    .select({ id: contacts.id, firstName: contacts.firstName, lastName: contacts.lastName })
    .from(contacts)
    .where(and(eq(contacts.companyId, companyId), eq(contacts.status, "active"), contactVisibility(principal)))
    .orderBy(contacts.firstName)
    .limit(200);
}
