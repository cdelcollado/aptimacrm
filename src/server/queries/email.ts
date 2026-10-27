import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { contacts, inboundEmails } from "@/server/db/schema";

export async function listPendingEmails() {
  return getDb()
    .select({
      id: inboundEmails.id,
      status: inboundEmails.status,
      receivedAt: inboundEmails.receivedAt,
      fromNormalized: inboundEmails.fromNormalized,
      subject: inboundEmails.subject,
      bodyExcerpt: inboundEmails.bodyExcerpt,
    })
    .from(inboundEmails)
    .where(inArray(inboundEmails.status, ["ambiguous", "unmatched"]))
    .orderBy(desc(inboundEmails.receivedAt))
    .limit(100);
}

export async function listContactsForMatching() {
  return getDb()
    .select({ id: contacts.id, firstName: contacts.firstName, lastName: contacts.lastName, email: contacts.email })
    .from(contacts)
    .where(and(eq(contacts.status, "active")))
    .orderBy(contacts.firstName)
    .limit(500);
}
