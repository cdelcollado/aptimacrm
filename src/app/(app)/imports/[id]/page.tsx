import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { pageContext } from "@/server/web/context";
import { getImportDetail, matchLabels } from "@/server/queries/imports";
import { PageHeader, EmptyState } from "@/components/page-header";
import { Notice } from "@/components/notice";
import { readFlash } from "@/server/web/flash";
import { ActionForm } from "@/components/action-form";
import { SelectField } from "@/components/fields";
import { setImportMappingAction, confirmImportAction, cancelImportAction, retryImportAction } from "@/app/(app)/imports/[id]/actions";
import { canImport } from "@/server/authz/policy";
import { isUuid } from "@/server/security/guards";
import { suggestMapping, TARGET_FIELDS, REQUIRED_FIELDS, type ImportKind } from "@/server/domain/imports/mapping";
import { listOwnerOptions } from "@/server/queries/directory";
import { t, type MessageKey } from "@/i18n";

export const metadata: Metadata = { title: "Import" };
export const dynamic = "force-dynamic";

const MAP_LABEL: Record<string, MessageKey> = {
  first_name: "contacts.firstName",
  last_name: "contacts.lastName",
  email: "contacts.email",
  phone: "contacts.phone",
  company_name: "contacts.company",
  owner_email: "common.owner",
  name: "companies.name",
  website: "companies.website",
};

export default async function ImportDetailPage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  const { principal, locale } = await pageContext(`/imports/${id}`);
  if (!isUuid(id) || !canImport(principal)) notFound();
  const detail = await getImportDetail(principal, id);
  if (!detail) notFound();
  const flash = readFlash(sp, locale);
  const { imp, job } = detail;
  const kind = imp.kind as ImportKind;
  const settings = (imp.columnMapping ?? { headers: [], fields: null, defaultOwnerId: null }) as {
    headers: string[];
    fields: Record<string, string | null> | null;
    defaultOwnerId: string | null;
  };
  const headers = settings.headers;
  const suggested = settings.fields ?? suggestMapping(kind, headers);
  const headerOptions = [{ value: "", label: t(locale, "imports.none") }, ...headers.map((h) => ({ value: h, label: h }))];
  const owners = (await listOwnerOptions()).map((o) => ({ value: o.id, label: o.name }));
  const duplicates = detail.rows.filter((r) => r.status === "duplicate");
  const errors = detail.rows.filter((r) => r.status === "error");
  const labels = await matchLabels(
    duplicates.map((d) => d.matchContactId).filter((x): x is string => Boolean(x)),
    duplicates.map((d) => d.matchCompanyId).filter((x): x is string => Boolean(x)),
  );

  const processing = imp.status === "processing";
  const stillRetrying = processing && job && job.status === "pending" && job.attempts > 0;

  return (
    <main id="main" className="page">
      {processing && <meta httpEquiv="refresh" content="5" />}
      <PageHeader
        title={imp.fileName}
        intro={`${t(locale, `imports.kind.${imp.kind}` as MessageKey)} · ${t(locale, `imports.status.${imp.status}` as MessageKey)}`}
        actions={<Link className="btn secondary" href="/imports">{t(locale, "common.back")}</Link>}
      />
      {flash && <Notice kind={flash.kind === "ok" ? "ok" : "error"}>{flash.text}</Notice>}

      {imp.status === "pending" && (
        <section className="card" aria-labelledby="map-title" style={{ maxWidth: 760 }}>
          <h2 id="map-title">{t(locale, "imports.mapTitle")}</h2>
          <p className="muted small-text">{t(locale, "imports.mapHelp")}</p>
          <ActionForm action={setImportMappingAction.bind(null, id)} ariaLabel={t(locale, "imports.mapTitle")} className="form-grid">
            <input type="hidden" name="kind" value={kind} />
            {TARGET_FIELDS[kind].map((target) => (
              <SelectField
                key={target}
                name={`map_${target}`}
                label={`${t(locale, MAP_LABEL[target] ?? "common.optional")}${REQUIRED_FIELDS[kind].includes(target) ? " *" : ""}`}
                options={headerOptions.filter((o) => o.value !== "" || true)}
                defaultValue={suggested[target] ?? ""}
              />
            ))}
            {owners.length > 0 && (
              <SelectField name="defaultOwnerId" label={t(locale, "imports.defaultOwner")} options={owners} emptyLabel={t(locale, "common.optional")} />
            )}
            <div className="actions"><button type="submit" className="btn">{t(locale, "imports.startParse")}</button></div>
          </ActionForm>
        </section>
      )}

      {processing && (
        <section className="card" aria-live="polite">
          <p>{t(locale, "imports.status.processing")}…</p>
          <p className="muted small-text">{t(locale, "imports.processingHint")}</p>
          {stillRetrying && job?.lastError && <Notice kind="warn">{t(locale, "imports.retrying", { error: job.lastError })}</Notice>}
        </section>
      )}

      {imp.status === "failed" && (
        <section className="card" aria-labelledby="fail-title">
          <h2 id="fail-title">{t(locale, "imports.status.failed")}</h2>
          <Notice kind="error">{t(locale, "imports.failedHelp", { error: imp.errorSummary ?? job?.lastError ?? "" })}</Notice>
          <form action={retryImportAction}>
            <input type="hidden" name="importId" value={id} />
            <button type="submit" className="btn">{t(locale, "imports.retry")}</button>
          </form>
        </section>
      )}

      {imp.status === "completed" && (
        <Notice kind="ok">
          {t(locale, "imports.completedSummary", {
            created: detail.rows.filter((r) => r.status === "created").length,
            linked: detail.rows.filter((r) => r.status === "linked").length,
            skipped: detail.rows.filter((r) => r.status === "skipped").length,
          })}{" "}
          <Link href={imp.kind === "companies" ? "/companies" : "/contacts"}>{t(locale, imp.kind === "companies" ? "nav.companies" : "nav.contacts")}</Link>
        </Notice>
      )}

      {imp.status === "cancelled" && <Notice kind="info">{t(locale, "imports.cancelled")}</Notice>}

      {imp.status === "ready" && (
        <>
          <section className="card" aria-labelledby="summary-title">
            <h2 id="summary-title">{t(locale, "imports.rowsValidTitle")}</h2>
            <p>{t(locale, "imports.summary", { total: imp.totalRows, valid: imp.validRows, errors: imp.errorRows, duplicates: imp.duplicateRows })}</p>
          </section>

          {errors.length > 0 && (
            <section className="card" style={{ marginTop: 16 }} aria-labelledby="errors-title">
              <h2 id="errors-title">{t(locale, "imports.errorsTitle")}</h2>
              <p className="muted small-text">{t(locale, "imports.errorsHelp")}</p>
              <ul className="list">
                {errors.map((r) => (
                  <li key={r.id}>
                    <div className="meta"><span className="pill error">{t(locale, "imports.rowNumber", { n: r.rowNumber })}</span></div>
                    {(r.errors as Array<{ field: string; code: string }>).map((e, i) => (
                      <div key={i} className="small-text">
                        <strong>{e.field}</strong>: {t(locale, `importError.${e.code}` as MessageKey)}
                      </div>
                    ))}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <ActionForm action={confirmImportAction.bind(null, id)} ariaLabel={t(locale, "imports.confirm")} className="stack" onSuccess="refresh">
            {duplicates.length > 0 && (
              <section className="card" style={{ marginTop: 16 }} aria-labelledby="dupes-title">
                <h2 id="dupes-title">{t(locale, "imports.duplicatesTitle")}</h2>
                <p className="muted small-text">{t(locale, "imports.duplicatesHelp")}</p>
                <ul className="list">
                  {duplicates.map((r) => {
                    const matchText = r.matchContactId
                      ? labels.contacts.get(r.matchContactId) ?? ""
                      : r.matchCompanyId
                        ? labels.companies.get(r.matchCompanyId) ?? ""
                        : "";
                    const sameFile = (r.normalized as { duplicateOfRow?: number }).duplicateOfRow;
                    const name = `decision_${r.id}`;
                    const label = (r.normalized as { firstName?: string; name?: string }).firstName ?? (r.normalized as { name?: string }).name ?? "";
                    return (
                      <li key={r.id}>
                        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
                          <legend className="title">
                            {t(locale, "imports.rowNumber", { n: r.rowNumber })} · {label}
                          </legend>
                          <div className="meta">
                            {matchText ? <span>{t(locale, "imports.matchesExisting")}: {matchText}</span> : null}
                            {sameFile ? <span>{t(locale, "imports.matchesRow", { row: sameFile })}</span> : null}
                          </div>
                          <div className="stack" style={{ marginTop: 8 }}>
                            {(["create", "link", "skip"] as const).map((choice) => {
                              const disabled = choice === "link" && !matchText;
                              return (
                                <label key={choice} className="inline-form" style={{ minHeight: 44, opacity: disabled ? 0.5 : 1 }}>
                                  <input type="radio" name={name} value={choice} disabled={disabled} style={{ width: 20, height: 20, minHeight: 0 }} />
                                  <span>{t(locale, `imports.decision.${choice}` as MessageKey)}</span>
                                </label>
                              );
                            })}
                          </div>
                        </fieldset>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}
            <div className="actions">
              <button type="submit" className="btn" disabled={imp.validRows + duplicates.length === 0}>{t(locale, "imports.confirm")}</button>
            </div>
          </ActionForm>

          <form action={cancelImportAction} style={{ marginTop: 12 }}>
            <input type="hidden" name="importId" value={id} />
            <button type="submit" className="btn secondary">{t(locale, "imports.cancel")}</button>
          </form>
        </>
      )}

      {detail.rows.length === 0 && imp.status === "pending" && <EmptyState title={t(locale, "imports.status.pending")} />}
    </main>
  );
}
