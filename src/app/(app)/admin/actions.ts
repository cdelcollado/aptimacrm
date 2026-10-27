"use server";

import { redirect } from "next/navigation";
import { actionContext, revalidateAreas } from "@/server/web/context";
import { field } from "@/server/web/action-result";
import { flashPath } from "@/server/web/flash";
import { saveStages, moveStage, addStage, deleteStage, type StageEdit } from "@/server/domain/deals/stages-admin";
import { toActionResult } from "@/server/web/action-result";

/** Stage editing is a plain form (no JavaScript needed). Each action redirects with a notice. */
async function run(path: string, okKey: string, work: () => Promise<void>, action: string): Promise<never> {
  const { locale, requestId } = await actionContext();
  let failure: string | null = null;
  try {
    await work();
    revalidateAreas("/admin", "/pipeline", "/dashboard");
  } catch (err) {
    const result = toActionResult(err, locale, requestId, { action });
    failure = result.ok ? null : result.message;
  }
  if (failure) redirect(flashPath(path, { err: "errors.generic" }));
  redirect(flashPath(path, { ok: okKey as never }));
}

export async function saveStagesAction(fd: FormData): Promise<void> {
  const { principal, requestId } = await actionContext();
  const ids = fd.getAll("stageId").map(String);
  const edits: StageEdit[] = ids.map((id) => ({ id, name: field(fd, `name_${id}`), kind: field(fd, `kind_${id}`) }));
  return run("/admin", "admin.stageSaved", () => saveStages(principal, edits, requestId), "stage.save");
}

export async function moveStageAction(fd: FormData): Promise<void> {
  const { principal, requestId } = await actionContext();
  const stageId = field(fd, "stageId");
  const direction = field(fd, "direction") === "up" ? "up" : "down";
  return run("/admin", "admin.stageSaved", () => moveStage(principal, stageId, direction, requestId), "stage.move");
}

export async function addStageAction(fd: FormData): Promise<void> {
  const { principal, requestId } = await actionContext();
  const name = field(fd, "name");
  const kind = field(fd, "kind");
  return run("/admin", "admin.stageAdded", () => addStage(principal, { name, kind }, requestId), "stage.add");
}

export async function deleteStageAction(fd: FormData): Promise<void> {
  const { principal, requestId } = await actionContext();
  const stageId = field(fd, "stageId");
  return run("/admin", "admin.stageDeleted", () => deleteStage(principal, stageId, requestId), "stage.delete");
}
