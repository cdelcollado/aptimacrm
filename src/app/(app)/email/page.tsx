import type { Metadata } from "next";
import { pageContext } from "@/server/web/context";
import { PageHeader, EmptyState } from "@/components/page-header";
import { canManageEmailCapture } from "@/server/authz/policy";
import { listPendingEmails, listContactsForMatching } from "@/server/queries/email";
import { matchEmailAction, discardEmailAction } from "@/app/(app)/email/actions";
import { ActionForm } from "@/components/action-form";
import { SelectField } from "@/components/fields";
import { formatDateTime } from "@/components/format";
import { readFlash } from "@/server/web/flash";
import { Notice } from "@/components/notice";
import { t } from "@/i18n";

export const metadata: Metadata = { title: "Email capture" };
export const dynamic = "force-dynamic";

export default async function EmailPage(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await props.searchParams;
  const { principal, locale, tag } = await pageContext("/email");
  if (!canManageEmailCapture(principal)) {
    return (
      <main id="main" className="page">
        <PageHeader title={t(locale, "forbidden.title")} />
        <EmptyState title={t(locale, "forbidden.title")}>{t(locale, "forbidden.body")}</EmptyState>
      </main>
    );
  }
  const flash = readFlash(sp, locale);
  const pending = await listPendingEmails();
  const contacts = (await listContactsForMatching()).map((c) => ({ value: c.id, label: `${c.firstName} ${c.lastName}`.trim() + (c.email ? ` · ${c.email}` : "") }));

  return (
    <main id="main" className="page">
      <PageHeader title={t(locale, "email.title")} intro={t(locale, "email.intro")} />
      {flash && <Notice kind={flash.kind === "ok" ? "ok" : "error"}>{flash.text}</Notice>}
      {pending.length === 0 ? (
        <EmptyState title={t(locale, "email.empty")} />
      ) : (
        <ul className="stack" style={{ listStyle: "none", padding: 0 }}>
          {pending.map((m) => (
            <li key={m.id} className="card">
              <div className="meta">
                <span className={`pill ${m.status}`}>{t(locale, m.status === "ambiguous" ? "email.ambiguous" : "email.unmatched")}</span>
                <time dateTime={new Date(m.receivedAt).toISOString()}>{formatDateTime(m.receivedAt, tag)}</time>
              </div>
              <h2 style={{ fontSize: 16, margin: "8px 0 4px" }}>{m.subject || "—"}</h2>
              <p className="small-text muted" style={{ margin: 0 }}>{t(locale, "email.from")}: {m.fromNormalized}</p>
              <p className="small-text" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{m.bodyExcerpt.slice(0, 280)}</p>
              <ActionForm action={matchEmailAction.bind(null, m.id)} ariaLabel={t(locale, "email.match")} className="form-grid">
                <SelectField name="contactId" label={t(locale, "email.match")} options={contacts} required emptyLabel="—" />
                <div className="actions">
                  <button type="submit" className="btn">{t(locale, "email.match")}</button>
                </div>
              </ActionForm>
              <form action={discardEmailAction} style={{ marginTop: 8 }}>
                <input type="hidden" name="inboundId" value={m.id} />
                <button type="submit" className="btn secondary small">{t(locale, "email.discard")}</button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
