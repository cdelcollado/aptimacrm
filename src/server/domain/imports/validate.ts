import { companyDomainFromEmail, normalizeCompanyName, normalizeDomain, normalizeEmail, normalizePhone } from "@/server/normalize";

/**
 * Row validation for imports. Pure: lookups (existing contacts, owners, companies) are supplied
 * by the caller, so the rules are testable without a database.
 */

export interface RowError {
  field: string;
  code: string;
  message: string;
}

export interface NormalizedContactRow {
  firstName: string;
  lastName: string;
  email: string;
  emailNormalized: string;
  phone: string | null;
  companyName: string | null;
  ownerEmail: string | null;
}

export interface NormalizedCompanyRow {
  name: string;
  nameNormalized: string;
  website: string | null;
  domainNormalized: string | null;
  ownerEmail: string | null;
}

const clip = (v: string | undefined, n: number) => (v ?? "").trim().slice(0, n);

export function validateContactRecord(record: Record<string, string>): { value?: NormalizedContactRow; errors: RowError[] } {
  const errors: RowError[] = [];
  const firstName = clip(record.first_name, 120);
  if (!firstName) errors.push({ field: "first_name", code: "required", message: "First name is required" });

  const emailNormalized = normalizeEmail(record.email);
  if (!emailNormalized) errors.push({ field: "email", code: "invalid_email", message: "A valid email is required" });

  let phone: string | null = null;
  if (record.phone && record.phone.trim() !== "") {
    phone = normalizePhone(record.phone);
    if (!phone) errors.push({ field: "phone", code: "invalid_phone", message: "Phone number is not valid" });
  }

  if (errors.length) return { errors };
  return {
    errors,
    value: {
      firstName,
      lastName: clip(record.last_name, 120),
      email: clip(record.email, 254),
      emailNormalized: emailNormalized!,
      phone,
      companyName: clip(record.company_name, 200) || null,
      ownerEmail: normalizeEmail(record.owner_email) ?? null,
    },
  };
}

export function validateCompanyRecord(record: Record<string, string>): { value?: NormalizedCompanyRow; errors: RowError[] } {
  const errors: RowError[] = [];
  const name = clip(record.name, 200);
  if (!name) errors.push({ field: "name", code: "required", message: "Company name is required" });

  let domainNormalized: string | null = null;
  const website = clip(record.website, 253);
  if (website) {
    domainNormalized = normalizeDomain(website);
    if (!domainNormalized) errors.push({ field: "website", code: "invalid_domain", message: "Website is not a valid domain" });
  }

  if (errors.length) return { errors };
  return {
    errors,
    value: {
      name,
      nameNormalized: normalizeCompanyName(name),
      website: website || null,
      domainNormalized,
      ownerEmail: normalizeEmail(record.owner_email) ?? null,
    },
  };
}

/** Domain used for matching contacts to companies; free mail providers never match. */
export function contactCompanyDomain(email: string): string | null {
  return companyDomainFromEmail(email);
}

export function ownerEmailError(ownerEmail: string | null, knownActiveEmails: ReadonlySet<string>): RowError | null {
  if (!ownerEmail) return null;
  return knownActiveEmails.has(ownerEmail)
    ? null
    : { field: "owner_email", code: "unknown_owner", message: "Owner email does not match an active user" };
}
