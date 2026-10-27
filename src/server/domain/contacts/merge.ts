import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { getDb, withTx, type Tx } from "@/server/db/client";
import { activities, contacts, deals, tasks } from "@/server/db/schema";
import { canMerge, type Principal } from "@/server/authz/policy";
import { conflict, notFound, ValidationError } from "@/server/errors";
import { recordAudit } from "@/server/domain/audit";
import { isUuid } from "@/server/security/guards";

/**
 * Reviewed contact merge. The source contact is never deleted: it is marked `merged` and points
 * at the survivor, so old links still resolve. Activities, tasks and deals are re-anchored to the
 * survivor inside the same transaction; activity content is never changed (the trigger in
 * 0001_invariants.sql enforces that).
 */

export type FieldPick = "survivor" | "source";
export interface MergePicks {
  firstName: FieldPick;
  lastName: FieldPick;
  email: FieldPick;
  phone: FieldPick;
  companyId: FieldPick;
}

export interface MergePreview {
  survivor: ContactSnapshot;
  source: ContactSnapshot;
  counts: { activities: number; tasks: number; deals: number };
  conflicts: Array<keyof MergePicks>;
}

export interface ContactSnapshot {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  companyId: string | null;
  ownerId: string;
  status: string;
  version: number;
}

function snapshot(row: typeof contacts.$inferSelect): ContactSnapshot {
  return {
    id: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    phone: row.phone,
    companyId: row.companyId,
    ownerId: row.ownerId,
    status: row.status,
    version: row.version,
  };
}

async function loadPair(principal: Principal, survivorId: string, sourceId: string, tx: Tx | ReturnType<typeof getDb>) {
  if (!isUuid(survivorId) || !isUuid(sourceId) || survivorId === sourceId) {
    throw new ValidationError({ sourceId: "invalid_pair" }, "Choose two different contacts");
  }
  // Lock in id order so two concurrent merges touching the same pair cannot deadlock.
  const [first, second] = [survivorId, sourceId].sort();
  const rows = await tx
    .select()
    .from(contacts)
    .where(inArray(contacts.id, [first!, second!]))
    .orderBy(asc(contacts.id))
    .for("update");
  const survivor = rows.find((r) => r.id === survivorId);
  const source = rows.find((r) => r.id === sourceId);
  if (!survivor || !source) throw notFound("Contact");
  if (!canMerge(principal, survivor, source)) throw notFound("Contact");
  return { survivor, source };
}

export async function previewMerge(principal: Principal, survivorId: string, sourceId: string): Promise<MergePreview> {
  const db = getDb();
  const { survivor, source } = await loadPair(principal, survivorId, sourceId, db);
  if (survivor.status !== "active" || source.status !== "active") {
    throw new ValidationError({ status: "not_active" }, "Both contacts must be active to merge");
  }
  const [a] = await db.select({ n: sql<number>`count(*)::int` }).from(activities).where(eq(activities.contactId, source.id));
  const [t] = await db.select({ n: sql<number>`count(*)::int` }).from(tasks).where(eq(tasks.contactId, source.id));
  const [d] = await db.select({ n: sql<number>`count(*)::int` }).from(deals).where(eq(deals.primaryContactId, source.id));

  const conflicts: Array<keyof MergePicks> = [];
  if (survivor.firstName !== source.firstName) conflicts.push("firstName");
  if ((survivor.lastName ?? "") !== (source.lastName ?? "")) conflicts.push("lastName");
  if (survivor.email && source.email && survivor.email !== source.email) conflicts.push("email");
  if (survivor.phone && source.phone && survivor.phone !== source.phone) conflicts.push("phone");
  if (survivor.companyId && source.companyId && survivor.companyId !== source.companyId) conflicts.push("companyId");

  return {
    survivor: snapshot(survivor),
    source: snapshot(source),
    counts: { activities: a?.n ?? 0, tasks: t?.n ?? 0, deals: d?.n ?? 0 },
    conflicts,
  };
}

export interface MergeInput {
  principal: Principal;
  survivorId: string;
  sourceId: string;
  picks: MergePicks;
  /** The version of both contacts the user reviewed in the preview. */
  expectedSurvivorVersion: number;
  expectedSourceVersion: number;
  requestId?: string | null;
}

export async function mergeContacts(input: MergeInput): Promise<{ alreadyMerged: boolean; counts: MergePreview["counts"] }> {
  return withTx(async (tx) => {
    const { survivor, source } = await loadPair(input.principal, input.survivorId, input.sourceId, tx);

    // Idempotent: a second confirm after a successful merge is a success, not an error.
    if (source.status === "merged" && source.mergedIntoId === survivor.id) {
      return { alreadyMerged: true, counts: { activities: 0, tasks: 0, deals: 0 } };
    }
    if (survivor.status !== "active" || source.status !== "active") {
      throw new ValidationError({ status: "not_active" }, "Both contacts must be active to merge");
    }
    if (survivor.version !== input.expectedSurvivorVersion || source.version !== input.expectedSourceVersion) {
      throw conflict("One of the contacts changed since the preview; review it again");
    }

    // Only this transaction may re-anchor activities, and only their anchors (see migration 0001).
    await tx.execute(sql`select set_config('app.merge_reparent', 'on', true)`);

    const movedActivities = await tx
      .update(activities)
      .set({ contactId: survivor.id })
      .where(eq(activities.contactId, source.id))
      .returning({ id: activities.id });
    const movedTasks = await tx
      .update(tasks)
      .set({ contactId: survivor.id, updatedAt: new Date() })
      .where(eq(tasks.contactId, source.id))
      .returning({ id: tasks.id });
    const movedDeals = await tx
      .update(deals)
      .set({ primaryContactId: survivor.id, version: sql`${deals.version} + 1`, updatedAt: new Date() })
      .where(eq(deals.primaryContactId, source.id))
      .returning({ id: deals.id });

    const picks = input.picks;
    const chosen = {
      firstName: picks.firstName === "source" ? source.firstName : survivor.firstName,
      lastName: picks.lastName === "source" ? source.lastName : survivor.lastName,
      email: picks.email === "source" ? source.email : survivor.email,
      emailNormalized: picks.email === "source" ? source.emailNormalized : survivor.emailNormalized,
      phone: picks.phone === "source" ? source.phone : survivor.phone,
      companyId: picks.companyId === "source" ? source.companyId : survivor.companyId,
    };

    const [updatedSurvivor] = await tx
      .update(contacts)
      .set({ ...chosen, version: survivor.version + 1, updatedAt: new Date() })
      .where(and(eq(contacts.id, survivor.id), eq(contacts.version, survivor.version)))
      .returning({ id: contacts.id });
    if (!updatedSurvivor) throw conflict("Contact changed during the merge; review it again");

    const [updatedSource] = await tx
      .update(contacts)
      .set({ status: "merged", mergedIntoId: survivor.id, version: source.version + 1, updatedAt: new Date() })
      .where(and(eq(contacts.id, source.id), eq(contacts.version, source.version)))
      .returning({ id: contacts.id });
    if (!updatedSource) throw conflict("Contact changed during the merge; review it again");

    const counts = { activities: movedActivities.length, tasks: movedTasks.length, deals: movedDeals.length };

    await tx.insert(activities).values({
      kind: "merge",
      source: "system",
      contactId: survivor.id,
      companyId: chosen.companyId,
      actorId: input.principal.userId,
      body: `Merged ${source.firstName} ${source.lastName}`.trim(),
      metadata: { sourceContactId: source.id, ...counts },
    });

    await recordAudit(tx, {
      actorId: input.principal.userId,
      action: "merge.completed",
      subjectType: "contact",
      subjectId: survivor.id,
      metadata: { sourceContactId: source.id, ...counts },
      requestId: input.requestId ?? null,
    });

    return { alreadyMerged: false, counts };
  });
}

