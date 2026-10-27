import { sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { hashPassword } from "@/server/security/primitives";
import { pipelineStages, users, companies, contacts, deals, activities, tasks, imports, importRows, jobs, sessions, inboundEmails, auditEvents } from "@/server/db/schema";
import { normalizeEmail, normalizeCompanyName, normalizeDomain } from "@/server/normalize";
import { SEED_STAGES } from "@/server/seed/seed";

/** Empties every application table. TRUNCATE skips row triggers, so append-only tables are cleared too. */
export async function resetDb(): Promise<void> {
  await getDb().execute(sql`truncate table audit_events, inbound_emails, activities, tasks, import_rows, imports, jobs, sessions, deals, contacts, companies, pipeline_stages, users restart identity cascade`);
}

export const TEST_PASSWORD = "correct-horse-battery";

/** Create a user with a valid password hash. Role decides what the principal may do. */
export async function makeUser(role: "admin" | "manager" | "salesperson", name: string, email?: string) {
  const db = getDb();
  const address = email ?? `${name.toLowerCase().replace(/\s+/g, ".")}@test.example`;
  const [row] = await db
    .insert(users)
    .values({ emailNormalized: normalizeEmail(address)!, name, role, passwordHash: await hashPassword(TEST_PASSWORD) })
    .returning();
  return row!;
}

/** The standard five stages. Idempotent: returns the existing ids if they are already there. */
export async function makeStages(): Promise<Record<string, string>> {
  const existing = await getDb().select().from(pipelineStages);
  if (existing.length > 0) return Object.fromEntries(existing.map((r) => [r.name, r.id]));
  const rows = await getDb()
    .insert(pipelineStages)
    .values(SEED_STAGES.map((s, i) => ({ name: s.name, kind: s.kind, position: i })))
    .returning();
  return Object.fromEntries(rows.map((r) => [r.name, r.id]));
}

export async function makeCompany(ownerId: string, name: string, website?: string) {
  const [row] = await getDb()
    .insert(companies)
    .values({ name, nameNormalized: normalizeCompanyName(name), domainNormalized: website ? normalizeDomain(website) : null, ownerId })
    .returning();
  return row!;
}

export async function makeContact(ownerId: string, first: string, email: string | null, companyId: string | null = null) {
  const [row] = await getDb()
    .insert(contacts)
    .values({ firstName: first, lastName: "Test", email, emailNormalized: normalizeEmail(email), ownerId, companyId })
    .returning();
  return row!;
}

export async function makeDeal(input: { ownerId: string; companyId: string; stageId: string; status?: "open" | "won" | "lost"; amountCents?: number; primaryContactId?: string | null; title?: string }) {
  const status = input.status ?? "open";
  const [row] = await getDb()
    .insert(deals)
    .values({
      title: input.title ?? "Deal",
      companyId: input.companyId,
      ownerId: input.ownerId,
      stageId: input.stageId,
      status,
      amountCents: input.amountCents ?? 10000,
      primaryContactId: input.primaryContactId ?? null,
      closedAt: status === "open" ? null : new Date(),
    })
    .returning();
  return row!;
}

export { activities, tasks, imports, importRows, jobs, sessions, inboundEmails, auditEvents };
