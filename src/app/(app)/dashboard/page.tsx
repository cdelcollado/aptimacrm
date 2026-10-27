import type { Metadata } from "next";
import Link from "next/link";
import { requirePrincipal } from "@/server/web/guard";
import { currentLocale, t, localeTag, type MessageKey } from "@/i18n";
import { getDashboard } from "@/server/queries/dashboard";
import { formatEuro, formatPercent } from "@/server/domain/metrics";
import { PageHeader, EmptyState } from "@/components/page-header";
import { readFlash } from "@/server/web/flash";
import { Notice } from "@/components/notice";
import { ownerOptions } from "@/server/queries/pipeline";
import { isManagerOrAdmin } from "@/server/authz/policy";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

export default async function DashboardPage(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await props.searchParams;
  const principal = await requirePrincipal("/dashboard");
  const locale = await currentLocale(principal.locale);
  const tag = localeTag(locale);
  const owner = typeof sp.owner === "string" && sp.owner !== "" ? sp.owner : null;
  const flash = readFlash(sp, locale);

  const data = await getDashboard(principal, { ownerId: owner });
  const owners = isManagerOrAdmin(principal) ? await ownerOptions() : [];
  const closedCount = data.win.won + data.win.lost;

  return (
    <main id="main" className="page">
      <PageHeader title={t(locale, "dashboard.title")} intro={t(locale, "dashboard.intro")} />
      {flash && <Notice kind={flash.kind === "ok" ? "ok" : "error"}>{flash.text}</Notice>}

      {isManagerOrAdmin(principal) && (
        <form className="filters" method="get" aria-label={t(locale, "dashboard.owner")} style={{ marginBottom: 16 }}>
          <div className="field">
            <label htmlFor="owner">{t(locale, "dashboard.owner")}</label>
            <select id="owner" name="owner" defaultValue={owner ?? ""}>
              <option value="">{t(locale, "common.all")}</option>
              {owners.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </div>
          <button className="btn secondary" type="submit">{t(locale, "common.filter")}</button>
        </form>
      )}

      <section aria-labelledby="stats-title">
        <h2 id="stats-title" className="sr-only">Key figures</h2>
        <div className="grid grid-stats">
          <div className="card stat">
            <div className="label">{t(locale, "dashboard.openValue")}</div>
            <div className="value">{formatEuro(data.totals.openValueCents, tag)}</div>
            <div className="help">{t(locale, "dashboard.openDeals", { count: data.totals.openCount })}</div>
          </div>
          <div className="card stat">
            <div className="label">{t(locale, "dashboard.winRate")}</div>
            <div className="value">{formatPercent(data.win.rate, tag)}</div>
            <div className="help">{t(locale, "dashboard.winRateHelp", { won: data.win.won, closed: closedCount })}</div>
          </div>
          <div className="card stat">
            <div className="label">{t(locale, "dashboard.overdue")}</div>
            <div className="value">
              <Link href="/tasks?filter=overdue">{data.overdueTasks}</Link>
            </div>
            <div className="help">{t(locale, "dashboard.overdueHelp")}</div>
          </div>
          <div className="card stat">
            <div className="label">{t(locale, "pipeline.title")}</div>
            <div className="value">
              <Link href="/pipeline">{data.totals.openCount}</Link>
            </div>
            <div className="help">{t(locale, "pipeline.openValue")}</div>
          </div>
        </div>
      </section>

      <div className="grid grid-2" style={{ marginTop: 16 }}>
        <section className="card" aria-labelledby="recent-title">
          <h2 id="recent-title">{t(locale, "dashboard.recent")}</h2>
          {data.recentActivity.length === 0 ? (
            <EmptyState title={t(locale, "common.noneYet")}>{t(locale, "dashboard.recentEmpty")}</EmptyState>
          ) : (
            <ul className="list">
              {data.recentActivity.map((a) => (
                <li key={a.id}>
                  <div className="meta">
                    <span className={`pill`}>{t(locale, kindKey(a.kind))}</span>
                    <time dateTime={new Date(a.occurredAt).toISOString()}>
                      {new Date(a.occurredAt).toLocaleString(tag, { dateStyle: "short", timeStyle: "short" })}
                    </time>
                    {a.actorName && <span>{a.actorName}</span>}
                  </div>
                  {a.dealId ? (
                    <Link className="title" href={`/deals/${a.dealId}`}>{a.dealTitle}</Link>
                  ) : (
                    <span className="title">{a.contactFirst ? `${a.contactFirst} ${a.contactLast ?? ""}`.trim() : ""}</span>
                  )}
                  <div className="small-text muted" style={{ whiteSpace: "pre-wrap" }}>{truncate(a.body, 140)}</div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="stack">
          <section className="card" aria-labelledby="conv-title">
            <h2 id="conv-title">{t(locale, "dashboard.conversion")}</h2>
            <p className="muted small-text">{t(locale, "dashboard.conversionHelp")}</p>
            {data.conversion.length === 0 ? (
              <p className="muted">{t(locale, "dashboard.noConversion")}</p>
            ) : (
              <ul className="list">
                {data.conversion.map((c) => {
                  const from = data.stages.find((s) => s.id === c.fromStageId)?.name ?? "";
                  const to = data.stages.find((s) => s.id === c.toStageId)?.name ?? "";
                  return (
                    <li key={`${c.fromStageId}-${c.toStageId}`}>
                      <div className="row">
                        <span>{from} → {to}</span>
                        <strong className="num">{formatPercent(c.rate, tag)}</strong>
                      </div>
                      <div className="small-text muted">{c.converted} / {c.reached}</div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="card" aria-labelledby="quick-title">
            <h2 id="quick-title">{t(locale, "dashboard.quick")}</h2>
            <div className="actions" style={{ flexDirection: "column", alignItems: "stretch" }}>
              <Link className="btn" href="/contacts/new">{t(locale, "contacts.new")}</Link>
              <Link className="btn secondary" href="/companies/new">{t(locale, "companies.new")}</Link>
              <Link className="btn secondary" href="/pipeline">{t(locale, "nav.pipeline")}</Link>
              {isManagerOrAdmin(principal) && (
                <Link className="btn secondary" href="/imports">{t(locale, "imports.new")}</Link>
              )}
            </div>
          </section>

          {isManagerOrAdmin(principal) && (
            <section className="card" aria-labelledby="imports-title">
              <h2 id="imports-title">{t(locale, "dashboard.importStatus")}</h2>
              {data.recentImports.length === 0 ? (
                <p className="muted">{t(locale, "dashboard.importEmpty")}</p>
              ) : (
                <ul className="list">
                  {data.recentImports.map((i) => (
                    <li key={i.id}>
                      <Link className="row-link" href={`/imports/${i.id}`}>
                        <span className="title">{i.fileName}</span>
                        <div className="meta">
                          <span className={`pill ${i.status}`}>{t(locale, `imports.status.${i.status}` as never)}</span>
                          <span>{t(locale, `imports.kind.${i.kind}` as never)}</span>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>
      </div>
    </main>
  );
}

function kindKey(kind: string): MessageKey {
  return `activity.kind.${kind}` as MessageKey;
}

function truncate(text: string, n: number) {
  return text.length > n ? `${text.slice(0, n - 1)}…` : text;
}
