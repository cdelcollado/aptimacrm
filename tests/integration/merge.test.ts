import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { activities, auditEvents, contacts, deals, tasks } from "@/server/db/schema";
import { mergeContacts, previewMerge } from "@/server/domain/contacts/merge";
import { makeCompany, makeContact, makeDeal, makeStages, makeUser } from "../helpers/db";
import { asPrincipal } from "../helpers/principal";

async function setup() {
  const ana = await makeUser("salesperson", "Ana Ruiz");
  const joan = await makeUser("salesperson", "Joan Puig");
  const manager = await makeUser("manager", "Marc Soler");
  const company = await makeCompany(ana.id, "Acme", "acme.es");
  const stages = await makeStages();
  const survivor = await makeContact(ana.id, "Núria", "nuria@acme.es", company.id);
  const source = await makeContact(ana.id, "Nuria", "nuria@acme.es");
  const deal = await makeDeal({ ownerId: ana.id, companyId: company.id, stageId: stages.Qualificació!, primaryContactId: source.id });
  await getDb().insert(activities).values({ kind: "call", contactId: source.id, actorId: ana.id, body: "Trucada important, no es pot perdre.", companyId: company.id });
  await getDb().insert(tasks).values({ title: "Seguiment", ownerId: ana.id, contactId: source.id, dueOn: "2026-11-01", dueAt: new Date("2026-11-02T00:00:00Z") });
  return { ana, joan, manager, survivor, source, deal };
}

const picks = { firstName: "survivor" as const, lastName: "survivor" as const, email: "survivor" as const, phone: "survivor" as const, companyId: "survivor" as const };

describe("contact merge", () => {
  it("previews what will move and which fields conflict", async () => {
    const { ana, survivor, source } = await setup();
    const preview = await previewMerge(asPrincipal(ana), survivor.id, source.id);
    expect(preview.counts).toEqual({ activities: 1, tasks: 1, deals: 1 });
    expect(preview.conflicts).toContain("firstName");
  });

  it("re-anchors activities, tasks and deals to the survivor and marks the source as merged, without deleting it", async () => {
    const { manager, survivor, source, deal } = await setup();
    const before = (await getDb().select().from(activities).where(eq(activities.contactId, source.id)))[0]!;
    const result = await mergeContacts({
      principal: asPrincipal(manager),
      survivorId: survivor.id,
      sourceId: source.id,
      picks,
      expectedSurvivorVersion: 1,
      expectedSourceVersion: 1,
    });
    expect(result.counts).toEqual({ activities: 1, tasks: 1, deals: 1 });

    const [src] = await getDb().select().from(contacts).where(eq(contacts.id, source.id));
    expect(src).toMatchObject({ status: "merged", mergedIntoId: survivor.id });

    const [moved] = await getDb().select().from(activities).where(eq(activities.id, before.id));
    expect(moved).toMatchObject({ contactId: survivor.id, body: before.body });

    const [d] = await getDb().select().from(deals).where(eq(deals.id, deal.id));
    expect(d!.primaryContactId).toBe(survivor.id);
  });

  it("writes a merge activity and an audit event", async () => {
    const { manager, survivor, source } = await setup();
    await mergeContacts({ principal: asPrincipal(manager), survivorId: survivor.id, sourceId: source.id, picks, expectedSurvivorVersion: 1, expectedSourceVersion: 1 });
    expect(await getDb().select().from(activities).where(eq(activities.kind, "merge"))).toHaveLength(1);
    expect(await getDb().select().from(auditEvents).where(eq(auditEvents.action, "merge.completed"))).toHaveLength(1);
  });

  it("applies the field picks the reviewer chose", async () => {
    const { manager, survivor, source } = await setup();
    await mergeContacts({
      principal: asPrincipal(manager),
      survivorId: survivor.id,
      sourceId: source.id,
      picks: { ...picks, firstName: "source" },
      expectedSurvivorVersion: 1,
      expectedSourceVersion: 1,
    });
    const [s] = await getDb().select().from(contacts).where(eq(contacts.id, survivor.id));
    expect(s!.firstName).toBe("Nuria");
  });

  it("is idempotent: confirming the same merge again succeeds without moving anything", async () => {
    const { manager, survivor, source } = await setup();
    const args = { principal: asPrincipal(manager), survivorId: survivor.id, sourceId: source.id, picks, expectedSurvivorVersion: 1, expectedSourceVersion: 1 };
    await mergeContacts(args);
    const second = await mergeContacts(args);
    expect(second.alreadyMerged).toBe(true);
    expect(await getDb().select().from(activities).where(eq(activities.kind, "merge"))).toHaveLength(1);
  });

  it("rejects a merge when either contact changed since the preview", async () => {
    const { manager, survivor, source } = await setup();
    await expect(
      mergeContacts({ principal: asPrincipal(manager), survivorId: survivor.id, sourceId: source.id, picks, expectedSurvivorVersion: 7, expectedSourceVersion: 1 }),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("does not let a salesperson merge contacts owned by someone else", async () => {
    const { joan, survivor, source } = await setup();
    await expect(previewMerge(asPrincipal(joan), survivor.id, source.id)).rejects.toMatchObject({ code: "not_found" });
    await expect(
      mergeContacts({ principal: asPrincipal(joan), survivorId: survivor.id, sourceId: source.id, picks, expectedSurvivorVersion: 1, expectedSourceVersion: 1 }),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("lets a salesperson merge two contacts they both own", async () => {
    const { ana, survivor, source } = await setup();
    const preview = await previewMerge(asPrincipal(ana), survivor.id, source.id);
    expect(preview.source.id).toBe(source.id);
  });
});
