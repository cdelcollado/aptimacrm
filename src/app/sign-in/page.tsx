import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { resolveSession } from "@/server/auth/session";
import { currentLocale, t } from "@/i18n";
import { readFlash } from "@/server/web/flash";
import { safeNextPath } from "@/server/security/guards";
import { signInAction } from "@/app/actions/session";
import { Notice } from "@/components/notice";
import { LocaleSwitcher } from "@/components/locale-switcher";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await props.searchParams;
  const locale = await currentLocale();
  const next = safeNextPath(typeof sp.next === "string" ? sp.next : null);

  const session = await resolveSession();
  if (session.status === "ok") redirect(next);

  const flash = readFlash(sp, locale);
  const expired = sp.reason === "expired";

  return (
    <main id="main" className="auth-wrap">
      <div className="auth-card stack">
        <header className="row">
          <h1 style={{ margin: 0, fontSize: 26 }}>
            AptimaCRM
          </h1>
          <LocaleSwitcher current={locale} next="/sign-in" />
        </header>
        <section className="card" aria-labelledby="signin-title">
          <h2 id="signin-title">{t(locale, "signin.title")}</h2>
          <p className="muted">{t(locale, "signin.intro")}</p>
          {expired && <Notice kind="warn">{t(locale, "signin.expired")}</Notice>}
          {flash && <Notice kind={flash.kind === "ok" ? "ok" : "error"}>{flash.text}</Notice>}
          <form action={signInAction} className="form-grid" aria-label={t(locale, "signin.title")}>
            <input type="hidden" name="next" value={next} />
            <div className="field">
              <label htmlFor="email">{t(locale, "signin.email")}</label>
              <input id="email" name="email" type="email" autoComplete="username" required inputMode="email" />
            </div>
            <div className="field">
              <label htmlFor="password">{t(locale, "signin.password")}</label>
              <input id="password" name="password" type="password" autoComplete="current-password" required />
            </div>
            <button type="submit" className="btn">{t(locale, "signin.submit")}</button>
          </form>
        </section>
      </div>
    </main>
  );
}
