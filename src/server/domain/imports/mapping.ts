import { normalizeHeader } from "@/server/normalize";

/**
 * Column mapping. Each target field is mapped to a source header by the user; a heuristic
 * pre-selects the obvious matches so the common case is one click.
 */

export type ImportKind = "contacts" | "companies";

export const TARGET_FIELDS = {
  contacts: ["first_name", "last_name", "email", "phone", "company_name", "owner_email"] as const,
  companies: ["name", "website", "owner_email"] as const,
};

export const REQUIRED_FIELDS: Record<ImportKind, readonly string[]> = {
  contacts: ["first_name", "email"],
  companies: ["name"],
};

export type ColumnMapping = Record<string, string | null>;

const SYNONYMS: Record<string, string[]> = {
  first_name: ["first_name", "firstname", "nombre", "nom", "name", "given_name"],
  last_name: ["last_name", "lastname", "apellidos", "cognoms", "surname", "family_name"],
  email: ["email", "e_mail", "correo", "correu", "mail", "email_address"],
  phone: ["phone", "telefono", "telèfon", "telefon", "tel", "mobile", "movil", "mòbil"],
  company_name: ["company", "company_name", "empresa", "empresa_nombre", "organisation", "organization", "organitzacio"],
  owner_email: ["owner_email", "owner", "responsable", "responsable_email", "email_responsable"],
  name: ["name", "company", "company_name", "empresa", "nombre", "nom"],
  website: ["website", "web", "domain", "dominio", "domini", "url"],
};

export function suggestMapping(kind: ImportKind, headers: string[]): ColumnMapping {
  const normalized = headers.map((h) => normalizeHeader(h));
  const mapping: ColumnMapping = {};
  for (const target of TARGET_FIELDS[kind]) {
    const candidates = SYNONYMS[target] ?? [target];
    const idx = candidates.map((c) => normalized.indexOf(c)).find((i) => i >= 0);
    mapping[target] = idx === undefined ? null : headers[idx]!;
  }
  return mapping;
}

export function validateMapping(kind: ImportKind, mapping: ColumnMapping, headers: string[]): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of REQUIRED_FIELDS[kind]) {
    if (!mapping[field] || !headers.includes(mapping[field]!)) errors[field] = "required";
  }
  const used = Object.values(mapping).filter(Boolean);
  if (new Set(used).size !== used.length) errors._general = "one_column_per_field";
  return errors;
}

/** Turn a raw row (array) into a record keyed by target field, using the chosen mapping. */
export function mapRow(kind: ImportKind, headers: string[], row: string[], mapping: ColumnMapping): Record<string, string> {
  const record: Record<string, string> = {};
  for (const field of TARGET_FIELDS[kind]) {
    const header = mapping[field];
    if (!header) continue;
    const idx = headers.indexOf(header);
    record[field] = (row[idx] ?? "").trim();
  }
  return record;
}
