"use server";

import { redirect } from "next/navigation";
import { t } from "@/i18n";
import { actionContext, revalidateAreas } from "@/server/web/context";
import { field, fieldOrNull, toActionResult, type ActionResult } from "@/server/web/action-result";
import { flashPath } from "@/server/web/flash";
import { setImportMapping, confirmImport, cancelImport, retryImportParse, type ImportDecision } from "@/server/domain/imports/service";
import { type ColumnMapping, TARGET_FIELDS } from "@/server/domain/imports/mapping";
import { isUuid } from "@/server/security/guards";

export async function setImportMappingAction(importId: string, fd: FormData): Promise<ActionResult> {
  const { principal, locale, requestId } = await actionContext();
  const kind = fieldOrNull(fd, "kind") ?? "contacts";
  const fields: ColumnMapping = {};
  for (const target of TARGET_FIELDS[kind === "companies" ? "companies" : "contacts"]) {
    fields[target] = fieldOrNull(fd, `map_${target}`);
  }
  try {
    await setImportMapping({ principal, importId, fields, defaultOwnerId: fieldOrNull(fd, "defaultOwnerId"), requestId });
    revalidateAreas(`/imports/${importId}`, "/imports");
    return { ok: true, message: t(locale, "imports.status.processing"), redirectTo: `/imports/${importId}` };
  } catch (err) {
    return toActionResult(err, locale, requestId, { action: "import.map", importId });
  }
}

export async function confirmImportAction(importId: string, fd: FormData): Promise<ActionResult> {
  const { principal, locale, requestId } = await actionContext();
  const decisions: Record<string, ImportDecision> = {};
  for (const [key, value] of fd.entries()) {
    if (key.startsWith("decision_") && typeof value === "string") {
      decisions[key.slice("decision_".length)] = value as ImportDecision;
    }
  }
  try {
    const counts = await confirmImport({ principal, importId, decisions, requestId });
    revalidateAreas(`/imports/${importId}`, "/imports", "/contacts", "/companies", "/dashboard");
    const message = counts.alreadyCompleted
      ? t(locale, "imports.alreadyDone")
      : t(locale, "imports.completedSummary", { created: counts.created, linked: counts.linked, skipped: counts.skipped });
    return { ok: true, message, redirectTo: flashPath(`/imports/${importId}`, { ok: "imports.status.completed" }) };
  } catch (err) {
    return toActionResult(err, locale, requestId, { action: "import.confirm", importId });
  }
}

export async function cancelImportAction(fd: FormData): Promise<void> {
  const { principal, locale, requestId } = await actionContext();
  const importId = field(fd, "importId");
  if (!isUuid(importId)) redirect("/imports");
  let failed = false;
  try {
    await cancelImport(principal, importId, requestId);
    revalidateAreas("/imports");
  } catch (err) {
    failed = true;
    toActionResult(err, locale, requestId, { action: "import.cancel", importId });
  }
  if (failed) redirect(flashPath(`/imports/${importId}`, { err: "errors.generic" }));
  redirect(flashPath("/imports", { ok: "imports.cancelled" }));
}

export async function retryImportAction(fd: FormData): Promise<void> {
  const { principal, locale, requestId } = await actionContext();
  const importId = field(fd, "importId");
  let failed = false;
  try {
    await retryImportParse(principal, importId, requestId);
    revalidateAreas(`/imports/${importId}`);
  } catch (err) {
    failed = true;
    toActionResult(err, locale, requestId, { action: "import.retry", importId });
  }
  if (failed) redirect(flashPath(`/imports/${importId}`, { err: "errors.generic" }));
  redirect(flashPath(`/imports/${importId}`, { ok: "imports.status.processing" }));
}
