import type { Metadata } from "next";
import { pageContext } from "@/server/web/context";
import { PageHeader } from "@/components/page-header";
import { ActionForm } from "@/components/action-form";
import { ContactFields } from "@/components/contact-fields";
import { listCompanies, listOwnerOptions } from "@/server/queries/directory";
import { createContactAction } from "@/app/(app)/contacts/actions";
import { isManagerOrAdmin } from "@/server/authz/policy";
import { t } from "@/i18n";
import Link from "next/link";

export const metadata: Metadata = { title: "New contact" };
export const dynamic = "force-dynamic";

export default async function NewContactPage() {
  const { principal, locale } = await pageContext("/contacts/new");
  const companies = (await listCompanies(principal, {})).map((c) => ({ value: c.id, label: c.name }));
  const owners = isManagerOrAdmin(principal) ? (await listOwnerOptions()).map((o) => ({ value: o.id, label: o.name })) : null;

  return (
    <main id="main" className="page">
      <PageHeader title={t(locale, "contacts.new")} actions={<Link className="btn secondary" href="/contacts">{t(locale, "common.back")}</Link>} />
      <div className="card" style={{ maxWidth: 720 }}>
        <ActionForm action={createContactAction} ariaLabel={t(locale, "contacts.new")} className="form-grid">
          <ContactFields locale={locale} companies={companies} owners={owners} defaults={{ ownerId: principal.userId }} />
          <div className="field">
            <label className="row" style={{ justifyContent: "flex-start", fontWeight: 500 }}>
              <input type="checkbox" name="confirmDuplicate" style={{ width: 20, height: 20, minHeight: 0 }} />
              <span>{t(locale, "contacts.createDuplicate")}</span>
            </label>
            <span className="hint">{t(locale, "contacts.dupWarning")}</span>
          </div>
          <div className="actions">
            <button type="submit" className="btn">{t(locale, "common.create")}</button>
            <Link className="btn secondary" href="/contacts">{t(locale, "common.cancel")}</Link>
          </div>
        </ActionForm>
      </div>
    </main>
  );
}
