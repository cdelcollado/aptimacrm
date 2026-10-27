import { MESSAGES, type MessageKey } from "@/i18n/messages";
import type { Locale } from "@/i18n/messages";
import { t } from "@/i18n";

/**
 * Post-redirect-get notices. Only message keys from the catalogue can travel in the URL, so the
 * query string never carries free text and cannot inject anything into the page.
 */
export function flashPath(path: string, flash: { ok?: MessageKey; err?: MessageKey; vars?: Record<string, string | number> }): string {
  const params = new URLSearchParams();
  if (flash.ok) params.set("ok", flash.ok);
  if (flash.err) params.set("err", flash.err);
  if (flash.vars) for (const [k, v] of Object.entries(flash.vars)) params.set(`v_${k}`, String(v));
  const qs = params.toString();
  return qs ? `${path}${path.includes("?") ? "&" : "?"}${qs}` : path;
}

export interface FlashRead {
  kind: "ok" | "error";
  text: string;
}

export function readFlash(searchParams: Record<string, string | string[] | undefined>, locale: Locale): FlashRead | null {
  const pick = (name: string) => {
    const v = searchParams[name];
    return typeof v === "string" ? v : undefined;
  };
  const ok = pick("ok");
  const err = pick("err");
  const vars: Record<string, string> = {};
  for (const key of Object.keys(searchParams)) {
    if (key.startsWith("v_")) {
      const value = pick(key);
      if (value !== undefined) vars[key.slice(2)] = value.slice(0, 200);
    }
  }
  if (ok && ok in MESSAGES.en) return { kind: "ok", text: t(locale, ok as MessageKey, vars) };
  if (err && err in MESSAGES.en) return { kind: "error", text: t(locale, err as MessageKey, vars) };
  return null;
}
