import type { Metadata } from "next";
import Link from "next/link";
import { pageContext } from "@/server/web/context";
import { PageHeader } from "@/components/page-header";
import { ActionForm } from "@/components/action-form";
import { TextField, SelectField } from "@/components/fields";
import { listOwnerOptions } from "@/server/queries/directory";
import { createCompanyAction } from "@/app/(app)/companies/actions";
import { isManagerOrAdmin } from "@/server/authz/policy";
import { t } from "@/i18n";

export const metadata: Metadata = { title: "New company" };
export const dynamic = "force-dynamic";

export default async function NewCompanyPage() {
  const { principal, locale } = await pageContext("/companies/new");
  const owners = isManagerOrAdmin(principal) ? (await listOwnerOptions()).map((o) => ({ value: o.id, label: o.name })) : null;
  return (
    <main id="main" className="page">
      <PageHeader title={t(locale, "companies.new")} actions={<Link className="btn secondary" href="/companies">{t(locale, "common.back")}</Link>} />
      <div className="card" style={{ maxWidth: 720 }}>
        <ActionForm action={createCompanyAction} ariaLabel={t(locale, "companies.new")} className="form-grid">
          <TextField name="name" label={t(locale, "companies.name")} required maxLength={200} autoComplete="organization" />
          <TextField name="website" label={t(locale, "companies.website")} hint="acme.com" maxLength={253} />
          {owners && <SelectField name="ownerId" label={t(locale, "common.owner")} options={owners} defaultValue={principal.userId} />}
          <div className="field">
            <label className="inline-form" style={{ fontWeight: 500 }}>
              <input type="checkbox" name="confirmDuplicate" style={{ width: 20, height: 20, minHeight: 0 }} />
              <span>{t(locale, "companies.createAnyway")}</span>
            </label>
            <span className="hint">{t(locale, "companies.dupWarning")}</span>
          </div>
          <div className="actions">
            <button type="submit" className="btn">{t(locale, "common.create")}</button>
            <Link className="btn secondary" href="/companies">{t(locale, "common.cancel")}</Link>
          </div>
        </ActionForm>
      </div>
    </main>
  );
}
