import type { Metadata } from "next";
import Link from "next/link";
import { pageContext } from "@/server/web/context";
import { listContacts, listOwnerOptions } from "@/server/queries/directory";
import { PageHeader, EmptyState } from "@/components/page-header";
import { readFlash } from "@/server/web/flash";
import { Notice } from "@/components/notice";
import { isManagerOrAdmin } from "@/server/authz/policy";
import { formatDateTime } from "@/components/format";
import { t } from "@/i18n";

export const metadata: Metadata = { title: "Contacts" };
export const dynamic = "force-dynamic";

export default async function ContactsPage(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await props.searchParams;
  const { principal, locale, tag } = await pageContext("/contacts");
  const q = typeof sp.q === "string" ? sp.q.slice(0, 120) : "";
  const archived = sp.status === "archived";
  const owner = typeof sp.owner === "string" && sp.owner ? sp.owner : null;
  const flash = readFlash(sp, locale);
  const rows = await listContacts(principal, { q, status: archived ? "archived" : "active", ownerId: owner });
  const owners = isManagerOrAdmin(principal) ? await listOwnerOptions() : [];

  return (
    <main id="main" className="page">
      <PageHeader
        title={t(locale, "contacts.title")}
        intro={t(locale, "contacts.intro")}
        actions={
          <>
            <Link className="btn secondary" href="/imports?kind=contacts">{t(locale, "contacts.import")}</Link>
            <Link className="btn" href="/contacts/new">{t(locale, "contacts.new")}</Link>
          </>
        }
      />
      {flash && <Notice kind={flash.kind === "ok" ? "ok" : "error"}>{flash.text}</Notice>}

      <form className="filters" method="get" role="search" aria-label={t(locale, "common.search")} style={{ marginBottom: 16 }}>
        <div className="field">
          <label htmlFor="q">{t(locale, "common.search")}</label>
          <input id="q" name="q" type="search" defaultValue={q} placeholder={t(locale, "contacts.search")} />
        </div>
        <div className="field">
          <label htmlFor="status">{t(locale, "common.status")}</label>
          <select id="status" name="status" defaultValue={archived ? "archived" : "active"}>
            <option value="active">{t(locale, "contacts.activeView")}</option>
            <option value="archived">{t(locale, "contacts.archivedView")}</option>
          </select>
        </div>
        {owners.length > 0 && (
          <div className="field">
            <label htmlFor="owner">{t(locale, "common.owner")}</label>
            <select id="owner" name="owner" defaultValue={owner ?? ""}>
              <option value="">{t(locale, "common.all")}</option>
              {owners.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </div>
        )}
        <button type="submit" className="btn secondary">{t(locale, "common.filter")}</button>
      </form>

      {rows.length === 0 ? (
        <EmptyState title={t(locale, archived ? "common.noneYet" : "contacts.emptyFirst")}>
          {!archived && <p className="muted"><Link href="/contacts/new">{t(locale, "contacts.new")}</Link></p>}
        </EmptyState>
      ) : (
        <div className="card card-flush">
          <ul className="list" aria-label={t(locale, "contacts.title")}>
            {rows.map((c) => (
              <li key={c.id}>
                <Link className="row-link" href={`/contacts/${c.id}`}>
                  <span className="title">{c.firstName} {c.lastName}</span>
                  <div className="meta">
                    {c.companyName && <span>{c.companyName}</span>}
                    {c.email && <span>{c.email}</span>}
                    <span>{t(locale, "common.owner")}: {c.ownerName}</span>
                  </div>
                  <div className="meta">
                    <span>{t(locale, "contacts.openDeals")}: {c.openDeals}</span>
                    <span>{t(locale, "contacts.lastActivity")}: {c.lastActivityAt ? formatDateTime(c.lastActivityAt, tag) : t(locale, "common.noValue")}</span>
                    {c.hasDuplicate && <span className="pill warn">⚠ {t(locale, "contacts.duplicate")}</span>}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </main>
  );
}
