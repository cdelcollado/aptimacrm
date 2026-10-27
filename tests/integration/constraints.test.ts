import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { activities, contacts, deals, pipelineStages, auditEvents, users } from "@/server/db/schema";
import { makeCompany, makeContact, makeDeal, makeStages, makeUser } from "../helpers/db";
import { eq } from "drizzle-orm";

const expectDbError = async (fn: () => Promise<unknown>, code: string) => {
  const err = await fn().then(
    () => null,
    (e: unknown) => e,
  );
  expect(err, "expected a database error").not.toBeNull();
  // drizzle wraps the driver error; the Postgres code is on the cause.
  const pgCode = (err as { cause?: { code?: string }; code?: string }).cause?.code ?? (err as { code?: string }).code;
  expect(pgCode).toBe(code);
};

describe("schema constraints", () => {
  it("rejects a role outside the three allowed roles", async () => {
    await expectDbError(
      () => getDb().insert(users).values({ emailNormalized: "x@y.es", name: "X", role: "owner", passwordHash: "h" }),
      "23514",
    );
  });

  it("rejects duplicate user emails", async () => {
    await makeUser("salesperson", "Ana", "ana@x.es");
    await expectDbError(
      () => getDb().insert(users).values({ emailNormalized: "ana@x.es", name: "Other", role: "salesperson", passwordHash: "h" }),
      "23505",
    );
  });

  it("requires an open deal to have no closed_at, and a closed deal to have one", async () => {
    const owner = await makeUser("salesperson", "Ana");
    const company = await makeCompany(owner.id, "Acme");
    const stages = await makeStages();
    await expectDbError(
      () => getDb().insert(deals).values({ title: "x", companyId: company.id, ownerId: owner.id, stageId: stages.Qualificació!, status: "open", closedAt: new Date() }),
      "23514",
    );
  });

  it("rejects a deal whose status disagrees with its stage kind (database trigger)", async () => {
    const owner = await makeUser("salesperson", "Ana");
    const company = await makeCompany(owner.id, "Acme");
    const stages = await makeStages();
    await expectDbError(
      () => getDb().insert(deals).values({ title: "x", companyId: company.id, ownerId: owner.id, stageId: stages.Guanyat!, status: "open", closedAt: null }),
      "23514",
    );
  });

  it("rejects negative amounts", async () => {
    const owner = await makeUser("salesperson", "Ana");
    const company = await makeCompany(owner.id, "Acme");
    const stages = await makeStages();
    await expectDbError(
      () => getDb().insert(deals).values({ title: "x", companyId: company.id, ownerId: owner.id, stageId: stages.Qualificació!, amountCents: -1 }),
      "23514",
    );
  });

  it("requires every activity to be anchored to a deal, contact or company", async () => {
    const owner = await makeUser("admin", "Laia");
    await expectDbError(() => getDb().insert(activities).values({ kind: "note", body: "orphan", actorId: owner.id }), "23514");
  });

  it("requires stage_change activities to name two different stages", async () => {
    const owner = await makeUser("admin", "Laia");
    const company = await makeCompany(owner.id, "Acme");
    const stages = await makeStages();
    await expectDbError(
      () => getDb().insert(activities).values({ kind: "stage_change", companyId: company.id, actorId: owner.id, fromStageId: stages.Qualificació, toStageId: stages.Qualificació }),
      "23514",
    );
  });

  it("requires a correction to reference the original, a reason and the original body", async () => {
    const owner = await makeUser("admin", "Laia");
    const company = await makeCompany(owner.id, "Acme");
    await expectDbError(
      () => getDb().insert(activities).values({ kind: "correction", companyId: company.id, actorId: owner.id, body: "new" }),
      "23514",
    );
  });

  it("enforces that a contact's email, when present, is shaped like an address", async () => {
    const owner = await makeUser("admin", "Laia");
    await expectDbError(
      () => getDb().insert(contacts).values({ firstName: "X", emailNormalized: "not-an-email", ownerId: owner.id }),
      "23514",
    );
  });

  it("keeps merged status and merged_into consistent", async () => {
    const owner = await makeUser("admin", "Laia");
    const a = await makeContact(owner.id, "A", "a@x.es");
    await expectDbError(() => getDb().update(contacts).set({ status: "merged", mergedIntoId: null }).where(eq(contacts.id, a.id)), "23514");
  });

  it("makes pipeline stage positions unique but allows a deferred swap inside one transaction", async () => {
    const stages = await makeStages();
    await expectDbError(
      () => getDb().insert(pipelineStages).values({ name: "Duplicate", kind: "open", position: 0 }),
      "23505",
    );
    await getDb().transaction(async (tx) => {
      await tx.execute(sql`set constraints pipeline_stages_position_key deferred`);
      await tx.execute(sql`update pipeline_stages set position = position + 10`);
      await tx.execute(sql`update pipeline_stages set position = position - 10`);
    });
    expect(stages.Qualificació).toBeTruthy();
  });
});

describe("append-only history", () => {
  it("rejects UPDATE of an activity's content", async () => {
    const owner = await makeUser("admin", "Laia");
    const company = await makeCompany(owner.id, "Acme");
    const [row] = await getDb().insert(activities).values({ kind: "note", companyId: company.id, actorId: owner.id, body: "original" }).returning();
    await expectDbError(() => getDb().update(activities).set({ body: "rewritten" }).where(eq(activities.id, row!.id)), "42501");
  });

  it("rejects DELETE of an activity", async () => {
    const owner = await makeUser("admin", "Laia");
    const company = await makeCompany(owner.id, "Acme");
    const [row] = await getDb().insert(activities).values({ kind: "note", companyId: company.id, actorId: owner.id, body: "keep" }).returning();
    await expectDbError(() => getDb().delete(activities).where(eq(activities.id, row!.id)), "42501");
  });

  it("allows re-anchoring only inside a merge transaction (app.merge_reparent = on)", async () => {
    const owner = await makeUser("admin", "Laia");
    const a = await makeContact(owner.id, "A", "a@x.es");
    const b = await makeContact(owner.id, "B", "b@x.es");
    const [row] = await getDb().insert(activities).values({ kind: "note", contactId: a.id, actorId: owner.id, body: "keep" }).returning();

    await expectDbError(() => getDb().update(activities).set({ contactId: b.id }).where(eq(activities.id, row!.id)), "42501");

    await getDb().transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.merge_reparent', 'on', true)`);
      await tx.update(activities).set({ contactId: b.id }).where(eq(activities.id, row!.id));
    });
    const [after] = await getDb().select().from(activities).where(eq(activities.id, row!.id));
    expect(after!.contactId).toBe(b.id);
    expect(after!.body).toBe("keep");
  });

  it("does not allow changing content even inside a merge transaction", async () => {
    const owner = await makeUser("admin", "Laia");
    const a = await makeContact(owner.id, "A", "a@x.es");
    const [row] = await getDb().insert(activities).values({ kind: "note", contactId: a.id, actorId: owner.id, body: "keep" }).returning();
    await expectDbError(
      () =>
        getDb().transaction(async (tx) => {
          await tx.execute(sql`select set_config('app.merge_reparent', 'on', true)`);
          await tx.update(activities).set({ body: "changed" }).where(eq(activities.id, row!.id));
        }),
      "42501",
    );
  });

  it("makes the audit log immutable", async () => {
    const owner = await makeUser("admin", "Laia");
    const [row] = await getDb().insert(auditEvents).values({ actorId: owner.id, action: "x", subjectType: "y" }).returning();
    await expectDbError(() => getDb().update(auditEvents).set({ action: "z" }).where(eq(auditEvents.id, row!.id)), "42501");
    await expectDbError(() => getDb().delete(auditEvents).where(eq(auditEvents.id, row!.id)), "42501");
  });
});
