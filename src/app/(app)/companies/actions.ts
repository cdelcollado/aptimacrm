"use server";

import { redirect } from "next/navigation";
import { t } from "@/i18n";
import { actionContext, revalidateAreas } from "@/server/web/context";
import { field, toActionResult, type ActionResult } from "@/server/web/action-result";
import { flashPath } from "@/server/web/flash";
import { createCompany, updateCompany, setCompanyArchived } from "@/server/domain/companies/service";
import { DomainError, ValidationError } from "@/server/errors";
import { isUuid } from "@/server/security/guards";

function companyFields(fd: FormData) {
  return { name: field(fd, "name"), website: field(fd, "website"), ownerId: field(fd, "ownerId") };
}

export async function createCompanyAction(fd: FormData): Promise<ActionResult> {
  const { principal, locale, requestId } = await actionContext();
  try {
    const { id } = await createCompany({
      principal,
      fields: companyFields(fd),
      confirmDuplicate: field(fd, "confirmDuplicate") === "on",
      requestId,
    });
    revalidateAreas("/companies", "/dashboard");
    return { ok: true, message: t(locale, "companies.createdOk"), redirectTo: flashPath(`/companies/${id}`, { ok: "companies.createdOk" }) };
  } catch (err) {
    return toActionResult(err, locale, requestId, { action: "company.create" });
  }
}

export async function updateCompanyAction(companyId: string, fd: FormData): Promise<ActionResult> {
  const { principal, locale, requestId } = await actionContext();
  if (!isUuid(companyId)) return { ok: false, message: t(locale, "notFound.title") };
  try {
    await updateCompany(principal, companyId, Number(field(fd, "version")), companyFields(fd), requestId);
    revalidateAreas(`/companies/${companyId}`, "/companies");
    return { ok: true, message: t(locale, "companies.updatedOk") };
  } catch (err) {
    return toActionResult(err, locale, requestId, { action: "company.update", companyId });
  }
}

export async function setCompanyArchivedAction(fd: FormData): Promise<void> {
  const { principal, locale, requestId } = await actionContext();
  const companyId = field(fd, "companyId");
  const archive = field(fd, "archive") === "1";
  let failure: "companies.archiveBlocked" | "notFound.title" | "errors.generic" | null = null;
  try {
    await setCompanyArchived(principal, companyId, archive, requestId);
    revalidateAreas("/companies");
  } catch (err) {
    toActionResult(err, locale, requestId, { action: "company.archive", companyId });
    failure = err instanceof ValidationError ? "companies.archiveBlocked" : err instanceof DomainError && err.code === "not_found" ? "notFound.title" : "errors.generic";
  }
  if (failure) redirect(flashPath(`/companies/${companyId}`, { err: failure }));
  redirect(flashPath(archive ? "/companies" : `/companies/${companyId}`, { ok: archive ? "companies.archivedOk" : "companies.restoredOk" }));
}
