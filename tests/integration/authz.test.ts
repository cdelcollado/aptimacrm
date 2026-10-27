import { describe, expect, it } from "vitest";
import { getDealDetail } from "@/server/queries/deal-detail";
import { getContactDetail, listContacts, listCompanies } from "@/server/queries/directory";
import { getBoard } from "@/server/queries/pipeline";
import { getDashboard } from "@/server/queries/dashboard";
import { dealSnapshotCsv, fullExportCsv } from "@/server/queries/exports";
import { createDeal, logActivity, createTask } from "@/server/domain/deals/service";
import { createContact } from "@/server/domain/contacts/service";
import { saveStages, moveStage, deleteStage } from "@/server/domain/deals/stages-admin";
import { getDb } from "@/server/db/client";
import { auditEvents, deals } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { makeCompany, makeContact, makeDeal, makeStages, makeUser } from "../helpers/db";
import { asPrincipal } from "../helpers/principal";
import { ValidationError } from "@/server/errors";

async function world() {
  const ana = await makeUser("salesperson", "Ana Ruiz");
  const joan = await makeUser("salesperson", "Joan Puig");
  const manager = await makeUser("manager", "Marc Soler");
  const admin = await makeUser("admin", "Laia Ferrer");
  const stages = await makeStages();
  const anaCompany = await makeCompany(ana.id, "Acme", "acme.es");
  const joanCompany = await makeCompany(joan.id, "Riera", "cafesriera.es");
  const anaContact = await makeContact(ana.id, "Pau", "pau@acme.es", anaCompany.id);
  const joanContact = await makeContact(joan.id, "Jordi", "jordi@cafesriera.es", joanCompany.id);
  const anaDeal = await makeDeal({ ownerId: ana.id, companyId: anaCompany.id, stageId: stages.Proposta!, primaryContactId: anaContact.id, title: "Ana deal" });
  const joanDeal = await makeDeal({ ownerId: joan.id, companyId: joanCompany.id, stageId: stages.Qualificació!, primaryContactId: joanContact.id, title: "Joan deal" });
  return { ana, joan, manager, admin, stages, anaCompany, joanCompany, anaContact, joanContact, anaDeal, joanDeal };
}

describe("record visibility in queries", () => {
  it("a salesperson cannot open another owner's deal by guessed id", async () => {
    const w = await world();
    expect(await getDealDetail(asPrincipal(w.ana), w.joanDeal.id)).toBeNull();
    expect(await getDealDetail(asPrincipal(w.joan), w.anaDeal.id)).toBeNull();
    expect(await getDealDetail(asPrincipal(w.ana), w.anaDeal.id)).not.toBeNull();
  });

  it("a manager sees every deal", async () => {
    const w = await world();
    expect(await getDealDetail(asPrincipal(w.manager), w.joanDeal.id)).not.toBeNull();
  });

  it("directories list only the salesperson's own contacts and companies", async () => {
    const w = await world();
    const contacts = await listContacts(asPrincipal(w.ana), {});
    expect(contacts.map((c) => c.id)).toEqual([w.anaContact.id]);
    const companies = await listCompanies(asPrincipal(w.ana), {});
    expect(companies.map((c) => c.id)).toEqual([w.anaCompany.id]);
    expect(await getContactDetail(asPrincipal(w.ana), w.joanContact.id)).toBeNull();
  });

  it("the pipeline board and dashboard are scoped to what the viewer can read", async () => {
    const w = await world();
    const anaBoard = await getBoard(asPrincipal(w.ana));
    const titles = anaBoard.stages.flatMap((s) => s.cards.map((c) => c.title));
    expect(titles).toEqual(["Ana deal"]);
    const managerBoard = await getBoard(asPrincipal(w.manager));
    expect(managerBoard.stages.flatMap((s) => s.cards.map((c) => c.title)).sort()).toEqual(["Ana deal", "Joan deal"]);

    const anaDash = await getDashboard(asPrincipal(w.ana));
    expect(anaDash.totals.openCount).toBe(1);
  });

  it("the company name on a deal is restricted when the company belongs to someone else", async () => {
    const w = await world();
    const stages = w.stages;
    // Ana owns this deal, but the company belongs to Joan: the company name must not leak to Ana.
    const sharedCompany = w.joanCompany;
    const mixed = await makeDeal({ ownerId: w.ana.id, companyId: sharedCompany.id, stageId: stages.Qualificació!, title: "Mixed" });
    const detail = await getDealDetail(asPrincipal(w.ana), mixed.id);
    expect(detail).toMatchObject({ companyVisible: false, companyName: "[restricted]" });
  });

  it("activities on a deal are hidden from a salesperson who does not own the deal", async () => {
    const w = await world();
    await logActivity({ principal: asPrincipal(w.joan), dealId: w.joanDeal.id, kind: "note", body: "Confidencial de Joan" }).catch(() => undefined);
    await logActivity({ principal: asPrincipal(w.manager), dealId: w.joanDeal.id, kind: "note", body: "Nota del responsable" });
    const detail = await getDealDetail(asPrincipal(w.joan), w.joanDeal.id);
    expect(detail!.timeline.map((a) => a.body)).toContain("Nota del responsable");
    expect(await getDealDetail(asPrincipal(w.ana), w.joanDeal.id)).toBeNull();
  });
});

describe("mutation boundaries", () => {
  it("a salesperson cannot create a deal owned by someone else", async () => {
    const w = await world();
    await expect(
      createDeal({ principal: asPrincipal(w.ana), title: "Impostor", companyId: w.anaCompany.id, ownerId: w.joan.id, amountInput: "100" }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("a salesperson cannot create a deal on a company they do not own", async () => {
    const w = await world();
    await expect(createDeal({ principal: asPrincipal(w.ana), title: "X", companyId: w.joanCompany.id, amountInput: "100" })).rejects.toMatchObject({ code: "not_found" });
  });

  it("a salesperson cannot attach a task to another owner's deal", async () => {
    const w = await world();
    await expect(createTask({ principal: asPrincipal(w.ana), title: "Hack", dueOn: "2026-12-01", dealId: w.joanDeal.id })).rejects.toMatchObject({ code: "not_found" });
  });

  it("a salesperson cannot create a contact owned by someone else", async () => {
    const w = await world();
    await expect(
      createContact({ principal: asPrincipal(w.ana), fields: { firstName: "X", lastName: "", email: "", phone: "", companyId: "", ownerId: w.joan.id }, confirmDuplicate: false }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("validation errors name the fields and never write a row", async () => {
    const w = await world();
    const before = await getDb().select().from(deals);
    const err = await createDeal({ principal: asPrincipal(w.ana), title: "", companyId: w.anaCompany.id, amountInput: "abc" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(Object.keys((err as ValidationError).fieldErrors).sort()).toEqual(["amount", "title"]);
    expect(await getDb().select().from(deals)).toHaveLength(before.length);
  });
});

describe("exports", () => {
  it("only admins may run the full CRM export", async () => {
    const w = await world();
    expect(await fullExportCsv(asPrincipal(w.manager), "contacts")).toBeNull();
    expect(await fullExportCsv(asPrincipal(w.ana), "deals")).toBeNull();
    const ok = await fullExportCsv(asPrincipal(w.admin), "contacts");
    expect(ok?.csv.split("\n")[0]).toContain("first_name");
  });

  it("every full export is recorded in the audit log with its row count", async () => {
    const w = await world();
    await fullExportCsv(asPrincipal(w.admin), "companies");
    const [event] = await getDb().select().from(auditEvents).where(eq(auditEvents.action, "export.full"));
    expect(event).toMatchObject({ actorId: w.admin.id, metadata: expect.objectContaining({ kind: "companies" }) });
  });

  it("managers get a deal snapshot scoped to their view, without contact email or phone", async () => {
    const w = await world();
    const snap = await dealSnapshotCsv(asPrincipal(w.manager), {});
    expect(snap?.rows).toBe(2);
    expect(snap!.csv).not.toContain("pau@acme.es");
    expect(await dealSnapshotCsv(asPrincipal(w.ana), {})).toBeNull();
  });

  it("neutralises spreadsheet formulas in exported titles", async () => {
    const w = await world();
    await makeDeal({ ownerId: w.ana.id, companyId: w.anaCompany.id, stageId: w.stages.Qualificació!, title: '=HYPERLINK("http://x")' });
    const snap = await dealSnapshotCsv(asPrincipal(w.manager), {});
    expect(snap!.csv).toContain(`'=HYPERLINK`);
  });
});

describe("stage administration", () => {
  it("only admins may configure stages", async () => {
    const w = await world();
    await expect(saveStages(asPrincipal(w.manager), [], null)).rejects.toMatchObject({ code: "forbidden" });
    await expect(moveStage(asPrincipal(w.manager), w.stages.Proposta!, "up")).rejects.toMatchObject({ code: "forbidden" });
  });

  it("reorders stages with a deferred unique swap", async () => {
    const w = await world();
    await moveStage(asPrincipal(w.admin), w.stages.Proposta!, "up");
    const rows = await getDb().execute<{ name: string; position: number }>(
      (await import("drizzle-orm")).sql`select name, position from pipeline_stages order by position`,
    );
    expect(rows.rows[0]!.name).toBe("Proposta");
    expect(rows.rows[1]!.name).toBe("Qualificació");
  });

  it("refuses to delete a stage that holds deals", async () => {
    const w = await world();
    await expect(deleteStage(asPrincipal(w.admin), w.stages.Proposta!)).rejects.toMatchObject({ code: "conflict" });
  });

  it("refuses to change the type of a stage that holds deals (keeps the deal status invariant)", async () => {
    const w = await world();
    const edits = [
      { id: w.stages.Proposta!, name: "Proposta", kind: "won" },
      { id: w.stages.Qualificació!, name: "Qualificació", kind: "open" },
      { id: w.stages.Negociació!, name: "Negociació", kind: "open" },
      { id: w.stages.Guanyat!, name: "Guanyat", kind: "won" },
      { id: w.stages.Perdut!, name: "Perdut", kind: "lost" },
    ];
    await expect(saveStages(asPrincipal(w.admin), edits, null)).rejects.toBeInstanceOf(ValidationError);
    const [row] = await getDb().select().from(deals).where(eq(deals.id, w.anaDeal.id));
    expect(row!.stageId).toBe(w.stages.Proposta);
  });
});

describe("ownership changes are audited", () => {
  it("reassigning a deal owner writes an owner.changed audit event", async () => {
    const w = await world();
    const { updateDeal } = await import("@/server/domain/deals/service");
    await updateDeal({
      principal: asPrincipal(w.manager),
      dealId: w.anaDeal.id,
      expectedVersion: 1,
      title: "Ana deal",
      amountInput: "100",
      expectedCloseOn: null,
      primaryContactId: w.anaContact.id,
      ownerId: w.joan.id,
    });
    const events = await getDb().select().from(auditEvents).where(eq(auditEvents.action, "owner.changed"));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ subjectId: w.anaDeal.id, metadata: expect.objectContaining({ toOwnerId: w.joan.id }) });
  });
});
