import { and, eq, sql } from "drizzle-orm";
import { getDb, withTx, type Tx } from "@/server/db/client";
import { activities, contacts, deals, inboundEmails } from "@/server/db/schema";
import { canManageEmailCapture, type Principal } from "@/server/authz/policy";
import { conflict, notFound, ValidationError } from "@/server/errors";
import { recordAudit } from "@/server/domain/audit";
import { normalizeEmail } from "@/server/normalize";
import { cleanMultiline, cleanText, isUuid } from "@/server/security/guards";
import { logger } from "@/server/log/logger";

export interface InboundPayload {
  messageId: string;
  receivedAt: string;
  from: string;
  to: string;
  subject: string;
  text: string;
}

export type CaptureOutcome =
  | { status: "duplicate"; inboundId: string | null }
  | { status: "captured"; inboundId: string; activityId: string; contactId: string; dealId: string | null }
  | { status: "ambiguous"; inboundId: string; candidates: number }
  | { status: "unmatched"; inboundId: string };

export function parseInboundPayload(raw: unknown): { ok: true; value: InboundPayload } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const r = (raw ?? {}) as Record<string, unknown>;
  const messageId = typeof r.messageId === "string" ? r.messageId.trim() : "";
  if (!messageId || messageId.length > 200 || !/^[\x21-\x7e]+$/.test(messageId)) errors.messageId = "invalid";
  const receivedAt = typeof r.receivedAt === "string" && !Number.isNaN(Date.parse(r.receivedAt)) ? r.receivedAt : "";
  if (!receivedAt) errors.receivedAt = "invalid";
  const from = typeof r.from === "string" ? normalizeEmail(r.from) : null;
  if (!from) errors.from = "invalid";
  const to = typeof r.to === "string" ? cleanText(r.to, 254) : null;
  if (!to) errors.to = "required";
  const subject = typeof r.subject === "string" ? (cleanText(r.subject, 200) ?? "") : "";
  const text = typeof r.text === "string" ? (cleanMultiline(r.text, 5000) ?? "") : "";
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { messageId, receivedAt, from: from!, to: to!, subject, text } };
}

/**
 * Capture a BCC/forwarded email. Idempotent per provider message id: a redelivery returns
 * `duplicate` and creates nothing. The inbound row and (when matched) the activity are written in
 * one transaction. An ambiguous sender (several active contacts) is never auto-attached.
 */
export async function captureInboundEmail(payload: InboundPayload, rawSha256: string, requestId?: string | null): Promise<CaptureOutcome> {
  return withTx(async (tx) => {
    const inserted = await tx
      .insert(inboundEmails)
      .values({
        providerMessageId: payload.messageId,
        receivedAt: new Date(payload.receivedAt),
        fromNormalized: payload.from,
        toAddress: payload.to,
        subject: payload.subject,
        bodyExcerpt: payload.text,
        status: "unmatched",
        rawSha256,
      })
      .onConflictDoNothing({ target: inboundEmails.providerMessageId })
      .returning({ id: inboundEmails.id });

    if (inserted.length === 0) {
      const [existing] = await tx.select({ id: inboundEmails.id }).from(inboundEmails).where(eq(inboundEmails.providerMessageId, payload.messageId)).limit(1);
      logger.info("email.capture_duplicate", { messageId: payload.messageId, requestId });
      return { status: "duplicate", inboundId: existing?.id ?? null };
    }
    const inboundId = inserted[0]!.id;

    const matches = await tx
      .select({ id: contacts.id, companyId: contacts.companyId, ownerId: contacts.ownerId })
      .from(contacts)
      .where(and(eq(contacts.emailNormalized, payload.from), eq(contacts.status, "active")))
      .limit(3);

    if (matches.length === 0) {
      logger.info("email.capture_unmatched", { inboundId, requestId });
      return { status: "unmatched", inboundId };
    }
    if (matches.length > 1) {
      await tx.update(inboundEmails).set({ status: "ambiguous" }).where(eq(inboundEmails.id, inboundId));
      logger.info("email.capture_ambiguous", { inboundId, candidates: matches.length, requestId });
      return { status: "ambiguous", inboundId, candidates: matches.length };
    }

    const contact = matches[0]!;
    const openDeals = await tx
      .select({ id: deals.id })
      .from(deals)
      .where(and(eq(deals.primaryContactId, contact.id), eq(deals.status, "open"), sql`${deals.archivedAt} is null`))
      .limit(2);
    const dealId = openDeals.length === 1 ? openDeals[0]!.id : null;

    const activityId = await attachEmailActivity(tx, {
      contactId: contact.id,
      companyId: contact.companyId,
      dealId,
      externalMessageId: payload.messageId,
      occurredAt: new Date(payload.receivedAt),
      subject: payload.subject,
      text: payload.text,
    });

    await tx
      .update(inboundEmails)
      .set({ status: "captured", matchedContactId: contact.id, matchedDealId: dealId, activityId })
      .where(eq(inboundEmails.id, inboundId));

    logger.info("email.captured", { inboundId, activityId, dealAttached: dealId !== null, requestId });
    return { status: "captured", inboundId, activityId, contactId: contact.id, dealId };
  });
}

async function attachEmailActivity(
  tx: Tx,
  input: {
    contactId: string;
    companyId: string | null;
    dealId: string | null;
    externalMessageId: string;
    occurredAt: Date;
    subject: string;
    text: string;
  },
): Promise<string> {
  const body = [input.subject ? `Subject: ${input.subject}` : null, input.text].filter(Boolean).join("\n\n").slice(0, 5000);
  const [row] = await tx
    .insert(activities)
    .values({
      kind: "email",
      source: "bcc",
      contactId: input.contactId,
      companyId: input.companyId,
      dealId: input.dealId,
      body,
      occurredAt: input.occurredAt,
      externalMessageId: input.externalMessageId,
    })
    .onConflictDoNothing({ target: activities.externalMessageId })
    .returning({ id: activities.id });
  if (row) return row.id;
  const [existing] = await tx.select({ id: activities.id }).from(activities).where(eq(activities.externalMessageId, input.externalMessageId)).limit(1);
  return existing!.id;
}

/** Manager/admin attaches an ambiguous or unmatched email to a chosen contact (and optional deal). */
export async function matchInboundEmail(input: {
  principal: Principal;
  inboundId: string;
  contactId: string;
  dealId: string | null;
  requestId?: string | null;
}): Promise<void> {
  if (!canManageEmailCapture(input.principal)) throw notFound("Email");
  if (!isUuid(input.contactId) || (input.dealId && !isUuid(input.dealId))) throw new ValidationError({ contactId: "invalid" });

  await withTx(async (tx) => {
    const [mail] = await tx.select().from(inboundEmails).where(eq(inboundEmails.id, input.inboundId)).for("update").limit(1);
    if (!mail) throw notFound("Email");
    if (mail.status !== "ambiguous" && mail.status !== "unmatched") throw conflict("This email is already matched or discarded");

    const [contact] = await tx.select().from(contacts).where(and(eq(contacts.id, input.contactId), eq(contacts.status, "active"))).limit(1);
    if (!contact) throw new ValidationError({ contactId: "not_found" }, "Choose an active contact");

    let dealId: string | null = null;
    if (input.dealId) {
      const [deal] = await tx.select().from(deals).where(and(eq(deals.id, input.dealId), eq(deals.primaryContactId, contact.id))).limit(1);
      if (!deal) throw new ValidationError({ dealId: "not_for_contact" }, "The deal must belong to the chosen contact");
      dealId = deal.id;
    }

    const activityId = await attachEmailActivity(tx, {
      contactId: contact.id,
      companyId: contact.companyId,
      dealId,
      externalMessageId: `manual:${mail.providerMessageId}`,
      occurredAt: mail.receivedAt,
      subject: mail.subject,
      text: mail.bodyExcerpt,
    });

    await tx
      .update(inboundEmails)
      .set({ status: "manually_matched", matchedContactId: contact.id, matchedDealId: dealId, activityId })
      .where(eq(inboundEmails.id, mail.id));

    await recordAudit(tx, {
      actorId: input.principal.userId,
      action: "email.manually_matched",
      subjectType: "inbound_email",
      subjectId: mail.id,
      metadata: { contactId: contact.id, dealId, activityId },
      requestId: input.requestId ?? null,
    });
  });
}

export async function discardInboundEmail(principal: Principal, inboundId: string, requestId?: string | null): Promise<void> {
  if (!canManageEmailCapture(principal)) throw notFound("Email");
  await withTx(async (tx) => {
    const [mail] = await tx.select().from(inboundEmails).where(eq(inboundEmails.id, inboundId)).for("update").limit(1);
    if (!mail) throw notFound("Email");
    if (mail.status !== "ambiguous" && mail.status !== "unmatched") return;
    await tx.update(inboundEmails).set({ status: "discarded" }).where(eq(inboundEmails.id, inboundId));
    await recordAudit(tx, { actorId: principal.userId, action: "email.discarded", subjectType: "inbound_email", subjectId: inboundId, requestId: requestId ?? null });
  });
}
