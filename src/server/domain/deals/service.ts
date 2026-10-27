import { and, asc, eq, isNull } from "drizzle-orm";
import { getConfig } from "@/server/config";
import { getDb, withTx } from "@/server/db/client";
import { activities, companies, contacts, deals, pipelineStages, tasks, users } from "@/server/db/schema";
import { canMutate, canReassign, canRestore, type Principal } from "@/server/authz/policy";
import { conflict, forbidden, notFound, ValidationError } from "@/server/errors";
import { recordAudit } from "@/server/domain/audit";
import { taskDueInstant, zonedLocalToInstant } from "@/server/domain/time";
import { cleanMultiline, cleanText, parseEuroToCents, parseIsoDate } from "@/server/security/guards";

const MAX_BODY = 5000;

/* ---------- helpers ---------- */

async function loadVisibleDeal(principal: Principal, dealId: string) {
  const [deal] = await getDb().select().from(deals).where(eq(deals.id, dealId)).limit(1);
  if (!deal || !canMutate(principal, deal)) throw notFound("Deal");
  return deal;
}

async function activeUserOrThrow(userId: string) {
  const [user] = await getDb().select().from(users).where(and(eq(users.id, userId), eq(users.active, true))).limit(1);
  if (!user) throw new ValidationError({ ownerId: "unknown_user" }, "Owner must be an active user");
  return user;
}

export async function firstOpenStage() {
  const [stage] = await getDb()
    .select()
    .from(pipelineStages)
    .where(eq(pipelineStages.kind, "open"))
    .orderBy(asc(pipelineStages.position))
    .limit(1);
  if (!stage) throw new ValidationError({ stageId: "no_open_stage" }, "The pipeline has no open stage");
  return stage;
}

/* ---------- deals ---------- */

export interface CreateDealInput {
  principal: Principal;
  title: string;
  companyId: string;
  primaryContactId?: string | null;
  ownerId?: string | null;
  stageId?: string | null;
  amountInput?: string | null;
  expectedCloseOn?: string | null;
  requestId?: string | null;
}

export async function createDeal(input: CreateDealInput): Promise<{ id: string }> {
  const { principal } = input;
  const errors: Record<string, string> = {};

  const title = cleanText(input.title, 200);
  if (!title) errors.title = "required";

  const amountCents = parseEuroToCents(input.amountInput ?? "");
  if (amountCents === null) errors.amount = "invalid";

  const expectedCloseOn = input.expectedCloseOn ? parseIsoDate(input.expectedCloseOn) : null;
  if (input.expectedCloseOn && !expectedCloseOn) errors.expectedCloseOn = "invalid";

  const db = getDb();
  const [company] = await db.select().from(companies).where(eq(companies.id, input.companyId)).limit(1);
  if (!company || company.status !== "active" || !canMutate(principal, company)) {
    throw notFound("Company");
  }

  let primaryContactId: string | null = null;
  if (input.primaryContactId) {
    const [contact] = await db.select().from(contacts).where(eq(contacts.id, input.primaryContactId)).limit(1);
    if (!contact || contact.status !== "active" || !canMutate(principal, contact)) {
      errors.primaryContactId = "not_found";
    } else if (contact.companyId !== company.id) {
      errors.primaryContactId = "different_company";
    } else {
      primaryContactId = contact.id;
    }
  }

  let ownerId = principal.userId;
  if (input.ownerId && input.ownerId !== principal.userId) {
    if (!canReassign(principal)) throw forbidden("Salespeople can only create deals they own");
    try {
      ownerId = (await activeUserOrThrow(input.ownerId)).id;
    } catch {
      errors.ownerId = "unknown_user";
    }
  }

  let stageId: string;
  if (input.stageId) {
    const [stage] = await db.select().from(pipelineStages).where(eq(pipelineStages.id, input.stageId)).limit(1);
    if (!stage) errors.stageId = "unknown_stage";
    stageId = stage?.id ?? "";
  } else {
    stageId = (await firstOpenStage()).id;
  }

  if (Object.keys(errors).length > 0) throw new ValidationError(errors);

  const [stage] = await db.select().from(pipelineStages).where(eq(pipelineStages.id, stageId)).limit(1);
  const status = stage!.kind;

  return withTx(async (tx) => {
    const [deal] = await tx
      .insert(deals)
      .values({
        title: title!,
        companyId: company.id,
        primaryContactId,
        ownerId,
        stageId,
        status,
        amountCents: amountCents!,
        expectedCloseOn,
        closedAt: status === "open" ? null : new Date(),
      })
      .returning({ id: deals.id });

    await tx.insert(activities).values({
      kind: "system",
      source: "system",
      dealId: deal!.id,
      companyId: company.id,
      contactId: primaryContactId,
      actorId: principal.userId,
      body: title!,
      toStageId: stageId,
      metadata: { event: "deal_created" },
    });

    await recordAudit(tx, {
      actorId: principal.userId,
      action: "deal.created",
      subjectType: "deal",
      subjectId: deal!.id,
      metadata: { ownerId, stageId, companyId: company.id },
      requestId: input.requestId ?? null,
    });

    return { id: deal!.id };
  });
}

export interface UpdateDealInput {
  principal: Principal;
  dealId: string;
  expectedVersion: number;
  title: string;
  amountInput: string;
  expectedCloseOn: string | null;
  primaryContactId: string | null;
  ownerId: string | null;
  requestId?: string | null;
}

/** Edits everything except stage (which is only changed by moveDealStage). */
export async function updateDeal(input: UpdateDealInput): Promise<void> {
  const errors: Record<string, string> = {};
  const title = cleanText(input.title, 200);
  if (!title) errors.title = "required";
  const amountCents = parseEuroToCents(input.amountInput);
  if (amountCents === null) errors.amount = "invalid";
  const expectedCloseOn = input.expectedCloseOn ? parseIsoDate(input.expectedCloseOn) : null;
  if (input.expectedCloseOn && !expectedCloseOn) errors.expectedCloseOn = "invalid";
  if (Object.keys(errors).length) throw new ValidationError(errors);

  const current = await loadVisibleDeal(input.principal, input.dealId);
  if (current.version !== input.expectedVersion) throw conflict("Deal changed by someone else; reload and try again");

  let ownerId = current.ownerId;
  if (input.ownerId && input.ownerId !== current.ownerId) {
    if (!canReassign(input.principal)) throw forbidden("Only managers can change the owner");
    ownerId = (await activeUserOrThrow(input.ownerId)).id;
  }

  await withTx(async (tx) => {
    const [updated] = await tx
      .update(deals)
      .set({
        title: title!,
        amountCents: amountCents!,
        expectedCloseOn,
        primaryContactId: input.primaryContactId || null,
        ownerId,
        version: current.version + 1,
        updatedAt: new Date(),
      })
      .where(and(eq(deals.id, current.id), eq(deals.version, input.expectedVersion)))
      .returning({ id: deals.id });
    if (!updated) throw conflict("Deal changed while saving; reload and try again");

    if (ownerId !== current.ownerId) {
      await recordAudit(tx, {
        actorId: input.principal.userId,
        action: "owner.changed",
        subjectType: "deal",
        subjectId: current.id,
        metadata: { fromOwnerId: current.ownerId, toOwnerId: ownerId },
        requestId: input.requestId ?? null,
      });
    }
  });
}

export async function setDealArchived(principal: Principal, dealId: string, archived: boolean, requestId?: string | null) {
  if (!archived && !canRestore(principal)) throw forbidden("Only managers can restore records");
  const deal = await loadVisibleDeal(principal, dealId);
  await withTx(async (tx) => {
    await tx
      .update(deals)
      .set({ archivedAt: archived ? new Date() : null, version: deal.version + 1, updatedAt: new Date() })
      .where(eq(deals.id, deal.id));
    await recordAudit(tx, {
      actorId: principal.userId,
      action: archived ? "deal.archived" : "deal.restored",
      subjectType: "deal",
      subjectId: deal.id,
      requestId: requestId ?? null,
    });
  });
}

/* ---------- activities ---------- */

export type ActivityKind = "note" | "call" | "email";

export interface LogActivityInput {
  principal: Principal;
  dealId: string;
  kind: ActivityKind;
  body: string;
  /** Local wall-clock time in the org zone, "YYYY-MM-DDTHH:mm", or empty for now. */
  occurredLocal?: string | null;
  requestId?: string | null;
}

export async function logActivity(input: LogActivityInput): Promise<{ id: string }> {
  const body = cleanMultiline(input.body, MAX_BODY);
  if (!body) throw new ValidationError({ body: "required" });
  if (!["note", "call", "email"].includes(input.kind)) throw new ValidationError({ kind: "invalid" });

  const deal = await loadVisibleDeal(input.principal, input.dealId);

  let occurredAt = new Date();
  if (input.occurredLocal) {
    const parsed = zonedLocalToInstant(input.occurredLocal, getConfig().orgTimezone);
    if (!parsed) throw new ValidationError({ occurredLocal: "invalid" });
    if (parsed.getTime() > Date.now() + 5 * 60_000) throw new ValidationError({ occurredLocal: "future" });
    occurredAt = parsed;
  }

  const [row] = await getDb()
    .insert(activities)
    .values({
      kind: input.kind,
      source: "manual",
      dealId: deal.id,
      companyId: deal.companyId,
      contactId: deal.primaryContactId,
      actorId: input.principal.userId,
      body,
      occurredAt,
    })
    .returning({ id: activities.id });
  return { id: row!.id };
}

export interface CorrectActivityInput {
  principal: Principal;
  activityId: string;
  newBody: string;
  reason: string;
  requestId?: string | null;
}

/**
 * Corrections never edit the original row (activities are append-only). They insert a
 * correction that keeps the original body verbatim, the editor, the reason and the time.
 * An activity can be corrected once; a second correction would hide the first one's history.
 */
export async function correctActivity(input: CorrectActivityInput): Promise<{ id: string }> {
  const newBody = cleanMultiline(input.newBody, MAX_BODY);
  const reason = cleanText(input.reason, 300);
  const errors: Record<string, string> = {};
  if (!newBody) errors.newBody = "required";
  if (!reason || reason.length < 3) errors.reason = "required";
  if (Object.keys(errors).length) throw new ValidationError(errors);

  return withTx(async (tx) => {
    const [original] = await tx.select().from(activities).where(eq(activities.id, input.activityId)).limit(1);
    if (!original) throw notFound("Activity");
    if (!["note", "call", "email"].includes(original.kind)) {
      throw new ValidationError({ activityId: "not_correctable" }, "Only notes, calls and emails can be corrected");
    }

    if (original.dealId) {
      const [deal] = await tx.select().from(deals).where(eq(deals.id, original.dealId)).limit(1);
      if (!deal || !canMutate(input.principal, deal)) throw notFound("Activity");
    } else if (original.actorId !== input.principal.userId && input.principal.role === "salesperson") {
      throw notFound("Activity");
    }

    const [existing] = await tx
      .select({ id: activities.id })
      .from(activities)
      .where(eq(activities.correctsActivityId, original.id))
      .limit(1);
    if (existing) throw conflict("This activity was already corrected");

    const [row] = await tx
      .insert(activities)
      .values({
        kind: "correction",
        source: "manual",
        dealId: original.dealId,
        contactId: original.contactId,
        companyId: original.companyId,
        actorId: input.principal.userId,
        body: newBody!,
        correctsActivityId: original.id,
        correctionReason: reason!,
        originalBody: original.body,
      })
      .returning({ id: activities.id });

    await recordAudit(tx, {
      actorId: input.principal.userId,
      action: "activity.corrected",
      subjectType: "activity",
      subjectId: original.id,
      metadata: { correctionId: row!.id },
      requestId: input.requestId ?? null,
    });
    return { id: row!.id };
  });
}

/* ---------- tasks ---------- */

export interface CreateTaskInput {
  principal: Principal;
  title: string;
  dueOn: string;
  dealId?: string | null;
  contactId?: string | null;
  companyId?: string | null;
  requestId?: string | null;
}

export async function createTask(input: CreateTaskInput): Promise<{ id: string }> {
  const title = cleanText(input.title, 200);
  const dueOn = parseIsoDate(input.dueOn);
  const errors: Record<string, string> = {};
  if (!title) errors.title = "required";
  if (!dueOn) errors.dueOn = "invalid";
  if (Object.keys(errors).length) throw new ValidationError(errors);

  const dealId = input.dealId ?? null;
  if (dealId) await loadVisibleDeal(input.principal, dealId);

  const dueAt = taskDueInstant(dueOn!, getConfig().orgTimezone);
  if (!dueAt) throw new ValidationError({ dueOn: "invalid" });

  const [row] = await getDb()
    .insert(tasks)
    .values({
      title: title!,
      ownerId: input.principal.userId,
      dealId,
      contactId: input.contactId ?? null,
      companyId: input.companyId ?? null,
      dueOn: dueOn!,
      dueAt,
    })
    .returning({ id: tasks.id });
  return { id: row!.id };
}

export async function completeTask(principal: Principal, taskId: string, requestId?: string | null): Promise<void> {
  await withTx(async (tx) => {
    const [task] = await tx.select().from(tasks).where(eq(tasks.id, taskId)).for("update").limit(1);
    if (!task || !canMutate(principal, task)) throw notFound("Task");
    if (task.status === "completed") return; // idempotent: a repeated submit is a no-op
    const now = new Date();
    await tx
      .update(tasks)
      .set({ status: "completed", completedAt: now, completedBy: principal.userId, version: task.version + 1, updatedAt: now })
      .where(and(eq(tasks.id, taskId), isNull(tasks.completedAt)));
    await recordAudit(tx, {
      actorId: principal.userId,
      action: "task.completed",
      subjectType: "task",
      subjectId: taskId,
      requestId: requestId ?? null,
    });
  });
}
