import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { pageContext } from "@/server/web/context";
import { getCompanyDetail } from "@/server/queries/directory";
import { PageHeader, EmptyState } from "@/components/page-header";
import { Notice } from "@/components/notice";
import { readFlash } from "@/server/web/flash";
import { isUuid } from "@/server/security/guards";
import { formatEuro } from "@/server/domain/metrics";
import { setCompanyArchivedAction } from "@/app/(app)/companies/actions";
import { t, type MessageKey } from "@/i18n";

export const metadata: Metadata = { title: "Company" };
export const dynamic = "force-dynamic";

export default async function CompanyDetailPage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  const { principal, locale, tag } = await pageContext(`/companies/${id}`);
  if (!isUuid(id)) notFound();
  const detail = await getCompanyDetail(principal, id);
  if (!detail) notFound();
  const flash = readFlash(sp, locale);
  const archived = detail.company.status === "archived";

  return (
    <main id="main" className="page">
      <PageHeader
        title={detail.company.name}
        intro={[detail.company.domainNormalized, `${t(locale, "common.owner")}: ${detail.ownerName}`].filter(Boolean).join(" · ")}
        actions={
          <>
            {detail.canMutate && !archived && (
              <Link className="btn" href={`/deals/new?companyId=${detail.company.id}`}>{t(locale, "companies.newDeal")}</Link>
            )}
            <Link className="btn secondary" href="/companies">{t(locale, "common.back")}</Link>
          </>
        }
      />
      {flash && <Notice kind={flash.kind === "ok" ? "ok" : "error"}>{flash.text}</Notice>}
      {archived && <Notice kind="info">{t(locale, "contacts.archivedView")}</Notice>}

      <div className="grid grid-2">
        <section className="card" aria-labelledby="deals-title">
          <h2 id="deals-title">{t(locale, "companies.deals")}</h2>
          {detail.deals.length === 0 ? (
            <EmptyState title={t(locale, "common.noneYet")} />
          ) : (
            <ul className="list">
              {detail.deals.map((d) => (
                <li key={d.id}>
                  <Link className="row-link" href={`/deals/${d.id}`}>
                    <span className="title">{d.title}</span>
                    <div className="meta">
                      <span className={`pill ${d.status}`}>{t(locale, `status.${d.status}` as MessageKey)}</span>
                      <span>{formatEuro(d.amountCents, tag)}</span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="stack">
          <section className="card" aria-labelledby="contacts-title">
            <h2 id="contacts-title">{t(locale, "companies.contacts")}</h2>
            {detail.contacts.length === 0 ? (
              <p className="muted">{t(locale, "common.noneYet")}</p>
            ) : (
              <ul className="list">
                {detail.contacts.map((c) => (
                  <li key={c.id}>
                    <Link className="row-link" href={`/contacts/${c.id}`}>
                      <span className="title">{c.firstName} {c.lastName}</span>
                      <div className="meta">{c.email && <span>{c.email}</span>}</div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {detail.canMutate && (
            <section className="card" aria-labelledby="archive-title">
              <h2 id="archive-title">{archived ? t(locale, "common.restore") : t(locale, "common.archive")}</h2>
              <form action={setCompanyArchivedAction} className="stack">
                <input type="hidden" name="companyId" value={detail.company.id} />
                <input type="hidden" name="archive" value={archived ? "0" : "1"} />
                <button type="submit" className="btn secondary">{archived ? t(locale, "common.restore") : t(locale, "common.archive")}</button>
                {!archived && <p className="muted small-text">{t(locale, "companies.archiveBlocked")}</p>}
              </form>
            </section>
          )}
        </div>
      </div>
    </main>
  );
}
