"use server";

import { redirect } from "next/navigation";
import { t } from "@/i18n";
import { actionContext, revalidateAreas } from "@/server/web/context";
import { field, fieldOrNull, toActionResult, type ActionResult } from "@/server/web/action-result";
import { flashPath } from "@/server/web/flash";
import { createDeal, updateDeal, logActivity, correctActivity, createTask, completeTask, setDealArchived, type ActivityKind } from "@/server/domain/deals/service";
import { moveDealStage, type MoveDealResult } from "@/server/domain/deals/stage-service";
import { DomainError, ValidationError } from "@/server/errors";
import { isUuid, safeNextPath } from "@/server/security/guards";

/* ---------- create / edit ---------- */

export async function createDealAction(fd: FormData): Promise<ActionResult> {
  const { principal, locale, requestId } = await actionContext();
  try {
    const { id } = await createDeal({
      principal,
      title: field(fd, "title"),
      companyId: field(fd, "companyId"),
      primaryContactId: fieldOrNull(fd, "primaryContactId"),
      ownerId: fieldOrNull(fd, "ownerId"),
      stageId: fieldOrNull(fd, "stageId"),
      amountInput: field(fd, "amount"),
      expectedCloseOn: fieldOrNull(fd, "expectedCloseOn"),
      requestId,
    });
    revalidateAreas("/pipeline", "/dashboard", "/companies");
    return { ok: true, message: t(locale, "deal.created"), redirectTo: flashPath(`/deals/${id}`, { ok: "deal.created" }) };
  } catch (err) {
    return toActionResult(err, locale, requestId, { action: "deal.create" });
  }
}

export async function updateDealAction(dealId: string, fd: FormData): Promise<ActionResult> {
  const { principal, locale, requestId } = await actionContext();
  if (!isUuid(dealId)) return { ok: false, message: t(locale, "notFound.title") };
  try {
    await updateDeal({
      principal,
      dealId,
      expectedVersion: Number(field(fd, "version")),
      title: field(fd, "title"),
      amountInput: field(fd, "amount"),
      expectedCloseOn: fieldOrNull(fd, "expectedCloseOn"),
      primaryContactId: fieldOrNull(fd, "primaryContactId"),
      ownerId: fieldOrNull(fd, "ownerId"),
      requestId,
    });
    revalidateAreas(`/deals/${dealId}`, "/pipeline");
    return { ok: true, message: t(locale, "deal.updated") };
  } catch (err) {
    return toActionResult(err, locale, requestId, { action: "deal.update", dealId });
  }
}

/* ---------- stage moves ---------- */

/** Shared by the board drag-and-drop (client) and the plain stage form (no JavaScript). */
async function runMove(fd: FormData): Promise<{ result: ActionResult; dealId: string; moved?: MoveDealResult }> {
  const { principal, locale, requestId } = await actionContext();
  const dealId = field(fd, "dealId");
  try {
    const moved = await moveDealStage({
      dealId,
      toStageId: field(fd, "stageId"),
      expectedVersion: Number(field(fd, "version")),
      principal,
      reason: fieldOrNull(fd, "reason"),
      requestId,
    });
    revalidateAreas("/pipeline", `/deals/${dealId}`, "/dashboard");
    const message = moved.changed
      ? t(locale, "pipeline.moved", { stage: moved.toStageName })
      : t(locale, "deal.stageUnchanged");
    return { result: { ok: true, message }, dealId, moved };
  } catch (err) {
    const result = toActionResult(err, locale, requestId, { action: "deal.move", dealId });
    if (err instanceof DomainError && err.code === "conflict") {
      return { result: { ok: false, message: t(locale, "deal.conflict"), code: "conflict" }, dealId };
    }
    if (!result.ok && err instanceof ValidationError && err.fieldErrors.reason) {
      return { result: { ...result, fieldErrors: { reason: t(locale, "errors.reason_required") } }, dealId };
    }
    return { result, dealId };
  }
}

/** Board drag-and-drop calls this and gets a result to announce. */
export async function moveDealClientAction(fd: FormData): Promise<ActionResult> {
  const { result } = await runMove(fd);
  return result;
}

/** Plain stage form: redirects back to where the user came from, with a notice. */
export async function moveDealFormAction(fd: FormData): Promise<void> {
  const { result, dealId, moved } = await runMove(fd);
  const back = safeNextPath(field(fd, "next"), `/deals/${dealId}`);
  if (result.ok) redirect(flashPath(back, { ok: moved?.changed ? "pipeline.moved" : "deal.stageUnchanged", vars: { stage: moved?.toStageName ?? "" } }));
  redirect(flashPath(back, { err: result.code === "conflict" ? "deal.conflict" : "errors.generic" }));
}

/* ---------- activity & tasks ---------- */

export async function logActivityAction(dealId: string, fd: FormData): Promise<ActionResult> {
  const { principal, locale, requestId } = await actionContext();
  try {
    const kind = field(fd, "kind") as ActivityKind;
    await logActivity({
      principal,
      dealId,
      kind,
      body: field(fd, "body"),
      occurredLocal: fieldOrNull(fd, "occurredLocal"),
      requestId,
    });
    revalidateAreas(`/deals/${dealId}`, "/dashboard");
    return { ok: true, message: t(locale, "deal.logged") };
  } catch (err) {
    return toActionResult(err, locale, requestId, { action: "activity.log", dealId });
  }
}

export async function correctActivityAction(dealId: string, fd: FormData): Promise<ActionResult> {
  const { principal, locale, requestId } = await actionContext();
  try {
    await correctActivity({
      principal,
      activityId: field(fd, "activityId"),
      newBody: field(fd, "newBody"),
      reason: field(fd, "reason"),
      requestId,
    });
    revalidateAreas(`/deals/${dealId}`);
    return { ok: true, message: t(locale, "deal.correctionSaved") };
  } catch (err) {
    return toActionResult(err, locale, requestId, { action: "activity.correct", dealId });
  }
}

export async function createTaskAction(dealId: string, fd: FormData): Promise<ActionResult> {
  const { principal, locale, requestId } = await actionContext();
  try {
    await createTask({ principal, title: field(fd, "title"), dueOn: field(fd, "dueOn"), dealId, requestId });
    revalidateAreas(`/deals/${dealId}`, "/tasks");
    return { ok: true, message: t(locale, "deal.taskAdded") };
  } catch (err) {
    return toActionResult(err, locale, requestId, { action: "task.create", dealId });
  }
}

export async function completeTaskFormAction(fd: FormData): Promise<void> {
  const { principal, locale, requestId } = await actionContext();
  const taskId = field(fd, "taskId");
  const back = safeNextPath(field(fd, "next"), "/tasks");
  let failed = false;
  try {
    if (!isUuid(taskId)) throw new ValidationError({ taskId: "invalid" });
    await completeTask(principal, taskId, requestId);
    revalidateAreas("/tasks", "/dashboard", "/pipeline");
  } catch (err) {
    failed = true;
    toActionResult(err, locale, requestId, { action: "task.complete", taskId });
  }
  redirect(flashPath(back, failed ? { err: "errors.generic" } : { ok: "tasks.completedOk" }));
}

/* ---------- archive ---------- */

export async function setDealArchivedAction(fd: FormData): Promise<void> {
  const { principal, locale, requestId } = await actionContext();
  const dealId = field(fd, "dealId");
  const archive = field(fd, "archive") === "1";
  let failed = false;
  try {
    await setDealArchived(principal, dealId, archive, requestId);
    revalidateAreas("/pipeline", "/dashboard");
  } catch (err) {
    failed = true;
    toActionResult(err, locale, requestId, { action: "deal.archive", dealId });
  }
  if (failed) redirect(flashPath(`/deals/${dealId}`, { err: "errors.generic" }));
  redirect(flashPath(archive ? "/pipeline" : `/deals/${dealId}`, { ok: archive ? "deal.archivedOk" : "deal.restoredOk" }));
}

