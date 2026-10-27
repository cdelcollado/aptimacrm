import Link from "next/link";
import { signOutAction } from "@/app/actions/session";
import { t, type Locale } from "@/i18n";
import type { Principal } from "@/server/authz/policy";
import { NavLinks, type NavItem } from "@/components/nav-links";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { isManagerOrAdmin, isAdmin } from "@/server/authz/policy";

export function AppShell({ principal, locale, children }: { principal: Principal; locale: Locale; children: React.ReactNode }) {
  const items: NavItem[] = [
    { href: "/dashboard", label: t(locale, "nav.dashboard") },
    { href: "/pipeline", label: t(locale, "nav.pipeline") },
    { href: "/contacts", label: t(locale, "nav.contacts") },
    { href: "/companies", label: t(locale, "nav.companies") },
    { href: "/tasks", label: t(locale, "nav.tasks") },
  ];
  if (isManagerOrAdmin(principal)) {
    items.push({ href: "/imports", label: t(locale, "nav.imports") });
    items.push({ href: "/email", label: t(locale, "nav.email") });
  }
  if (isAdmin(principal)) items.push({ href: "/admin", label: t(locale, "nav.admin") });

  return (
    <>
      <a className="skip-link" href="#main">
        {t(locale, "common.skipToResults")}
      </a>
      <header className="shell-header">
        <div className="shell-bar">
          <Link href="/dashboard" className="brand" aria-label="AptimaCRM">
            Aptima<span>CRM</span>
          </Link>
          <NavLinks items={items} label={t(locale, "nav.main")} />
          <div className="account">
            <span>
              {t(locale, "nav.signedInAs", { name: principal.name })}
              <span className="muted"> · {t(locale, `role.${principal.role}`)}</span>
            </span>
            <LocaleSwitcher current={locale} next="/dashboard" />
            <form action={signOutAction}>
              <button type="submit" className="btn secondary small">
                {t(locale, "nav.signOut")}
              </button>
            </form>
          </div>
        </div>
      </header>
      <div>{children}</div>
    </>
  );
}
