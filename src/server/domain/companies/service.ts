import { and, eq, ne, or, sql } from "drizzle-orm";
import { getDb, withTx } from "@/server/db/client";
import { companies, deals } from "@/server/db/schema";
import { canMutate, canReassign, canRestore, type Principal } from "@/server/authz/policy";
import { conflict, forbidden, notFound, ValidationError } from "@/server/errors";
import { recordAudit } from "@/server/domain/audit";
import { cleanText, isUuid } from "@/server/security/guards";
import { normalizeCompanyName, normalizeDomain } from "@/server/normalize";

export interface CompanyFields {
  name: string;
  website: string;
  ownerId: string;
}

export interface ValidatedCompany {
  name: string;
  nameNormalized: string;
  domainNormalized: string | null;
}

export function validateCompanyFields(input: Pick<CompanyFields, "name" | "website">): { value?: ValidatedCompany; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const name = cleanText(input.name, 200);
  if (!name) errors.name = "required";
  const rawWebsite = cleanText(input.website, 253);
  const domain = rawWebsite ? normalizeDomain(rawWebsite) : null;
  if (rawWebsite && !domain) errors.website = "invalid";
  if (Object.keys(errors).length) return { errors };
  return {
    errors,
    value: { name: name!, nameNormalized: normalizeCompanyName(name!), domainNormalized: domain },
  };
}

/** Active companies that look like the same organisation (same domain or same normalized name). */
export async function findCompanyDuplicates(value: ValidatedCompany, excludeId?: string) {
  const conditions = [eq(companies.nameNormalized, value.nameNormalized)];
  if (value.domainNormalized) conditions.push(eq(companies.domainNormalized, value.domainNormalized));
  return getDb()
    .select({ id: companies.id, name: companies.name, ownerId: companies.ownerId })
    .from(companies)
    .where(
      and(
        eq(companies.status, "active"),
        or(...conditions),
        excludeId ? ne(companies.id, excludeId) : sql`true`,
      ),
    );
}

export async function createCompany(input: {
  principal: Principal;
  fields: CompanyFields;
  confirmDuplicate: boolean;
  requestId?: string | null;
}): Promise<{ id: string }> {
  const { value, errors } = validateCompanyFields(input.fields);
  let ownerId = input.principal.userId;
  if (input.fields.ownerId && input.fields.ownerId !== input.principal.userId) {
    if (!canReassign(input.principal)) throw forbidden("Salespeople can only create records they own");
    if (!isUuid(input.fields.ownerId)) errors.ownerId = "invalid";
    ownerId = input.fields.ownerId;
  }
  if (Object.keys(errors).length) throw new ValidationError(errors);

  const dupes = await findCompanyDuplicates(value!);
  if (dupes.length > 0 && !input.confirmDuplicate) {
    throw new ValidationError({ name: "duplicate" }, "A company with this name or domain already exists");
  }

  return withTx(async (tx) => {
    const [row] = await tx.insert(companies).values({ ...value!, ownerId }).returning({ id: companies.id });
    await recordAudit(tx, {
      actorId: input.principal.userId,
      action: "company.created",
      subjectType: "company",
      subjectId: row!.id,
      metadata: { ownerId, duplicateConfirmed: dupes.length > 0 },
      requestId: input.requestId ?? null,
    });
    return { id: row!.id };
  });
}

export async function updateCompany(principal: Principal, companyId: string, expectedVersion: number, fields: CompanyFields, requestId?: string | null) {
  const [current] = await getDb().select().from(companies).where(eq(companies.id, companyId)).limit(1);
  if (!current || current.status === "merged" || !canMutate(principal, current)) throw notFound("Company");
  if (current.version !== expectedVersion) throw conflict("Company changed by someone else; reload and try again");

  const { value, errors } = validateCompanyFields(fields);
  let ownerId = current.ownerId;
  if (fields.ownerId && fields.ownerId !== current.ownerId) {
    if (!canReassign(principal)) throw forbidden("Only managers can change the owner");
    if (!isUuid(fields.ownerId)) errors.ownerId = "invalid";
    ownerId = fields.ownerId;
  }
  if (Object.keys(errors).length) throw new ValidationError(errors);

  await withTx(async (tx) => {
    const [updated] = await tx
      .update(companies)
      .set({ ...value!, ownerId, version: current.version + 1, updatedAt: new Date() })
      .where(and(eq(companies.id, companyId), eq(companies.version, expectedVersion)))
      .returning({ id: companies.id });
    if (!updated) throw conflict("Company changed while saving; reload and try again");
    if (ownerId !== current.ownerId) {
      await recordAudit(tx, {
        actorId: principal.userId,
        action: "owner.changed",
        subjectType: "company",
        subjectId: companyId,
        metadata: { fromOwnerId: current.ownerId, toOwnerId: ownerId },
        requestId: requestId ?? null,
      });
    }
  });
}

export async function setCompanyArchived(principal: Principal, companyId: string, archived: boolean, requestId?: string | null) {
  if (!archived && !canRestore(principal)) throw forbidden("Only managers can restore records");
  const [current] = await getDb().select().from(companies).where(eq(companies.id, companyId)).limit(1);
  if (!current || !canMutate(principal, current)) throw notFound("Company");
  if (archived) {
    const open = await getDb()
      .select({ id: deals.id })
      .from(deals)
      .where(and(eq(deals.companyId, companyId), eq(deals.status, "open")));
    if (open.length > 0) {
      throw new ValidationError({ archive: "open_deals" }, `Close or archive ${open.length} open deal(s) first`);
    }
  }
  await withTx(async (tx) => {
    await tx
      .update(companies)
      .set({ status: archived ? "archived" : "active", archivedAt: archived ? new Date() : null, version: current.version + 1, updatedAt: new Date() })
      .where(eq(companies.id, companyId));
    await recordAudit(tx, {
      actorId: principal.userId,
      action: archived ? "company.archived" : "company.restored",
      subjectType: "company",
      subjectId: companyId,
      requestId: requestId ?? null,
    });
  });
}


