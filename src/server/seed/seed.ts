import { sql } from "drizzle-orm";
import { getDb, type Db } from "@/server/db/client";
import { hashPassword } from "@/server/security/primitives";
import { normalizeCompanyName, normalizeDomain, normalizeEmail, normalizePhone } from "@/server/normalize";
import { addCalendarDays, taskDueInstant, localDateOf } from "@/server/domain/time";
import { activities, auditEvents, companies, contacts, deals, inboundEmails, pipelineStages, sessions, tasks, users } from "@/server/db/schema";

/**
 * Representative seed data. Exercises: the happy path, an empty pipeline stage, an overdue task,
 * an archived company, a duplicate contact, a won and a lost deal, an ambiguous BCC email, an
 * expired session, and one salesperson per owner to show visibility boundaries.
 */

export const SEED_USERS = [
  { key: "admin", email: "admin@aptima.test", name: "Laia Ferrer", role: "admin", locale: "ca" },
  { key: "manager", email: "manager@aptima.test", name: "Marc Soler", role: "manager", locale: "ca" },
  { key: "ana", email: "ana@aptima.test", name: "Ana Ruiz", role: "salesperson", locale: "es" },
  { key: "joan", email: "joan@aptima.test", name: "Joan Puig", role: "salesperson", locale: "ca" },
] as const;

export const SEED_STAGES = [
  { name: "Qualificació", kind: "open" },
  { name: "Proposta", kind: "open" },
  { name: "Negociació", kind: "open" },
  { name: "Guanyat", kind: "won" },
  { name: "Perdut", kind: "lost" },
] as const;

export interface SeedResult {
  userIds: Record<string, string>;
  stageIds: Record<string, string>;
  companyIds: Record<string, string>;
  contactIds: Record<string, string>;
  dealIds: Record<string, string>;
}

export async function clearAll(db: Db = getDb()): Promise<void> {
  await db.execute(sql`truncate table audit_events, inbound_emails, activities, tasks, import_rows, imports, jobs, sessions, deals, contacts, companies, pipeline_stages, users restart identity cascade`);
}

/** Inserts the full demo dataset. Call on an empty database (or after clearAll). */
export async function seedDatabase(options: { password: string; timeZone?: string; db?: Db }): Promise<SeedResult> {
  const db = options.db ?? getDb();
  const tz = options.timeZone ?? "Europe/Madrid";
  const passwordHash = await hashPassword(options.password);
  const now = new Date();
  const today = localDateOf(now, tz);

  const userIds: Record<string, string> = {};
  for (const u of SEED_USERS) {
    const [row] = await db
      .insert(users)
      .values({ emailNormalized: normalizeEmail(u.email)!, name: u.name, role: u.role, passwordHash, locale: u.locale })
      .returning({ id: users.id });
    userIds[u.key] = row!.id;
  }

  const stageIds: Record<string, string> = {};
  for (const [i, s] of SEED_STAGES.entries()) {
    const [row] = await db.insert(pipelineStages).values({ name: s.name, kind: s.kind, position: i }).returning({ id: pipelineStages.id });
    stageIds[s.name] = row!.id;
  }
  const stage = (name: string) => stageIds[name]!;

  const companyIds: Record<string, string> = {};
  const companySeed = [
    { key: "acme", name: "Acme Ibèrica", website: "acme.es", owner: "ana" },
    { key: "torres", name: "Vidres Torres", website: "vidrestorres.cat", owner: "ana" },
    { key: "riera", name: "Cafés Riera", website: "cafesriera.es", owner: "joan" },
    { key: "nordic", name: "Nordic Logística", website: "nordic-log.com", owner: "manager", archived: true },
  ] as const;
  for (const c of companySeed) {
    const [row] = await db
      .insert(companies)
      .values({
        name: c.name,
        nameNormalized: normalizeCompanyName(c.name),
        domainNormalized: normalizeDomain(c.website),
        ownerId: userIds[c.owner]!,
        status: "archived" in c && c.archived ? "archived" : "active",
        archivedAt: "archived" in c && c.archived ? now : null,
      })
      .returning({ id: companies.id });
    companyIds[c.key] = row!.id;
  }

  const contactIds: Record<string, string> = {};
  const contactSeed = [
    { key: "pau", first: "Pau", last: "Vidal", email: "pau.vidal@acme.es", phone: "+34 611 22 33 44", company: "acme", owner: "ana" },
    { key: "nuria", first: "Núria", last: "Font", email: "nuria@acme.es", phone: "", company: "acme", owner: "ana" },
    { key: "nuria2", first: "Núria", last: "Font Puig", email: "  NURIA@acme.es ", phone: "934 00 11 22", company: "acme", owner: "joan" },
    { key: "marta", first: "Marta", last: "Torres", email: "marta@vidrestorres.cat", phone: "", company: "torres", owner: "ana" },
    { key: "jordi", first: "Jordi", last: "Riera", email: "jordi@cafesriera.es", phone: "", company: "riera", owner: "joan" },
    { key: "sergi", first: "Sergi", last: "Costa", email: "sergi@gmail.com", phone: "", company: null, owner: "ana" },
  ] as const;
  for (const c of contactSeed) {
    const emailNormalized = normalizeEmail(c.email);
    const [row] = await db
      .insert(contacts)
      .values({
        firstName: c.first,
        lastName: c.last,
        email: c.email.trim(),
        emailNormalized,
        phone: normalizePhone(c.phone),
        companyId: c.company ? companyIds[c.company]! : null,
        ownerId: userIds[c.owner]!,
      })
      .returning({ id: contacts.id });
    contactIds[c.key] = row!.id;
  }

  const dealIds: Record<string, string> = {};
  const created = new Date(now.getTime() - 20 * 86_400_000);
  const dealSeed = [
    { key: "flota", title: "Renovació flota 2026", company: "acme", contact: "pau", owner: "ana", stage: "Proposta", amount: 1250000, path: ["Qualificació", "Proposta"] },
    { key: "pilot", title: "Pilot vidres", company: "torres", contact: "marta", owner: "ana", stage: "Qualificació", amount: 320000, path: ["Qualificació"] },
    { key: "cafeteries", title: "Expansió cafeteries", company: "riera", contact: "jordi", owner: "joan", stage: "Negociació", amount: 880000, path: ["Qualificació", "Proposta", "Negociació"] },
    { key: "anual", title: "Contracte anual", company: "acme", contact: "pau", owner: "ana", stage: "Guanyat", amount: 2000000, path: ["Qualificació", "Proposta", "Negociació", "Guanyat"] },
    { key: "descartat", title: "Oferta descartada", company: "torres", contact: null, owner: "ana", stage: "Perdut", amount: 400000, path: ["Qualificació", "Proposta", "Perdut"] },
  ] as const;

  for (const d of dealSeed) {
    const kind = SEED_STAGES.find((s) => s.name === d.stage)!.kind;
    const closed = kind !== "open";
    const [row] = await db
      .insert(deals)
      .values({
        title: d.title,
        companyId: companyIds[d.company]!,
        primaryContactId: d.contact ? contactIds[d.contact]! : null,
        ownerId: userIds[d.owner]!,
        stageId: stage(d.stage),
        status: kind,
        amountCents: d.amount,
        expectedCloseOn: addCalendarDays(today, 45),
        stageEnteredAt: new Date(created.getTime() + 5 * 86_400_000),
        closedAt: closed ? new Date(now.getTime() - 2 * 86_400_000) : null,
        createdAt: created,
      })
      .returning({ id: deals.id });
    dealIds[d.key] = row!.id;

    await db.insert(activities).values({
      kind: "system",
      source: "system",
      dealId: row!.id,
      companyId: companyIds[d.company]!,
      contactId: d.contact ? contactIds[d.contact]! : null,
      actorId: userIds[d.owner]!,
      body: d.title,
      toStageId: stage(d.path[0]!),
      occurredAt: created,
      createdAt: created,
      metadata: { event: "deal_created" },
    });
    for (let i = 1; i < d.path.length; i++) {
      await db.insert(activities).values({
        kind: "stage_change",
        source: "manual",
        dealId: row!.id,
        companyId: companyIds[d.company]!,
        actorId: userIds[d.owner]!,
        fromStageId: stage(d.path[i - 1]!),
        toStageId: stage(d.path[i]!),
        occurredAt: new Date(created.getTime() + i * 5 * 86_400_000),
        createdAt: new Date(created.getTime() + i * 5 * 86_400_000),
      });
    }
  }

  const callAt = (days: number) => new Date(now.getTime() - days * 86_400_000);
  await db.insert(activities).values([
    { kind: "call", source: "manual", dealId: dealIds.flota!, contactId: contactIds.pau!, companyId: companyIds.acme!, actorId: userIds.ana!, body: "Pau confirma que la renovació es fa aquest trimestre. Pendent de pressupost signat.", occurredAt: callAt(3) },
    { kind: "note", source: "manual", dealId: dealIds.pilot!, contactId: contactIds.marta!, companyId: companyIds.torres!, actorId: userIds.ana!, body: "Pilot de 20 vehicles. Marta vol veure resultats abans de l'estiu.", occurredAt: callAt(6) },
    { kind: "email", source: "bcc", dealId: dealIds.cafeteries!, contactId: contactIds.jordi!, companyId: companyIds.riera!, actorId: null, body: "Subject: Pressupost actualitzat\n\nT'envio la versió revisada del pressupost.", occurredAt: callAt(1), externalMessageId: "seed-bcc-1" },
  ]);

  await db.insert(tasks).values([
    { title: "Enviar proposta revisada", ownerId: userIds.ana!, dealId: dealIds.flota!, contactId: contactIds.pau!, companyId: companyIds.acme!, dueOn: addCalendarDays(today, -3), dueAt: taskDueInstant(addCalendarDays(today, -3), tz)! },
    { title: "Trucada de seguiment", ownerId: userIds.ana!, dealId: dealIds.pilot!, contactId: contactIds.marta!, companyId: companyIds.torres!, dueOn: addCalendarDays(today, 1), dueAt: taskDueInstant(addCalendarDays(today, 1), tz)! },
    { title: "Revisar contracte legal", ownerId: userIds.joan!, dealId: dealIds.cafeteries!, companyId: companyIds.riera!, dueOn: addCalendarDays(today, 2), dueAt: taskDueInstant(addCalendarDays(today, 2), tz)! },
    { title: "Confirmar data de signatura", ownerId: userIds.ana!, dealId: dealIds.anual!, companyId: companyIds.acme!, dueOn: addCalendarDays(today, -10), dueAt: taskDueInstant(addCalendarDays(today, -10), tz)!, status: "completed", completedAt: callAt(9), completedBy: userIds.ana! },
  ]);

  await db.insert(inboundEmails).values({
    providerMessageId: "seed-ambiguous-1",
    receivedAt: callAt(0.2),
    fromNormalized: normalizeEmail("nuria@acme.es")!,
    toAddress: "capture@crm.example.com",
    subject: "Dubte sobre el contracte",
    bodyExcerpt: "Hola, em pots confirmar el preu per llicència?",
    status: "ambiguous",
    rawSha256: "0".repeat(64),
  });

  // An expired session for Ana: the sign-in screen should explain it, not show a generic failure.
  await db.insert(sessions).values({
    userId: userIds.ana!,
    tokenHash: "seed-expired-session-hash",
    expiresAt: new Date(now.getTime() - 86_400_000),
    lastSeenAt: new Date(now.getTime() - 3 * 86_400_000),
  });

  await db.insert(auditEvents).values({ actorId: userIds.admin!, action: "system.seeded", subjectType: "system", subjectId: null, metadata: { users: SEED_USERS.length } });

  return { userIds, stageIds, companyIds, contactIds, dealIds };
}


