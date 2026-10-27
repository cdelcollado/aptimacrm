import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { companies, contacts, importRows, imports, jobs } from "@/server/db/schema";
import { canImport, type Principal } from "@/server/authz/policy";

export async function listImports(principal: Principal) {
  if (!canImport(principal)) return [];
  return getDb()
    .select({ id: imports.id, kind: imports.kind, status: imports.status, fileName: imports.fileName, totalRows: imports.totalRows, createdAt: imports.createdAt })
    .from(imports)
    .orderBy(desc(imports.createdAt))
    .limit(50);
}

/** Import with rows and the state of its parse job, so failed/retrying work is visible to the user. */
export async function getImportDetail(principal: Principal, importId: string) {
  if (!canImport(principal)) return null;
  const db = getDb();
  const [imp] = await db.select().from(imports).where(eq(imports.id, importId)).limit(1);
  if (!imp) return null;

  const [job] = await db
    .select({ status: jobs.status, attempts: jobs.attempts, maxAttempts: jobs.maxAttempts, lastError: jobs.lastError, runAfter: jobs.runAfter })
    .from(jobs)
    .where(eq(jobs.idempotencyKey, `import.parse:${imp.id}`))
    .limit(1);

  const rows = await db
    .select()
    .from(importRows)
    .where(eq(importRows.importId, imp.id))
    .orderBy(asc(importRows.rowNumber))
    .limit(500);

  const problemRows = rows.filter((r) => r.status === "error" || r.status === "duplicate");
  return { imp, job: job ?? null, rows, problemRows };
}

export async function duplicateRowsWithMatches(importId: string) {
  return getDb()
    .select({ id: importRows.id, rowNumber: importRows.rowNumber, normalized: importRows.normalized, matchContactId: importRows.matchContactId, matchCompanyId: importRows.matchCompanyId, decision: importRows.decision })
    .from(importRows)
    .where(and(eq(importRows.importId, importId), eq(importRows.status, "duplicate")))
    .orderBy(asc(importRows.rowNumber));
}



/** Names of records that duplicate rows match, for display in the review screen. */
export async function matchLabels(contactIds: string[], companyIds: string[]) {
  const db = getDb();
  const contactRows = contactIds.length
    ? await db.select({ id: contacts.id, first: contacts.firstName, last: contacts.lastName, email: contacts.email }).from(contacts).where(inArray(contacts.id, contactIds))
    : [];
  const companyRows = companyIds.length ? await db.select({ id: companies.id, name: companies.name }).from(companies).where(inArray(companies.id, companyIds)) : [];
  return {
    contacts: new Map(contactRows.map((r) => [r.id, `${r.first} ${r.last}`.trim() + (r.email ? ` · ${r.email}` : "")])),
    companies: new Map(companyRows.map((r) => [r.id, r.name])),
  };
}
