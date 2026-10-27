import { MESSAGES, type Locale, type MessageKey } from "@/i18n/messages";

/**
 * Pure translation function. Safe to import from client components (no request APIs).
 * Missing keys fall back to English, then to the key itself so gaps are visible in development.
 */
export function t(locale: Locale, key: MessageKey, vars?: Record<string, string | number>): string {
  const template: string = MESSAGES[locale][key] ?? MESSAGES.en[key] ?? key;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`));
}
