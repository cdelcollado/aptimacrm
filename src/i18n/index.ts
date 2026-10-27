import { cookies } from "next/headers";
import { DEFAULT_LOCALE, LOCALES, MESSAGES, type Locale, type MessageKey } from "@/i18n/messages";
import { t } from "@/i18n/translate";

export { LOCALES, DEFAULT_LOCALE, MESSAGES, t, type Locale, type MessageKey };
export const LOCALE_COOKIE = "aptima_locale";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** Locale for the current request: an explicit choice (cookie) wins, then the user's saved locale, then the default. */
export async function currentLocale(userLocale?: Locale | null): Promise<Locale> {
  const store = await cookies();
  const value = store.get(LOCALE_COOKIE)?.value;
  if (isLocale(value)) return value;
  if (userLocale && isLocale(userLocale)) return userLocale;
  return DEFAULT_LOCALE;
}

export function localeTag(locale: Locale): string {
  return locale === "ca" ? "ca-ES" : locale === "es" ? "es-ES" : "en-GB";
}
