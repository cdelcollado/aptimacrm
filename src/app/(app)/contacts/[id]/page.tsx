import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { pageContext } from "@/server/web/context";
import { getContactDetail } from "@/server/queries/directory";
import { listCompanies, listOwnerOptions } from "@/server/queries/directory";
import { PageHeader, EmptyState } from "@/components/page-header";
import { Notice } from "@/components/notice";
import { readFlash } from "@/server/web/flash";
import { formatDateTime } from "@/components/format";
import { ActionForm } from "@/components/action-form";
import { ContactFields } from "@/components/contact-fields";
import { updateContactAction, setContactArchivedAction } from "@/app/(app)/contacts/actions";
import { isManagerOrAdmin, canReassign } from "@/server/authz/policy";
import { formatEuro } from "@/server/domain/metrics";
import { isUuid } from "@/server/security/guards";
import { t, type MessageKey } from "@/i18n";

export const metadata: Metadata = { title: "Contact" };
export const dynamic = "force-dynamic";

export default async function ContactDetailPage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  const { principal, locale, tag } = await pageContext(`/contacts/${id}`);
  if (!isUuid(id)) notFound();
  const detail = await getContactDetail(principal, id);
  if (!detail) notFound();

  const { contact } = detail;
  const archived = contact.status === "archived";
  const flash = readFlash(sp, locale);
  const companies = (await listCompanies(principal, {})).map((c) => ({ value: c.id, label: c.name }));
  const owners = canReassign(principal) ? (await listOwnerOptions()).map((o) => ({ value: o.id, label: o.name })) : null;
  const bound = updateContactAction.bind(null, contact.id);

  return (
    <main id="main" className="page">
      <PageHeader
        title={`${contact.firstName} ${contact.lastName}`.trim()}
        intro={[detail.companyName, detail.ownerName && `${t(locale, "common.owner")}: ${detail.ownerName}`].filter(Boolean).join(" · ")}
        actions={<Link className="btn secondary" href="/contacts">{t(locale, "common.back")}</Link>}
      />
      {flash && <Notice kind={flash.kind === "ok" ? "ok" : "error"}>{flash.text}</Notice>}
      {archived && <Notice kind="info">{t(locale, "contacts.archivedView")}</Notice>}

      {detail.duplicates.length > 0 && (
        <Notice kind="warn">
          <span>
            {t(locale, "contacts.dupWarning")}{" "}
            {detail.duplicates.map((d, i) => (
              <span key={d.id}>
                {i > 0 && ", "}
                <Link href={`/contacts/${d.id}`}>{d.firstName} {d.lastName}</Link>
              </span>
            ))}
          </span>
        </Notice>
      )}

      <div className="grid grid-2">
        <div className="stack">
          <section className="card" aria-labelledby="details-title">
            <h2 id="details-title">{t(locale, "common.edit")}</h2>
            {canMutateNotice(detail.canMutate, locale)}
            {detail.canMutate && !archived && (
              <ActionForm action={bound} ariaLabel={t(locale, "common.edit")} className="form-grid" onSuccess="refresh">
                <input type="hidden" name="version" value={contact.version} />
                <ContactFields
                  locale={locale}
                  companies={companies}
                  owners={owners}
                  defaults={{
                    firstName: contact.firstName,
                    lastName: contact.lastName,
                    email: contact.email,
                    phone: contact.phone,
                    companyId: contact.companyId,
                    ownerId: contact.ownerId,
                  }}
                />
                <div className="actions">
                  <button type="submit" className="btn">{t(locale, "common.save")}</button>
                </div>
              </ActionForm>
            )}
            {!detail.canMutate || archived ? (
              <dl className="small-text" style={{ display: "grid", gridTemplateColumns: "max-content 1fr", gap: "6px 16px", margin: 0 }}>
                <dt className="muted">{t(locale, "contacts.email")}</dt><dd style={{ margin: 0 }}>{contact.email ?? t(locale, "common.noValue")}</dd>
                <dt className="muted">{t(locale, "contacts.phone")}</dt><dd style={{ margin: 0 }}>{contact.phone ?? t(locale, "common.noValue")}</dd>
                <dt className="muted">{t(locale, "contacts.company")}</dt><dd style={{ margin: 0 }}>{detail.companyVisible ? detail.companyName ?? t(locale, "common.noValue") : t(locale, "deal.restrictedCompany")}</dd>
              </dl>
            ) : null}
          </section>

          <section className="card" aria-labelledby="timeline-title">
            <h2 id="timeline-title">{t(locale, "contacts.timeline")}</h2>
            {detail.timeline.length === 0 ? (
              <p className="muted">{t(locale, "contacts.noActivity")}</p>
            ) : (
              <ul className="timeline">
                {detail.timeline.map((a) => (
                  <li key={a.id} className={a.kind}>
                    <div className="meta">
                      <span>{t(locale, `activity.kind.${a.kind}` as MessageKey)}</span>
                      {" · "}
                      <time dateTime={new Date(a.occurredAt).toISOString()}>{formatDateTime(a.occurredAt, tag)}</time>
                      {a.source === "bcc" ? ` · ${t(locale, "email.title")}` : ""}
                    </div>
                    <div className="body">{a.body}</div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="stack">
          <section className="card" aria-labelledby="deals-title">
            <h2 id="deals-title">{t(locale, "companies.deals")}</h2>
            {detail.deals.length === 0 ? (
              <p className="muted">{t(locale, "contacts.noDeals")}</p>
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

          {detail.canMutate && isManagerOrAdmin(principal) && detail.duplicates.length > 0 && (
            <section className="card" aria-labelledby="merge-title">
              <h2 id="merge-title">{t(locale, "contacts.merge")}</h2>
              <p className="muted small-text">{t(locale, "contacts.mergeHelp")}</p>
              <ul className="list">
                {detail.duplicates.map((d) => (
                  <li key={d.id}>
                    <Link className="btn secondary" href={`/contacts/merge/${contact.id}?with=${d.id}`}>
                      {d.firstName} {d.lastName}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="card" aria-labelledby="archive-title">
            <h2 id="archive-title">{archived ? t(locale, "common.restore") : t(locale, "common.archive")}</h2>
            {detail.canMutate && (
              <form action={setContactArchivedAction} className="stack">
                <input type="hidden" name="contactId" value={contact.id} />
                <input type="hidden" name="archive" value={archived ? "0" : "1"} />
                <button type="submit" className={archived ? "btn secondary" : "btn secondary"} disabled={archived && !isManagerOrAdmin(principal)}>
                  {archived ? t(locale, "common.restore") : t(locale, "common.archive")}
                </button>
                {!archived && <p className="muted small-text">{t(locale, "contacts.archiveBlocked")}</p>}
              </form>
            )}
          </section>

          {!detail.canMutate && <EmptyState title={t(locale, "forbidden.title")}>{t(locale, "forbidden.body")}</EmptyState>}
        </div>
      </div>
    </main>
  );
}

function canMutateNotice(canMutate: boolean, locale: Parameters<typeof t>[0]) {
  if (canMutate) return null;
  return <p className="muted small-text">{t(locale, "forbidden.body")}</p>;
}
