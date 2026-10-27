import { eq, sql, type SQL, type Column } from "drizzle-orm";
import type { Principal } from "@/server/authz/policy";
import { activities, companies, contacts, deals, tasks } from "@/server/db/schema";

/**
 * SQL form of the policy in src/server/authz/policy.ts. Every repository query starts from
 * one of these, so a guessed id or a missing UI control cannot widen what a principal sees.
 */

const ALL: SQL = sql`true`;

function ownerScope(p: Principal, ownerColumn: Column): SQL {
  if (p.role !== "salesperson") return ALL;
  return eq(ownerColumn, p.userId);
}

export const dealVisibility = (p: Principal) => ownerScope(p, deals.ownerId);
export const contactVisibility = (p: Principal) => ownerScope(p, contacts.ownerId);
export const companyVisibility = (p: Principal) => ownerScope(p, companies.ownerId);
export const taskVisibility = (p: Principal) => ownerScope(p, tasks.ownerId);

/**
 * Activities are visible when the record they are anchored to is visible. Email captures
 * with no visible anchor are hidden from salespeople (see PLAN.md, section 2).
 */
export function activityVisibility(p: Principal): SQL {
  if (p.role !== "salesperson") return ALL;
  return sql`(
    exists (select 1 from deals d where d.id = ${activities.dealId} and d.owner_id = ${p.userId})
    or exists (select 1 from contacts c where c.id = ${activities.contactId} and c.owner_id = ${p.userId})
    or exists (select 1 from companies co where co.id = ${activities.companyId} and co.owner_id = ${p.userId})
  )`;
}

/** Scoped visibility for a deal's company context on the detail screen. */
export function companyNameVisible(p: Principal, companyOwnerId: string): boolean {
  return p.role !== "salesperson" || companyOwnerId === p.userId;
}
