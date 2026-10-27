import { revalidatePath } from "next/cache";
import { currentLocale, localeTag, type Locale } from "@/i18n";
import type { Principal } from "@/server/authz/policy";
import { requirePrincipal } from "@/server/web/guard";
import { newRequestId } from "@/server/log/logger";

/** Request context for server pages: principal, locale and the BCP-47 tag for number/date formatting. */
export async function pageContext(path: string): Promise<{ principal: Principal; locale: Locale; tag: string }> {
  const principal = await requirePrincipal(path);
  const locale = await currentLocale(principal.locale);
  return { principal, locale, tag: localeTag(locale) };
}

/** Context for server actions. Re-derives the principal from the session on every call. */
export async function actionContext(): Promise<{ principal: Principal; locale: Locale; requestId: string }> {
  const principal = await requirePrincipal();
  const locale = await currentLocale(principal.locale);
  return { principal, locale, requestId: newRequestId() };
}

/** Revalidate the pages that show the given area. Called after the transaction has committed. */
export function revalidateAreas(...paths: string[]): void {
  for (const p of paths) revalidatePath(p);
}
