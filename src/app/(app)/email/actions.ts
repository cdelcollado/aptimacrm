"use server";

import { redirect } from "next/navigation";
import { t } from "@/i18n";
import { actionContext, revalidateAreas } from "@/server/web/context";
import { field, fieldOrNull, toActionResult, type ActionResult } from "@/server/web/action-result";
import { flashPath } from "@/server/web/flash";
import { matchInboundEmail, discardInboundEmail } from "@/server/domain/email-capture";

export async function matchEmailAction(inboundId: string, fd: FormData): Promise<ActionResult> {
  const { principal, locale, requestId } = await actionContext();
  try {
    await matchInboundEmail({ principal, inboundId, contactId: field(fd, "contactId"), dealId: fieldOrNull(fd, "dealId"), requestId });
    revalidateAreas("/email", "/contacts", "/deals");
    return { ok: true, message: t(locale, "email.matchedOk") };
  } catch (err) {
    return toActionResult(err, locale, requestId, { action: "email.match", inboundId });
  }
}

export async function discardEmailAction(fd: FormData): Promise<void> {
  const { principal, locale, requestId } = await actionContext();
  const inboundId = field(fd, "inboundId");
  let failed = false;
  try {
    await discardInboundEmail(principal, inboundId, requestId);
    revalidateAreas("/email");
  } catch (err) {
    failed = true;
    toActionResult(err, locale, requestId, { action: "email.discard", inboundId });
  }
  redirect(flashPath("/email", failed ? { err: "errors.generic" } : { ok: "email.discardedOk" }));
}
