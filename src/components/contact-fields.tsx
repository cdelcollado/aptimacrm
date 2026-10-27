import { TextField, SelectField, type Option } from "@/components/fields";
import type { Locale } from "@/i18n";
import { t } from "@/i18n";

/** Shared fields for the contact create and edit forms. */
export function ContactFields(props: {
  locale: Locale;
  defaults?: { firstName?: string; lastName?: string; email?: string | null; phone?: string | null; companyId?: string | null; ownerId?: string | null };
  companies: Option[];
  owners: Option[] | null;
}) {
  const d = props.defaults ?? {};
  return (
    <>
      <div className="form-grid two">
        <TextField name="firstName" label={t(props.locale, "contacts.firstName")} required defaultValue={d.firstName} autoComplete="given-name" maxLength={120} />
        <TextField name="lastName" label={t(props.locale, "contacts.lastName")} defaultValue={d.lastName} autoComplete="family-name" maxLength={120} />
        <TextField name="email" label={t(props.locale, "contacts.email")} type="email" inputMode="email" defaultValue={d.email} autoComplete="email" maxLength={254} />
        <TextField name="phone" label={t(props.locale, "contacts.phone")} inputMode="tel" type="tel" defaultValue={d.phone} autoComplete="tel" maxLength={40} hint="+34 600 000 000" />
      </div>
      <SelectField
        name="companyId"
        label={t(props.locale, "contacts.company")}
        options={props.companies}
        defaultValue={d.companyId ?? ""}
        emptyLabel={t(props.locale, "deal.noContact")}
      />
      {props.owners ? (
        <SelectField name="ownerId" label={t(props.locale, "common.owner")} options={props.owners} defaultValue={d.ownerId ?? ""} />
      ) : null}
    </>
  );
}
