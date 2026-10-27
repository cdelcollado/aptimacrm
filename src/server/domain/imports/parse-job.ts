import { and, eq, inArray } from "drizzle-orm";
import { getDb, withTx } from "@/server/db/client";
import { getStorage } from "@/server/adapters/storage";
import { companies, contacts, importRows, imports, users } from "@/server/db/schema";
import { logger } from "@/server/log/logger";
import { normalizeCompanyName } from "@/server/normalize";
import { decodeUtf8, parseCsv, CsvError } from "@/server/domain/imports/csv";
import { mapRow, type ColumnMapping, type ImportKind } from "@/server/domain/imports/mapping";
import { validateCompanyRecord, validateContactRecord, type RowError } from "@/server/domain/imports/validate";
import { importObjectKey } from "@/server/domain/imports/keys";

const BATCH = 500;

interface ImportSettings {
  headers: string[];
  fields: ColumnMapping;
  defaultOwnerId: string | null;
}

export interface ParsedRowRecord {
  rowNumber: number;
  status: "valid" | "error" | "duplicate";
  normalized: Record<string, unknown>;
  errors: RowError[];
  matchContactId: string | null;
  matchCompanyId: string | null;
}

/**
 * Pure planning step: given parsed rows and the lookups, decide each row's status. Kept separate
 * from I/O so duplicate rules are unit-tested without a database.
 */
export function planRows(input: {
  kind: ImportKind;
  headers: string[];
  rows: string[][];
  fields: ColumnMapping;
  defaultOwnerId: string | null;
  activeUserIdByEmail: ReadonlyMap<string, string>;
  existingContactIdByEmail?: ReadonlyMap<string, string>;
  existingCompanyIdByDomain?: ReadonlyMap<string, string>;
  existingCompanyIdByName?: ReadonlyMap<string, string>;
  companyIdByName?: ReadonlyMap<string, string>;
}): ParsedRowRecord[] {
  const seenEmail = new Map<string, number>();
  const seenDomain = new Map<string, number>();
  const seenName = new Map<string, number>();
  const out: ParsedRowRecord[] = [];

  input.rows.forEach((row, index) => {
    const rowNumber = index + 2; // header is row 1 in the user's spreadsheet
    const record = mapRow(input.kind, input.headers, row, input.fields);
    const base: ParsedRowRecord = { rowNumber, status: "valid", normalized: {}, errors: [], matchContactId: null, matchCompanyId: null };

    if (input.kind === "contacts") {
      const { value, errors } = validateContactRecord(record);
      if (value?.ownerEmail && !input.activeUserIdByEmail.has(value.ownerEmail)) {
        errors.push({ field: "owner_email", code: "unknown_owner", message: "Owner email does not match an active user" });
      }
      if (errors.length || !value) {
        out.push({ ...base, status: "error", errors });
        return;
      }
      const ownerId = value.ownerEmail ? input.activeUserIdByEmail.get(value.ownerEmail)! : input.defaultOwnerId;
      const companyId = value.companyName ? input.companyIdByName?.get(normalizeCompanyName(value.companyName)) ?? null : null;
      base.normalized = {
        firstName: value.firstName,
        lastName: value.lastName,
        email: value.email,
        emailNormalized: value.emailNormalized,
        phone: value.phone,
        companyName: value.companyName,
        companyId,
        ownerId,
      };

      const existing = input.existingContactIdByEmail?.get(value.emailNormalized);
      if (existing) {
        out.push({ ...base, status: "duplicate", matchContactId: existing });
        return;
      }
      const earlier = seenEmail.get(value.emailNormalized);
      if (earlier !== undefined) {
        out.push({ ...base, status: "duplicate", normalized: { ...base.normalized, duplicateOfRow: earlier } });
        return;
      }
      seenEmail.set(value.emailNormalized, rowNumber);
      out.push(base);
      return;
    }

    const { value, errors } = validateCompanyRecord(record);
    if (value?.ownerEmail && !input.activeUserIdByEmail.has(value.ownerEmail)) {
      errors.push({ field: "owner_email", code: "unknown_owner", message: "Owner email does not match an active user" });
    }
    if (errors.length || !value) {
      out.push({ ...base, status: "error", errors });
      return;
    }
    const ownerId = value.ownerEmail ? input.activeUserIdByEmail.get(value.ownerEmail)! : input.defaultOwnerId;
    base.normalized = {
      name: value.name,
      nameNormalized: value.nameNormalized,
      website: value.website,
      domainNormalized: value.domainNormalized,
      ownerId,
    };

    const byDomain = value.domainNormalized ? input.existingCompanyIdByDomain?.get(value.domainNormalized) : undefined;
    const byName = input.existingCompanyIdByName?.get(value.nameNormalized);
    const existing = byDomain ?? byName;
    if (existing) {
      out.push({ ...base, status: "duplicate", matchCompanyId: existing });
      return;
    }
    const earlier = (value.domainNormalized && seenDomain.get(value.domainNormalized)) ?? seenName.get(value.nameNormalized);
    if (earlier !== undefined) {
      out.push({ ...base, status: "duplicate", normalized: { ...base.normalized, duplicateOfRow: earlier } });
      return;
    }
    if (value.domainNormalized) seenDomain.set(value.domainNormalized, rowNumber);
    seenName.set(value.nameNormalized, rowNumber);
    out.push(base);
  });
  return out;
}

/** Worker entry point. Re-entrant: it rebuilds the row set from scratch on every attempt. */
export async function parseImportJob(importId: string, requestId: string): Promise<void> {
  const db = getDb();
  const [imp] = await db.select().from(imports).where(eq(imports.id, importId)).limit(1);
  if (!imp) {
    logger.warn("import.parse_missing", { importId, requestId });
    return;
  }
  if (imp.status !== "processing") {
    logger.info("import.parse_skipped", { importId, status: imp.status, requestId });
    return;
  }

  const settings = imp.columnMapping as unknown as ImportSettings;
  const kind = imp.kind as ImportKind;

  const obj = await getStorage().get(importObjectKey(imp.id));
  if (!obj.ok) {
    if (obj.error.retryable) throw new Error(`storage: ${obj.error.message}`);
    await failImport(importId, `The uploaded file is no longer available (${obj.error.code})`);
    return;
  }

  let parsed;
  try {
    parsed = parseCsv(decodeUtf8(obj.value));
  } catch (err) {
    const message = err instanceof CsvError ? err.message : "The file could not be read";
    await failImport(importId, message);
    return;
  }

  const users_ = await db.select({ id: users.id, email: users.emailNormalized }).from(users).where(eq(users.active, true));
  const activeUserIdByEmail = new Map(users_.map((u) => [u.email, u.id]));

  const contactEmails: string[] = [];
  const domainsOrNames = new Set<string>();
  const companyNames = new Set<string>();
  const rawEmails = parsed.rows.map((r) => mapRow(kind, parsed.headers, r, settings.fields));
  for (const rec of rawEmails) {
    if (kind === "contacts") {
      const { value } = validateContactRecord(rec);
      if (value) contactEmails.push(value.emailNormalized);
      if (value?.companyName) companyNames.add(normalizeCompanyName(value.companyName));
    } else {
      const { value } = validateCompanyRecord(rec);
      if (value?.domainNormalized) domainsOrNames.add(value.domainNormalized);
      if (value) companyNames.add(value.nameNormalized);
    }
  }

  const existingContactIdByEmail = new Map<string, string>();
  const existingCompanyIdByDomain = new Map<string, string>();
  const existingCompanyIdByName = new Map<string, string>();
  const companyIdByName = new Map<string, string>();

  if (kind === "contacts" && contactEmails.length) {
    const rows = await db
      .select({ id: contacts.id, email: contacts.emailNormalized })
      .from(contacts)
      .where(and(eq(contacts.status, "active"), inArray(contacts.emailNormalized, [...new Set(contactEmails)])));
    for (const r of rows) if (r.email) existingContactIdByEmail.set(r.email, r.id);
  }

  if (companyNames.size) {
    const rows = await db
      .select({ id: companies.id, name: companies.nameNormalized, domain: companies.domainNormalized })
      .from(companies)
      .where(and(eq(companies.status, "active"), inArray(companies.nameNormalized, [...companyNames])));
    for (const r of rows) {
      existingCompanyIdByName.set(r.name, r.id);
      companyIdByName.set(r.name, r.id);
      if (r.domain) existingCompanyIdByDomain.set(r.domain, r.id);
    }
  }
  if (kind === "companies" && domainsOrNames.size) {
    const rows = await db
      .select({ id: companies.id, domain: companies.domainNormalized })
      .from(companies)
      .where(and(eq(companies.status, "active"), inArray(companies.domainNormalized, [...domainsOrNames])));
    for (const r of rows) if (r.domain) existingCompanyIdByDomain.set(r.domain, r.id);
  }

  const planned = planRows({
    kind,
    headers: parsed.headers,
    rows: parsed.rows,
    fields: settings.fields,
    defaultOwnerId: settings.defaultOwnerId,
    activeUserIdByEmail,
    existingContactIdByEmail,
    existingCompanyIdByDomain,
    existingCompanyIdByName,
    companyIdByName,
  });

  const counts = {
    total: planned.length,
    valid: planned.filter((p) => p.status === "valid").length,
    error: planned.filter((p) => p.status === "error").length,
    duplicate: planned.filter((p) => p.status === "duplicate").length,
  };

  await withTx(async (tx) => {
    const [locked] = await tx.select().from(imports).where(eq(imports.id, importId)).for("update").limit(1);
    if (!locked || locked.status !== "processing") return;
    await tx.delete(importRows).where(eq(importRows.importId, importId));
    for (let i = 0; i < planned.length; i += BATCH) {
      const slice = planned.slice(i, i + BATCH);
      await tx.insert(importRows).values(
        slice.map((p) => ({
          importId,
          rowNumber: p.rowNumber,
          normalized: p.normalized,
          errors: p.errors,
          status: p.status,
          matchContactId: p.matchContactId,
          matchCompanyId: p.matchCompanyId,
        })),
      );
    }
    await tx
      .update(imports)
      .set({
        status: "ready",
        totalRows: counts.total,
        validRows: counts.valid,
        errorRows: counts.error,
        duplicateRows: counts.duplicate,
        errorSummary: null,
      })
      .where(eq(imports.id, importId));
  });

  logger.info("import.parsed", { importId, ...counts, requestId });
}

async function failImport(importId: string, summary: string): Promise<void> {
  await getDb()
    .update(imports)
    .set({ status: "failed", errorSummary: summary.slice(0, 500), completedAt: new Date() })
    .where(eq(imports.id, importId));
  logger.warn("import.failed", { importId, summary: summary.slice(0, 200) });
}


