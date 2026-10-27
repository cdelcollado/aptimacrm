import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getDb } from "@/server/db/client";
import { activities, companies, contacts, deals, inboundEmails, pipelineStages, tasks, users } from "@/server/db/schema";
import { canRead, canMutate, type Principal } from "@/server/authz/policy";
import { activityVisibility, dealVisibility } from "@/server/queries/visibility";
import { getConfig } from "@/server/config";

/**
 * Deal detail: context, stage and value, activity timeline (with corrections linked to their
 * originals), open and completed tasks, and BCC capture status. Anything the principal cannot
 * read returns null, which the page renders as not-found.
 */
export async function getDealDetail(principal: Principal, dealId: string) {
  const db = getDb();
  const owner = alias(users, "owner");
  const [row] = await db
    .select({
      deal: deals,
      stageName: pipelineStages.name,
      stageKind: pipelineStages.kind,
      companyName: companies.name,
      companyOwnerId: companies.ownerId,
      contactFirst: contacts.firstName,
      contactLast: contacts.lastName,
      contactEmail: contacts.email,
      ownerName: owner.name,
    })
    .from(deals)
    .innerJoin(pipelineStages, eq(pipelineStages.id, deals.stageId))
    .innerJoin(companies, eq(companies.id, deals.companyId))
    .leftJoin(contacts, eq(contacts.id, deals.primaryContactId))
    .innerJoin(owner, eq(owner.id, deals.ownerId))
    .where(and(eq(deals.id, dealId), dealVisibility(principal)))
    .limit(1);
  if (!row) return null;

  const timeline = await db
    .select({
      id: activities.id,
      kind: activities.kind,
      source: activities.source,
      body: activities.body,
      occurredAt: activities.occurredAt,
      createdAt: activities.createdAt,
      actorName: users.name,
      fromStageId: activities.fromStageId,
      toStageId: activities.toStageId,
      correctsActivityId: activities.correctsActivityId,
      correctionReason: activities.correctionReason,
      originalBody: activities.originalBody,
      metadata: activities.metadata,
    })
    .from(activities)
    .leftJoin(users, eq(users.id, activities.actorId))
    .where(and(eq(activities.dealId, dealId), activityVisibility(principal)))
    .orderBy(desc(activities.occurredAt), desc(activities.createdAt))
    .limit(300);

  const stageNames = await db.select({ id: pipelineStages.id, name: pipelineStages.name }).from(pipelineStages).orderBy(asc(pipelineStages.position));

  const dealTasks = await db
    .select({ id: tasks.id, title: tasks.title, dueOn: tasks.dueOn, dueAt: tasks.dueAt, status: tasks.status, version: tasks.version, ownerId: tasks.ownerId })
    .from(tasks)
    .where(eq(tasks.dealId, dealId))
    .orderBy(asc(tasks.dueAt));

  const captured = await db
    .select({ id: inboundEmails.id, receivedAt: inboundEmails.receivedAt, subject: inboundEmails.subject })
    .from(inboundEmails)
    .where(and(eq(inboundEmails.matchedDealId, dealId), inArray(inboundEmails.status, ["captured", "manually_matched"])))
    .orderBy(desc(inboundEmails.receivedAt))
    .limit(5);

  const companyVisible = canRead(principal, { ownerId: row.companyOwnerId });
  return {
    deal: row.deal,
    stageName: row.stageName,
    stageKind: row.stageKind,
    stageNames,
    companyName: companyVisible ? row.companyName : "[restricted]",
    companyVisible,
    contact: row.contactFirst ? { name: `${row.contactFirst} ${row.contactLast}`.trim(), email: row.contactEmail } : null,
    ownerName: row.ownerName,
    canMutate: canMutate(principal, row.deal),
    timeline,
    tasks: dealTasks,
    captured,
    bccAddress: getConfig().inboundEmailAddress,
    emailCaptureStatus: row.contactEmail ? "ready" : "no_contact_email",
  };
}


