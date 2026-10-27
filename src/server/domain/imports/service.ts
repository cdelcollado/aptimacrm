import { and, asc, eq } from "drizzle-orm";
import { getDb, withTx } from "@/server/db/client";
import { getStorage } from "@/server/adapters/storage";
import { companies, contacts, importRows, imports, jobs, users } from "@/server/db/schema";
import { canImport, type Principal } from "@/server/authz/policy";
import { conflict, notFound, ValidationError } from "@/server/errors";
import { recordAudit } from "@/server/domain/audit";
import { enqueueJob } from "@/server/jobs/queue";
import { logger } from "@/server/log/logger";
import { cleanText, isUuid } from "@/server/security/guards";
import { sha256Hex } from "@/server/security/primitives";
import { CsvError, decodeUtf8, parseCsv } from "@/server/domain/imports/csv";
import { suggestMapping, validateMapping, type ColumnMapping, type ImportKind } from "@/server/domain/imports/mapping";
import { importObjectKey } from "@/server/domain/imports/keys";
import { normalizeCompanyName } from "@/server/normalize";
import { validateCompanyRecord, validateContactRecord } from "@/server/domain/imports/validate";

export type ImportDecision = "create" | "link" | "skip";

interface ImportSettings {
  headers: string[];
  fields: ColumnMapping | null;
  defaultOwnerId: string | null;
}

async function loadImportForPrincipal(principal: Principal, importId: string) {
  if (!isUuid(importId)) throw notFound("Import");
  const [imp] = await getDb().select().from(imports).where(eq(imports.id, importId)).limit(1);
  // Imports are a manager/admin workflow; uploader rights are not extended to salespeople.
  if (!imp || !canImport(principal)) throw notFound("Import");
  return imp;
}

/** Stage 1: receive the file, validate header and size, store it privately, create the import. */
export async function createImportFromUpload(input: {
  principal: Principal;
  kind: ImportKind;
  fileName: string;
  bytes: Buffer;
  requestId?: string | null;
}): Promise<{ id: string }> {
  if (!canImport(input.principal)) throw notFound("Import");
  if (input.kind !== "contacts" && input.kind !== "companies") throw new ValidationError({ kind: "invalid" });

  let headers: string[];
  let sha: string;
  try {
    const text = decodeUtf8(input.bytes);
    headers = parseCsv(text).headers;
    sha = sha256Hex(input.bytes);
  } catch (err) {
    if (err instanceof CsvError) throw new ValidationError({ file: err.code }, err.message);
    throw err;
  }
  const name = cleanText(input.fileName, 180) ?? "import.csv";

  const id = crypto.randomUUID();
  const put = await getStorage().put(importObjectKey(id), input.bytes, "text/csv");
  if (!put.ok) {
    logger.error("import.upload_storage_failed", { code: put.error.code, requestId: input.requestId });
    throw new ValidationError({ file: "storage" }, "The file could not be stored. Try again.");
  }

  await getDb().insert(imports).values({
    id,
    kind: input.kind,
    status: "pending",
    fileName: name,
    fileKey: importObjectKey(id),
    fileSha256: sha,
    columnMapping: { headers, fields: null, defaultOwnerId: null } satisfies ImportSettings,
    createdBy: input.principal.userId,
  });
  return { id };
}

/** Stage 2: the user confirms the column mapping. This is the only place a parse job is created. */
export async function setImportMapping(input: {
  principal: Principal;
  importId: string;
  fields: ColumnMapping;
  defaultOwnerId: string | null;
  requestId?: string | null;
}): Promise<void> {
  const imp = await loadImportForPrincipal(input.principal, input.importId);
  const settings = imp.columnMapping as unknown as ImportSettings;
  const kind = imp.kind as ImportKind;

  if (imp.status !== "pending") throw conflict("This import is no longer waiting for a mapping");

  const errors = validateMapping(kind, input.fields, settings.headers);
  if (input.defaultOwnerId && !isUuid(input.defaultOwnerId)) errors.defaultOwnerId = "invalid";
  if (Object.keys(errors).length) throw new ValidationError(errors, "Map the required columns");

  // Rows without an owner email get this owner. When none is chosen, the importer owns them.
  const owner = input.defaultOwnerId ?? input.principal.userId;
  if (input.defaultOwnerId) {
    const [u] = await getDb().select({ id: users.id }).from(users).where(and(eq(users.id, owner), eq(users.active, true))).limit(1);
    if (!u) throw new ValidationError({ defaultOwnerId: "unknown_user" });
  }

  await withTx(async (tx) => {
    const [locked] = await tx.select().from(imports).where(eq(imports.id, imp.id)).for("update").limit(1);
    if (!locked || locked.status !== "pending") return;
    await tx
      .update(imports)
      .set({
        status: "processing",
        columnMapping: { headers: settings.headers, fields: input.fields, defaultOwnerId: owner } satisfies ImportSettings,
      })
      .where(eq(imports.id, imp.id));
    await enqueueJob(tx, {
      kind: "import.parse",
      payload: { importId: imp.id },
      idempotencyKey: `import.parse:${imp.id}`,
      requestId: input.requestId ?? null,
    });
  });
}

/** Re-run a failed parse. Only the job row is reset; the import and its file are unchanged. */
export async function retryImportParse(principal: Principal, importId: string, requestId?: string | null): Promise<void> {
  const imp = await loadImportForPrincipal(principal, importId);
  if (imp.status !== "failed") throw conflict("Only failed imports can be retried");
  await withTx(async (tx) => {
    await tx
      .update(imports)
      .set({ status: "processing", errorSummary: null, completedAt: null })
      .where(eq(imports.id, imp.id));
    await tx
      .update(jobs)
      .set({ status: "pending", attempts: 0, runAfter: new Date(), lastError: null, finishedAt: null })
      .where(eq(jobs.idempotencyKey, `import.parse:${imp.id}`));
    await enqueueJob(tx, { kind: "import.parse", payload: { importId: imp.id }, idempotencyKey: `import.parse:${imp.id}:retry:${Date.now()}`, requestId: requestId ?? null });
  });
}

/**
 * Stage 3: apply the reviewer's decisions and create records. One transaction. Every duplicate
 * must have an explicit decision; nothing is created silently.
 */
export async function confirmImport(input: {
  principal: Principal;
  importId: string;
  decisions: Record<string, ImportDecision>;
  requestId?: string | null;
}): Promise<{ created: number; linked: number; skipped: number; alreadyCompleted: boolean }> {
  const imp = await loadImportForPrincipal(input.principal, input.importId);
  const kind = imp.kind as ImportKind;

  return withTx(async (tx) => {
    const [locked] = await tx.select().from(imports).where(eq(imports.id, imp.id)).for("update").limit(1);
    if (!locked) throw notFound("Import");
    if (locked.status === "completed") return { created: 0, linked: 0, skipped: 0, alreadyCompleted: true };
    if (locked.status !== "ready") throw conflict("Only a reviewed import can be confirmed");

    const rows = await tx.select().from(importRows).where(eq(importRows.importId, imp.id)).orderBy(asc(importRows.rowNumber));
    const duplicates = rows.filter((r) => r.status === "duplicate");

    for (const row of duplicates) {
      const decision = input.decisions[row.id];
      if (!decision) throw new ValidationError({ decisions: "missing" }, "Choose an action for every duplicate");
      if (!["create", "link", "skip"].includes(decision)) throw new ValidationError({ decisions: "invalid" });
      if (decision === "link" && !row.matchContactId && !row.matchCompanyId) {
        throw new ValidationError({ decisions: "no_match" }, "Only rows that match an existing record can be linked");
      }
    }

    const counts = { created: 0, linked: 0, skipped: 0, alreadyCompleted: false };
    const now = new Date();

    for (const row of rows) {
      if (row.status === "error") continue;
      const n = row.normalized as Record<string, unknown>;

      if (row.status === "duplicate") {
        const decision = input.decisions[row.id] as ImportDecision;
        if (decision === "link") {
          await tx.update(importRows).set({ status: "linked", decision, decidedBy: input.principal.userId, decidedAt: now }).where(eq(importRows.id, row.id));
          counts.linked += 1;
          continue;
        }
        if (decision === "skip") {
          await tx.update(importRows).set({ status: "skipped", decision, decidedBy: input.principal.userId, decidedAt: now }).where(eq(importRows.id, row.id));
          counts.skipped += 1;
          continue;
        }
        await tx.update(importRows).set({ decision, decidedBy: input.principal.userId, decidedAt: now }).where(eq(importRows.id, row.id));
      }

      if (kind === "contacts") {
        const v = validateContactRecord({
          first_name: String(n.firstName ?? ""),
          last_name: String(n.lastName ?? ""),
          email: String(n.email ?? ""),
          phone: String(n.phone ?? ""),
        });
        if (!v.value) continue;
        await tx.insert(contacts).values({
          firstName: v.value.firstName,
          lastName: v.value.lastName,
          email: v.value.email,
          emailNormalized: v.value.emailNormalized,
          phone: v.value.phone,
          companyId: isUuid(n.companyId) ? (n.companyId as string) : null,
          ownerId: String(n.ownerId),
        });
      } else {
        const v = validateCompanyRecord({
          name: String(n.name ?? ""),
          website: String(n.website ?? ""),
        });
        if (!v.value) continue;
        await tx.insert(companies).values({
          name: v.value.name,
          nameNormalized: normalizeCompanyName(v.value.name),
          domainNormalized: v.value.domainNormalized,
          ownerId: String(n.ownerId),
        });
      }
      counts.created += 1;
      if (row.status !== "duplicate") {
        await tx.update(importRows).set({ status: "created", decidedBy: input.principal.userId, decidedAt: now }).where(eq(importRows.id, row.id));
      } else {
        await tx.update(importRows).set({ status: "created" }).where(eq(importRows.id, row.id));
      }
    }

    await tx
      .update(imports)
      .set({ status: "completed", completedAt: now })
      .where(eq(imports.id, imp.id));

    await enqueueJob(tx, {
      kind: "import.cleanup_file",
      payload: { importId: imp.id },
      idempotencyKey: `import.cleanup:${imp.id}`,
      requestId: input.requestId ?? null,
    });

    await recordAudit(tx, {
      actorId: input.principal.userId,
      action: "import.confirmed",
      subjectType: "import",
      subjectId: imp.id,
      metadata: { kind, ...counts, rows: rows.length },
      requestId: input.requestId ?? null,
    });

    return counts;
  });
}

export async function cancelImport(principal: Principal, importId: string, requestId?: string | null): Promise<void> {
  const imp = await loadImportForPrincipal(principal, importId);
  if (imp.status === "completed" || imp.status === "cancelled") return;
  await withTx(async (tx) => {
    await tx.update(imports).set({ status: "cancelled", completedAt: new Date() }).where(eq(imports.id, imp.id));
    await enqueueJob(tx, { kind: "import.cleanup_file", payload: { importId: imp.id }, idempotencyKey: `import.cleanup:${imp.id}`, requestId: requestId ?? null });
    await recordAudit(tx, { actorId: principal.userId, action: "import.cancelled", subjectType: "import", subjectId: imp.id, requestId: requestId ?? null });
  });
}



