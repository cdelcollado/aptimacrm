import type { Metadata } from "next";
import Link from "next/link";
import { pageContext } from "@/server/web/context";
import { listImports } from "@/server/queries/imports";
import { PageHeader, EmptyState } from "@/components/page-header";
import { canImport } from "@/server/authz/policy";
import { formatDateTime } from "@/components/format";
import { readFlash } from "@/server/web/flash";
import { Notice } from "@/components/notice";
import { t, type MessageKey } from "@/i18n";

export const metadata: Metadata = { title: "Imports" };
export const dynamic = "force-dynamic";

export default async function ImportsPage(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await props.searchParams;
  const { principal, locale, tag } = await pageContext("/imports");
  if (!canImport(principal)) {
    return (
      <main id="main" className="page">
        <PageHeader title={t(locale, "forbidden.title")} />
        <EmptyState title={t(locale, "forbidden.title")}>{t(locale, "forbidden.body")}</EmptyState>
      </main>
    );
  }
  const kind = sp.kind === "companies" ? "companies" : "contacts";
  const flash = readFlash(sp, locale);
  const rows = await listImports(principal);

  return (
    <main id="main" className="page">
      <PageHeader title={t(locale, "imports.title")} intro={t(locale, "imports.intro")} />
      {flash && <Notice kind={flash.kind === "ok" ? "ok" : "error"}>{flash.text}</Notice>}

      <section className="card" aria-labelledby="upload-title" style={{ maxWidth: 680 }}>
        <h2 id="upload-title">{t(locale, "imports.upload")}</h2>
        {/* Multipart upload goes to a route handler, which checks the session and the Origin header. */}
        <form action="/api/imports" method="post" encType="multipart/form-data" className="form-grid">
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="field-legend">{t(locale, "imports.kind")}</legend>
            <div className="inline-form">
              <label className="inline-form"><input type="radio" name="kind" value="contacts" defaultChecked={kind === "contacts"} style={{ width: 20, height: 20, minHeight: 0 }} /> {t(locale, "imports.kind.contacts")}</label>
              <label className="inline-form"><input type="radio" name="kind" value="companies" defaultChecked={kind === "companies"} style={{ width: 20, height: 20, minHeight: 0 }} /> {t(locale, "imports.kind.companies")}</label>
            </div>
          </fieldset>
          <div className="field">
            <label htmlFor="file">{t(locale, "imports.file")}</label>
            <span className="hint">{t(locale, "imports.fileHelp")}</span>
            <input id="file" name="file" type="file" accept=".csv,text/csv" required />
          </div>
          <div className="actions">
            <button type="submit" className="btn">{t(locale, "imports.upload")}</button>
          </div>
        </form>
      </section>

      <section style={{ marginTop: 24 }} aria-labelledby="list-title">
        <h2 id="list-title">{t(locale, "dashboard.importStatus")}</h2>
        {rows.length === 0 ? (
          <EmptyState title={t(locale, "imports.empty")} />
        ) : (
          <div className="card card-flush">
            <ul className="list">
              {rows.map((i) => (
                <li key={i.id}>
                  <Link className="row-link" href={`/imports/${i.id}`}>
                    <span className="title">{i.fileName}</span>
                    <div className="meta">
                      <span className={`pill ${i.status}`}>{t(locale, `imports.status.${i.status}` as MessageKey)}</span>
                      <span>{t(locale, `imports.kind.${i.kind}` as MessageKey)}</span>
                      <time dateTime={new Date(i.createdAt).toISOString()}>{formatDateTime(i.createdAt, tag)}</time>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </main>
  );
}
