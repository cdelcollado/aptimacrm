/**
 * Authorization predicates. Pure functions over a Principal and the minimum facts about a
 * record (its owner, its state). Repositories call these and also translate the same rules
 * into SQL predicates (see visibilityFilter) so reads and mutations cannot disagree.
 */

export type Role = "admin" | "manager" | "salesperson";

export interface Principal {
  userId: string;
  name: string;
  role: Role;
  locale: "ca" | "es" | "en";
}

export const ROLES: readonly Role[] = ["admin", "manager", "salesperson"];

export const isAdmin = (p: Principal) => p.role === "admin";
export const isManagerOrAdmin = (p: Principal) => p.role === "manager" || p.role === "admin";

/** Read: managers and admins see everything; salespeople see records they own. */
export function canRead(p: Principal, record: { ownerId: string }): boolean {
  return isManagerOrAdmin(p) || record.ownerId === p.userId;
}

/** Mutate ownership-scoped records (edit, log, task, move stage, archive). Same rule as read. */
export function canMutate(p: Principal, record: { ownerId: string }): boolean {
  return canRead(p, record);
}

/** Reassigning owner is a manager/admin decision so salespeople cannot take over records. */
export function canReassign(p: Principal): boolean {
  return isManagerOrAdmin(p);
}

/** Reopening a won/lost deal requires a reason and a manager/admin. */
export function canReopen(p: Principal): boolean {
  return isManagerOrAdmin(p);
}

/** Merging needs to see both contacts; salespeople may merge only records they own on both sides. */
export function canMerge(p: Principal, a: { ownerId: string }, b: { ownerId: string }): boolean {
  if (isManagerOrAdmin(p)) return true;
  return a.ownerId === p.userId && b.ownerId === p.userId;
}

/** Deal-pipeline snapshot export: managers and admins, scoped to what they can read. */
export function canExportDeals(p: Principal): boolean {
  return isManagerOrAdmin(p);
}

/** Full CRM export (contacts, companies, deals, activities): admins only, always audited. */
export function canExportFull(p: Principal): boolean {
  return isAdmin(p);
}

export function canManageStages(p: Principal): boolean {
  return isAdmin(p);
}

export function canImport(p: Principal): boolean {
  return isManagerOrAdmin(p);
}

export function canManageEmailCapture(p: Principal): boolean {
  return isManagerOrAdmin(p);
}

/**
 * Archiving follows mutate rules. Restoring is a manager/admin decision so a salesperson
 * cannot undo a cleanup a manager made.
 */
export function canRestore(p: Principal): boolean {
  return isManagerOrAdmin(p);
}

/** Who may see a deal's company name in full, or only as a restricted placeholder. */
export function canSeeCompany(p: Principal, company: { ownerId: string }): boolean {
  return canRead(p, company);
}

export function requireRole(p: Principal, allowed: readonly Role[]): boolean {
  return allowed.includes(p.role);
}
