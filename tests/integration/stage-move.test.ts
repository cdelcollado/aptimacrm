import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { activities, auditEvents, deals } from "@/server/db/schema";
import { moveDealStage } from "@/server/domain/deals/stage-service";
import { makeCompany, makeDeal, makeStages, makeUser } from "../helpers/db";
import { asPrincipal } from "../helpers/principal";

async function setup() {
  const ana = await makeUser("salesperson", "Ana Ruiz");
  const joan = await makeUser("salesperson", "Joan Puig");
  const manager = await makeUser("manager", "Marc Soler");
  const company = await makeCompany(ana.id, "Acme", "acme.es");
  const stages = await makeStages();
  const deal = await makeDeal({ ownerId: ana.id, companyId: company.id, stageId: stages.Qualificació!, amountCents: 1250000 });
  return { ana, joan, manager, company, stages, deal };
}

describe("moveDealStage", () => {
  it("moves the deal, appends one stage_change activity and one audit event, and bumps the version", async () => {
    const { ana, deal, stages } = await setup();
    const result = await moveDealStage({ dealId: deal.id, toStageId: stages.Proposta!, expectedVersion: 1, principal: asPrincipal(ana) });

    expect(result).toMatchObject({ changed: true, fromStageName: "Qualificació", toStageName: "Proposta", version: 2 });
    const [row] = await getDb().select().from(deals).where(eq(deals.id, deal.id));
    expect(row).toMatchObject({ stageId: stages.Proposta, status: "open", version: 2 });

    const changes = await getDb().select().from(activities).where(eq(activities.kind, "stage_change"));
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ fromStageId: stages.Qualificació, toStageId: stages.Proposta, actorId: ana.id, dealId: deal.id });

    const audits = await getDb().select().from(auditEvents).where(eq(auditEvents.action, "stage.changed"));
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actorId: ana.id, subjectId: deal.id });
  });

  it("is a no-op when the deal is already in the target stage", async () => {
    const { ana, deal, stages } = await setup();
    const result = await moveDealStage({ dealId: deal.id, toStageId: stages.Qualificació!, expectedVersion: 1, principal: asPrincipal(ana) });
    expect(result.changed).toBe(false);
    expect(await getDb().select().from(activities).where(eq(activities.kind, "stage_change"))).toHaveLength(0);
  });

  it("rejects a stale version with a conflict and changes nothing", async () => {
    const { ana, deal, stages } = await setup();
    await moveDealStage({ dealId: deal.id, toStageId: stages.Proposta!, expectedVersion: 1, principal: asPrincipal(ana) });
    await expect(moveDealStage({ dealId: deal.id, toStageId: stages.Negociació!, expectedVersion: 1, principal: asPrincipal(ana) })).rejects.toMatchObject({ code: "conflict" });
    const [row] = await getDb().select().from(deals).where(eq(deals.id, deal.id));
    expect(row!.stageId).toBe(stages.Proposta);
  });

  it("returns not-found for a salesperson who does not own the deal (no existence leak)", async () => {
    const { joan, deal, stages } = await setup();
    await expect(moveDealStage({ dealId: deal.id, toStageId: stages.Proposta!, expectedVersion: 1, principal: asPrincipal(joan) })).rejects.toMatchObject({ code: "not_found" });
  });

  it("lets a manager move any deal", async () => {
    const { manager, deal, stages } = await setup();
    const result = await moveDealStage({ dealId: deal.id, toStageId: stages.Proposta!, expectedVersion: 1, principal: asPrincipal(manager) });
    expect(result.changed).toBe(true);
  });

  it("refuses to reopen a won deal for a salesperson and requires a reason for a manager", async () => {
    const { ana, manager, company, stages } = await setup();
    const won = await makeDeal({ ownerId: ana.id, companyId: company.id, stageId: stages.Guanyat!, status: "won" });
    await expect(moveDealStage({ dealId: won.id, toStageId: stages.Qualificació!, expectedVersion: 1, principal: asPrincipal(ana), reason: "motiu" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(moveDealStage({ dealId: won.id, toStageId: stages.Qualificació!, expectedVersion: 1, principal: asPrincipal(manager) })).rejects.toMatchObject({ code: "validation" });
    const reopened = await moveDealStage({ dealId: won.id, toStageId: stages.Qualificació!, expectedVersion: 1, principal: asPrincipal(manager), reason: "El client ha tornat" });
    expect(reopened.changed).toBe(true);
    const [row] = await getDb().select().from(deals).where(eq(deals.id, won.id));
    expect(row).toMatchObject({ status: "open", closedAt: null });
  });

  it("closes the deal and records closed_at when it moves to won", async () => {
    const { ana, deal, stages } = await setup();
    await moveDealStage({ dealId: deal.id, toStageId: stages.Guanyat!, expectedVersion: 1, principal: asPrincipal(ana) });
    const [row] = await getDb().select().from(deals).where(eq(deals.id, deal.id));
    expect(row).toMatchObject({ status: "won" });
    expect(row!.closedAt).toBeInstanceOf(Date);
  });

  it("is atomic: a failure after the deal row changed leaves deal, history and audit untouched", async () => {
    const { ana, deal, stages } = await setup();
    await expect(
      moveDealStage({
        dealId: deal.id,
        toStageId: stages.Proposta!,
        expectedVersion: 1,
        principal: asPrincipal(ana),
        afterDealUpdate: () => {
          throw new Error("simulated crash after the deal update");
        },
      }),
    ).rejects.toThrow("simulated crash");

    const [row] = await getDb().select().from(deals).where(eq(deals.id, deal.id));
    expect(row).toMatchObject({ stageId: stages.Qualificació, version: 1 });
    expect(await getDb().select().from(activities).where(eq(activities.kind, "stage_change"))).toHaveLength(0);
    expect(await getDb().select().from(auditEvents).where(eq(auditEvents.action, "stage.changed"))).toHaveLength(0);
  });

  it("lets exactly one of two concurrent moves with the same version win", async () => {
    const { ana, deal, stages } = await setup();
    const results = await Promise.allSettled([
      moveDealStage({ dealId: deal.id, toStageId: stages.Proposta!, expectedVersion: 1, principal: asPrincipal(ana) }),
      moveDealStage({ dealId: deal.id, toStageId: stages.Negociació!, expectedVersion: 1, principal: asPrincipal(ana) }),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toMatchObject({ code: "conflict" });
    expect(await getDb().select().from(activities).where(eq(activities.kind, "stage_change"))).toHaveLength(1);
  });
});
