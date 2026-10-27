"use server";

import { t } from "@/i18n";
import { actionContext, revalidateAreas } from "@/server/web/context";
import { field, fieldOrNull, toActionResult, type ActionResult } from "@/server/web/action-result";
import { flashPath } from "@/server/web/flash";
import { createContact, updateContact, setContactArchived } from "@/server/domain/contacts/service";
import { mergeContacts, type MergePicks } from "@/server/domain/contacts/merge";
import { redirect } from "next/navigation";
import { isUuid } from "@/server/security/guards";
import { DomainError, ValidationError } from "@/server/errors";

function contactFields(fd: FormData) {
  return {
    firstName: field(fd, "firstName"),
    lastName: field(fd, "lastName"),
    email: field(fd, "email"),
    phone: field(fd, "phone"),
    companyId: fieldOrNull(fd, "companyId") ?? "",
    ownerId: fieldOrNull(fd, "ownerId") ?? "",
  };
}

export async function createContactAction(fd: FormData): Promise<ActionResult> {
  const { principal, locale, requestId } = await actionContext();
  try {
    const { id } = await createContact({
      principal,
      fields: contactFields(fd),
      confirmDuplicate: field(fd, "confirmDuplicate") === "on",
      requestId,
    });
    revalidateAreas("/contacts", "/dashboard");
    return { ok: true, message: t(locale, "contacts.createdOk"), redirectTo: flashPath(`/contacts/${id}`, { ok: "contacts.createdOk" }) };
  } catch (err) {
    return toActionResult(err, locale, requestId, { action: "contact.create" });
  }
}

export async function updateContactAction(contactId: string, fd: FormData): Promise<ActionResult> {
  const { principal, locale, requestId } = await actionContext();
  if (!isUuid(contactId)) return { ok: false, message: t(locale, "notFound.title") };
  try {
    await updateContact(principal, contactId, Number(field(fd, "version")), contactFields(fd), requestId);
    revalidateAreas(`/contacts/${contactId}`, "/contacts");
    return { ok: true, message: t(locale, "contacts.updatedOk") };
  } catch (err) {
    return toActionResult(err, locale, requestId, { action: "contact.update", contactId });
  }
}

export async function setContactArchivedAction(fd: FormData): Promise<void> {
  const { principal, locale, requestId } = await actionContext();
  const contactId = field(fd, "contactId");
  const archive = field(fd, "archive") === "1";
  let failure: "contacts.archiveBlocked" | "notFound.title" | "errors.generic" | null = null;
  try {
    await setContactArchived(principal, contactId, archive, requestId);
    revalidateAreas("/contacts");
  } catch (err) {
    toActionResult(err, locale, requestId, { action: "contact.archive", contactId });
    failure = err instanceof ValidationError ? "contacts.archiveBlocked" : err instanceof DomainError && err.code === "not_found" ? "notFound.title" : "errors.generic";
  }
  if (failure) redirect(flashPath(`/contacts/${contactId}`, { err: failure }));
  redirect(flashPath(archive ? "/contacts" : `/contacts/${contactId}`, { ok: archive ? "contacts.archivedOk" : "contacts.restoredOk" }));
}

export async function mergeContactsAction(fd: FormData): Promise<ActionResult> {
  const { principal, locale, requestId } = await actionContext();
  const survivorId = field(fd, "survivorId");
  const sourceId = field(fd, "sourceId");
  const picks: MergePicks = {
    firstName: field(fd, "pick_firstName") === "source" ? "source" : "survivor",
    lastName: field(fd, "pick_lastName") === "source" ? "source" : "survivor",
    email: field(fd, "pick_email") === "source" ? "source" : "survivor",
    phone: field(fd, "pick_phone") === "source" ? "source" : "survivor",
    companyId: field(fd, "pick_companyId") === "source" ? "source" : "survivor",
  };
  try {
    await mergeContacts({
      principal,
      survivorId,
      sourceId,
      picks,
      expectedSurvivorVersion: Number(field(fd, "survivorVersion")),
      expectedSourceVersion: Number(field(fd, "sourceVersion")),
      requestId,
    });
    revalidateAreas("/contacts", `/contacts/${survivorId}`);
    return { ok: true, message: t(locale, "contacts.mergedDone"), redirectTo: flashPath(`/contacts/${survivorId}`, { ok: "contacts.mergedDone" }) };
  } catch (err) {
    return toActionResult(err, locale, requestId, { action: "contact.merge" });
  }
}
