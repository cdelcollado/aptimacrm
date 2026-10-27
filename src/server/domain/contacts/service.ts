import { and, eq, ne, sql } from "drizzle-orm";
import { getDb, withTx } from "@/server/db/client";
import { companies, contacts, deals, users } from "@/server/db/schema";
import { canMutate, canReassign, canRestore, type Principal } from "@/server/authz/policy";
import { conflict, forbidden, notFound, ValidationError } from "@/server/errors";
import { recordAudit } from "@/server/domain/audit";
import { cleanText, isUuid } from "@/server/security/guards";
import { normalizeEmail, normalizePhone } from "@/server/normalize";

export interface ContactInput {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  companyId: string;
  ownerId: string;
}

export interface ValidatedContact {
  firstName: string;
  lastName: string;
  email: string | null;
  emailNormalized: string | null;
  phone: string | null;
  companyId: string | null;
  ownerId: string;
}

/** Shared validation for manual edits and imports. Returns field errors, not exceptions. */
export function validateContactFields(input: Partial<ContactInput>): { value?: Omit<ValidatedContact, "ownerId">; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const firstName = cleanText(input.firstName, 120);
  const lastName = cleanText(input.lastName, 120) ?? "";
  if (!firstName) errors.firstName = "required";

  const rawEmail = cleanText(input.email, 254);
  const emailNormalized = rawEmail ? normalizeEmail(rawEmail) : null;
  if (rawEmail && !emailNormalized) errors.email = "invalid";

  const rawPhone = cleanText(input.phone, 40);
  const phone = rawPhone ? normalizePhone(rawPhone) : null;
  if (rawPhone && !phone) errors.phone = "invalid";

  if (Object.keys(errors).length) return { errors };
  return {
    errors,
    value: {
      firstName: firstName!,
      lastName,
      email: rawEmail,
      emailNormalized,
      phone,
      companyId: input.companyId && isUuid(input.companyId) ? input.companyId : null,
    },
  };
}

/** Active contacts with the same normalized email. Used for duplicate warnings. */
export async function findContactsByEmail(emailNormalized: string, excludeId?: string) {
  return getDb()
    .select({ id: contacts.id, firstName: contacts.firstName, lastName: contacts.lastName, ownerId: contacts.ownerId })
    .from(contacts)
    .where(
      and(
        eq(contacts.emailNormalized, emailNormalized),
        eq(contacts.status, "active"),
        excludeId ? ne(contacts.id, excludeId) : sql`true`,
      ),
    );
}

export interface CreateContactInput {
  principal: Principal;
  fields: ContactInput;
  /** Set when the user has seen the duplicate warning and chose to create anyway. */
  confirmDuplicate: boolean;
  requestId?: string | null;
}

export async function createContact(input: CreateContactInput): Promise<{ id: string }> {
  const { value, errors } = validateContactFields(input.fields);
  let ownerId = input.principal.userId;
  if (input.fields.ownerId && input.fields.ownerId !== input.principal.userId) {
    if (!canReassign(input.principal)) throw forbidden("Salespeople can only create records they own");
    ownerId = input.fields.ownerId;
  }
  if (errors.firstName || errors.email || errors.phone) throw new ValidationError(errors);

  if (value!.emailNormalized) {
    const dupes = await findContactsByEmail(value!.emailNormalized);
    if (dupes.length > 0 && !input.confirmDuplicate) {
      throw new ValidationError({ email: "duplicate" }, "A contact with this email already exists");
    }
  }

  return withTx(async (tx) => {
    const [row] = await tx
      .insert(contacts)
      .values({ ...value!, ownerId, companyId: value!.companyId })
      .returning({ id: contacts.id });
    await recordAudit(tx, {
      actorId: input.principal.userId,
      action: "contact.created",
      subjectType: "contact",
      subjectId: row!.id,
      metadata: { ownerId, duplicateConfirmed: input.confirmDuplicate },
      requestId: input.requestId ?? null,
    });
    return { id: row!.id };
  });
}

export async function updateContact(
  principal: Principal,
  contactId: string,
  expectedVersion: number,
  fields: ContactInput,
  requestId?: string | null,
): Promise<void> {
  const [current] = await getDb().select().from(contacts).where(eq(contacts.id, contactId)).limit(1);
  if (!current || current.status === "merged" || !canMutate(principal, current)) throw notFound("Contact");
  if (current.version !== expectedVersion) throw conflict("Contact changed by someone else; reload and try again");

  const { value, errors } = validateContactFields(fields);
  if (Object.keys(errors).length) throw new ValidationError(errors);

  let ownerId = current.ownerId;
  if (fields.ownerId && fields.ownerId !== current.ownerId) {
    if (!canReassign(principal)) throw forbidden("Only managers can change the owner");
    ownerId = fields.ownerId;
  }

  await withTx(async (tx) => {
    const [updated] = await tx
      .update(contacts)
      .set({ ...value!, ownerId, version: current.version + 1, updatedAt: new Date() })
      .where(and(eq(contacts.id, contactId), eq(contacts.version, expectedVersion)))
      .returning({ id: contacts.id });
    if (!updated) throw conflict("Contact changed while saving; reload and try again");
    if (ownerId !== current.ownerId) {
      await recordAudit(tx, {
        actorId: principal.userId,
        action: "owner.changed",
        subjectType: "contact",
        subjectId: contactId,
        metadata: { fromOwnerId: current.ownerId, toOwnerId: ownerId },
        requestId: requestId ?? null,
      });
    }
  });
}

/**
 * Archiving is blocked while the contact is the primary contact of an open deal. The UI lists
 * those deals; the rule itself lives here so no route can bypass it.
 */
export async function setContactArchived(principal: Principal, contactId: string, archived: boolean, requestId?: string | null) {
  if (!archived && !canRestore(principal)) throw forbidden("Only managers can restore records");
  const [current] = await getDb().select().from(contacts).where(eq(contacts.id, contactId)).limit(1);
  if (!current || !canMutate(principal, current)) throw notFound("Contact");
  if (archived) {
    const open = await getDb()
      .select({ id: deals.id, title: deals.title })
      .from(deals)
      .where(and(eq(deals.primaryContactId, contactId), eq(deals.status, "open")));
    if (open.length > 0) {
      throw new ValidationError({ archive: "open_deals" }, `Close or reassign ${open.length} open deal(s) first`);
    }
  }
  await withTx(async (tx) => {
    await tx
      .update(contacts)
      .set({ status: archived ? "archived" : "active", archivedAt: archived ? new Date() : null, version: current.version + 1, updatedAt: new Date() })
      .where(eq(contacts.id, contactId));
    await recordAudit(tx, {
      actorId: principal.userId,
      action: archived ? "contact.archived" : "contact.restored",
      subjectType: "contact",
      subjectId: contactId,
      requestId: requestId ?? null,
    });
  });
}

export async function companyExists(companyId: string): Promise<boolean> {
  const [row] = await getDb().select({ id: companies.id }).from(companies).where(eq(companies.id, companyId)).limit(1);
  return Boolean(row);
}

export async function ownerExists(userId: string): Promise<boolean> {
  const [row] = await getDb().select({ id: users.id }).from(users).where(and(eq(users.id, userId), eq(users.active, true))).limit(1);
  return Boolean(row);
}

