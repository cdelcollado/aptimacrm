import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { pageContext } from "@/server/web/context";
import { previewMerge } from "@/server/domain/contacts/merge";
import { PageHeader } from "@/components/page-header";
import { ActionForm } from "@/components/action-form";
import { mergeContactsAction } from "@/app/(app)/contacts/actions";
import { isUuid } from "@/server/security/guards";
import { DomainError, ValidationError } from "@/server/errors";
import { t, type MessageKey } from "@/i18n";
import { Notice } from "@/components/notice";

export const metadata: Metadata = { title: "Merge contacts" };
export const dynamic = "force-dynamic";

const FIELDS = [
  ["firstName", "contacts.firstName"],
  ["lastName", "contacts.lastName"],
  ["email", "contacts.email"],
  ["phone", "contacts.phone"],
  ["companyId", "contacts.company"],
] as const;

export default async function MergePage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ with?: string }>;
}) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  const { principal, locale } = await pageContext(`/contacts/merge/${id}`);
  const sourceId = typeof sp.with === "string" ? sp.with : "";
  if (!isUuid(id) || !isUuid(sourceId)) notFound();

  let preview;
  try {
    preview = await previewMerge(principal, id, sourceId);
  } catch (err) {
    if (err instanceof ValidationError) redirect(`/contacts/${id}`);
    if (err instanceof DomainError && err.code === "not_found") notFound();
    throw err;
  }

  const { survivor, source } = preview;
  const value = (c: typeof survivor, field: (typeof FIELDS)[number][0]) => {
    const v = c[field === "firstName" ? "firstName" : field === "lastName" ? "lastName" : field === "email" ? "email" : field === "phone" ? "phone" : "companyId"];
    return v ?? t(locale, "common.noValue");
  };

  return (
    <main id="main" className="page">
      <PageHeader title={t(locale, "contacts.mergePreview")} intro={t(locale, "contacts.mergeHelp")} actions={<Link className="btn secondary" href={`/contacts/${id}`}>{t(locale, "common.back")}</Link>} />
      <Notice kind="warn">{t(locale, "contacts.mergeWarning")}</Notice>
      <p>{t(locale, "contacts.mergeCounts", preview.counts)}</p>

      <ActionForm action={mergeContactsAction} ariaLabel={t(locale, "contacts.mergePreview")} className="stack">
        <input type="hidden" name="survivorId" value={survivor.id} />
        <input type="hidden" name="sourceId" value={source.id} />
        <input type="hidden" name="survivorVersion" value={survivor.version} />
        <input type="hidden" name="sourceVersion" value={source.version} />

        <div className="card card-flush">
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <caption className="sr-only">{t(locale, "contacts.pickField")}</caption>
            <thead>
              <tr>
                <th scope="col" style={{ textAlign: "left", padding: 12 }}>{t(locale, "common.status")}</th>
                <th scope="col" style={{ textAlign: "left", padding: 12 }}>{t(locale, "contacts.mergeSurvivor")}</th>
                <th scope="col" style={{ textAlign: "left", padding: 12 }}>{t(locale, "contacts.mergeSource")}</th>
              </tr>
            </thead>
            <tbody>
              {FIELDS.map(([field, labelKey]) => {
                const a = value(survivor, field);
                const b = value(source, field);
                const conflict = preview.conflicts.includes(field as never);
                const name = `pick_${field}`;
                return (
                  <tr key={field} style={{ borderTop: "1px solid var(--line)" }}>
                    <th scope="row" style={{ textAlign: "left", padding: 12, fontWeight: 600 }}>
                      {t(locale, labelKey as MessageKey)}
                      {conflict && <span className="pill warn" style={{ marginLeft: 8 }}>≠</span>}
                    </th>
                    <td style={{ padding: 12 }}>
                      <label className="inline-form">
                        <input type="radio" name={name} value="survivor" defaultChecked style={{ width: 20, height: 20, minHeight: 0 }} />
                        <span>{a}</span>
                      </label>
                    </td>
                    <td style={{ padding: 12 }}>
                      <label className="inline-form">
                        <input type="radio" name={name} value="source" style={{ width: 20, height: 20, minHeight: 0 }} />
                        <span>{b}</span>
                      </label>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="actions">
          <button type="submit" className="btn">{t(locale, "contacts.confirmMerge")}</button>
          <Link className="btn secondary" href={`/contacts/${id}`}>{t(locale, "common.cancel")}</Link>
        </div>
      </ActionForm>
    </main>
  );
}
