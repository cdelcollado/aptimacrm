import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { pageContext } from "@/server/web/context";
import { PageHeader, EmptyState } from "@/components/page-header";
import { ActionForm } from "@/components/action-form";
import { TextField, SelectField } from "@/components/fields";
import { createDealAction } from "@/app/(app)/deals/actions";
import { getCompanyDetail, listContactsForCompany, listOwnerOptions } from "@/server/queries/directory";
import { loadStages } from "@/server/queries/dashboard";
import { isManagerOrAdmin } from "@/server/authz/policy";
import { isUuid } from "@/server/security/guards";
import { t } from "@/i18n";

export const metadata: Metadata = { title: "New deal" };
export const dynamic = "force-dynamic";

export default async function NewDealPage(props: { searchParams: Promise<{ companyId?: string }> }) {
  const sp = await props.searchParams;
  const { principal, locale } = await pageContext("/deals/new");
  const companyId = typeof sp.companyId === "string" ? sp.companyId : "";
  if (!isUuid(companyId)) {
    return (
      <main id="main" className="page">
        <PageHeader title={t(locale, "deal.newTitle")} />
        <EmptyState title={t(locale, "companies.emptyFirst")}>
          <p><Link className="btn" href="/companies">{t(locale, "nav.companies")}</Link></p>
        </EmptyState>
      </main>
    );
  }
  const company = await getCompanyDetail(principal, companyId);
  if (!company) notFound();

  const contacts = (await listContactsForCompany(principal, companyId)).map((c) => ({ value: c.id, label: `${c.firstName} ${c.lastName}`.trim() }));
  const stages = (await loadStages()).filter((s) => s.kind === "open").map((s) => ({ value: s.id, label: s.name }));
  const owners = isManagerOrAdmin(principal) ? (await listOwnerOptions()).map((o) => ({ value: o.id, label: o.name })) : null;

  return (
    <main id="main" className="page">
      <PageHeader
        title={t(locale, "deal.newTitle")}
        intro={`${t(locale, "deal.company")}: ${company.company.name}`}
        actions={<Link className="btn secondary" href={`/companies/${companyId}`}>{t(locale, "common.back")}</Link>}
      />
      <div className="card" style={{ maxWidth: 720 }}>
        <ActionForm action={createDealAction} ariaLabel={t(locale, "deal.newTitle")} className="form-grid">
          <input type="hidden" name="companyId" value={companyId} />
          <TextField name="title" label={t(locale, "deal.title")} required maxLength={200} />
          <div className="form-grid two">
            <TextField name="amount" label={t(locale, "deal.amount")} inputMode="decimal" hint={t(locale, "deal.amountHelp")} maxLength={20} />
            <TextField name="expectedCloseOn" label={t(locale, "deal.expectedClose")} type="date" />
          </div>
          <SelectField name="stageId" label={t(locale, "deal.stage")} options={stages} defaultValue={stages[0]?.value ?? ""} />
          <SelectField name="primaryContactId" label={t(locale, "deal.contact")} options={contacts} emptyLabel={t(locale, "deal.noContact")} />
          {owners && <SelectField name="ownerId" label={t(locale, "deal.owner")} options={owners} defaultValue={principal.userId} />}
          <div className="actions">
            <button type="submit" className="btn">{t(locale, "deal.create")}</button>
            <Link className="btn secondary" href={`/companies/${companyId}`}>{t(locale, "common.cancel")}</Link>
          </div>
        </ActionForm>
      </div>
    </main>
  );
}
