import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { activities, inboundEmails } from "@/server/db/schema";
import { captureInboundEmail, matchInboundEmail, parseInboundPayload } from "@/server/domain/email-capture";
import { makeCompany, makeContact, makeDeal, makeStages, makeUser } from "../helpers/db";
import { asPrincipal } from "../helpers/principal";

const payload = (messageId: string, from = "pau.vidal@acme.es") => ({
  messageId,
  receivedAt: "2026-10-25T09:00:00Z",
  from,
  to: "capture@crm.example.com",
  subject: "Re: proposta",
  text: "Ens sembla bé el preu.",
});

async function setup() {
  const ana = await makeUser("salesperson", "Ana Ruiz");
  const manager = await makeUser("manager", "Marc Soler");
  const company = await makeCompany(ana.id, "Acme", "acme.es");
  const stages = await makeStages();
  const pau = await makeContact(ana.id, "Pau", "pau.vidal@acme.es", company.id);
  const deal = await makeDeal({ ownerId: ana.id, companyId: company.id, stageId: stages.Proposta!, primaryContactId: pau.id });
  return { ana, manager, company, pau, deal };
}

describe("BCC capture idempotency (acceptance scenario 3)", () => {
  it("delivered twice: one inbound row and one activity on the matched contact", async () => {
    const { pau, deal } = await setup();
    const first = await captureInboundEmail(payload("msg-123"), "a".repeat(64));
    const second = await captureInboundEmail(payload("msg-123"), "a".repeat(64));

    expect(first).toMatchObject({ status: "captured", contactId: pau.id, dealId: deal.id });
    expect(second).toMatchObject({ status: "duplicate" });

    expect(await getDb().select().from(inboundEmails)).toHaveLength(1);
    const emails = await getDb().select().from(activities).where(eq(activities.kind, "email"));
    expect(emails).toHaveLength(1);
    expect(emails[0]).toMatchObject({ source: "bcc", contactId: pau.id, dealId: deal.id, externalMessageId: "msg-123" });
  });

  it("an ambiguous sender (two active contacts) creates no activity and waits for a manual match", async () => {
    const { ana, company, deal, manager } = await setup();
    await makeContact(ana.id, "Pau dos", "pau.vidal@acme.es", company.id);
    const outcome = await captureInboundEmail(payload("msg-amb"), "b".repeat(64));
    expect(outcome).toMatchObject({ status: "ambiguous", candidates: 2 });
    expect(await getDb().select().from(activities).where(eq(activities.kind, "email"))).toHaveLength(0);

    const [mail] = await getDb().select().from(inboundEmails).where(eq(inboundEmails.providerMessageId, "msg-amb"));
    await matchInboundEmail({ principal: asPrincipal(manager), inboundId: mail!.id, contactId: (await getDb().query.contacts.findFirst({ where: (c, { eq: e }) => e(c.firstName, "Pau") }))!.id, dealId: deal.id });
    const after = await getDb().select().from(activities).where(eq(activities.kind, "email"));
    expect(after).toHaveLength(1);
    expect(after[0]!.externalMessageId).toBe("manual:msg-amb");
  });

  it("an unknown sender is kept as unmatched and creates nothing", async () => {
    await setup();
    const outcome = await captureInboundEmail(payload("msg-unk", "stranger@elsewhere.example"), "c".repeat(64));
    expect(outcome.status).toBe("unmatched");
    expect(await getDb().select().from(activities).where(eq(activities.kind, "email"))).toHaveLength(0);
  });

  it("attaches to the contact but not a deal when the contact has several open deals", async () => {
    const { ana, company, pau } = await setup();
    const stages = await makeStages();
    await makeDeal({ ownerId: ana.id, companyId: company.id, stageId: stages.Qualificació!, primaryContactId: pau.id, title: "Segona" });
    const outcome = await captureInboundEmail(payload("msg-two-deals"), "d".repeat(64));
    expect(outcome).toMatchObject({ status: "captured", dealId: null });
  });

  it("does not attach a manual match to a deal that belongs to another contact", async () => {
    const { ana, manager, company, pau } = await setup();
    const other = await makeContact(ana.id, "Altre", "altre@acme.es", company.id);
    const stages = await makeStages();
    const otherDeal = await makeDeal({ ownerId: ana.id, companyId: company.id, stageId: stages.Proposta!, primaryContactId: other.id });
    await makeContact(ana.id, "Pau dos", "pau.vidal@acme.es", company.id);
    await captureInboundEmail(payload("msg-mismatch"), "e".repeat(64));
    const [mail] = await getDb().select().from(inboundEmails).where(eq(inboundEmails.providerMessageId, "msg-mismatch"));
    await expect(matchInboundEmail({ principal: asPrincipal(manager), inboundId: mail!.id, contactId: pau.id, dealId: otherDeal.id })).rejects.toMatchObject({ code: "validation" });
  });

  it("validates the inbound payload shape", () => {
    expect(parseInboundPayload({ messageId: "", from: "bad", to: "" }).ok).toBe(false);
    expect(parseInboundPayload({ messageId: "ok-1", receivedAt: "2026-10-25T09:00:00Z", from: "A@B.es", to: "x@y.es", subject: "s", text: "t" }).ok).toBe(true);
  });
});
