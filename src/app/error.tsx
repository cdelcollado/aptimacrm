"use client";

import Link from "next/link";
import { useEffect } from "react";
import { t } from "@/i18n/translate";
import type { Locale } from "@/i18n/messages";

/**
 * Recoverable failure view. Shows the reference id the server logged, never the raw error.
 * The locale is read from the <html lang> attribute the server rendered.
 */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("route error", error.digest ?? "no-digest");
  }, [error]);
  const lang = (typeof document !== "undefined" ? document.documentElement.lang : "ca") as Locale;
  const locale: Locale = lang === "es" || lang === "en" ? lang : "ca";
  return (
    <main id="main" className="page" role="alert">
      <h1>{t(locale, "error.title")}</h1>
      <p>{t(locale, "error.body")}</p>
      {error.digest && <p className="muted small-text">{t(locale, "error.requestId", { id: error.digest })}</p>}
      <div className="actions">
        <button type="button" className="btn" onClick={() => reset()}>{t(locale, "common.retry")}</button>
        <Link className="btn secondary" href="/dashboard">{t(locale, "nav.dashboard")}</Link>
      </div>
    </main>
  );
}
