import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/*
 * Schema for AptimaCRM. Check constraints and append-only triggers that Drizzle cannot
 * express cleanly live in the hand-written migration `0001_invariants.sql`.
 * Enumerations are text with check constraints so migrations stay simple to reason about.
 */

const id = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

export const users = pgTable(
  "users",
  {
    id: id(),
    emailNormalized: text("email_normalized").notNull(),
    name: text("name").notNull(),
    role: text("role").notNull(),
    passwordHash: text("password_hash").notNull(),
    active: boolean("active").notNull().default(true),
    locale: text("locale").notNull().default("ca"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("users_email_key").on(t.emailNormalized),
    check("users_role_check", sql`${t.role} in ('admin','manager','salesperson')`),
    check("users_locale_check", sql`${t.locale} in ('ca','es','en')`),
    check("users_name_length", sql`char_length(${t.name}) between 1 and 120`),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    createdAt: createdAt(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("sessions_token_hash_key").on(t.tokenHash),
    index("sessions_user_idx").on(t.userId),
  ],
);

export const companies = pgTable(
  "companies",
  {
    id: id(),
    name: text("name").notNull(),
    nameNormalized: text("name_normalized").notNull(),
    domainNormalized: text("domain_normalized"),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    status: text("status").notNull().default("active"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    mergedIntoId: uuid("merged_into_id").references((): AnyPgColumn => companies.id, {
      onDelete: "restrict",
    }),
    version: integer("version").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("companies_domain_idx").on(t.domainNormalized),
    index("companies_name_idx").on(t.nameNormalized),
    index("companies_owner_status_idx").on(t.ownerId, t.status),
    check("companies_status_check", sql`${t.status} in ('active','archived','merged')`),
    check(
      "companies_merge_consistent",
      sql`(${t.status} = 'merged') = (${t.mergedIntoId} is not null)`,
    ),
    check("companies_not_self_merged", sql`${t.mergedIntoId} is null or ${t.mergedIntoId} <> ${t.id}`),
    check("companies_name_length", sql`char_length(${t.name}) between 1 and 200`),
    check("companies_version_positive", sql`${t.version} >= 1`),
  ],
);

export const contacts = pgTable(
  "contacts",
  {
    id: id(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull().default(""),
    email: text("email"),
    emailNormalized: text("email_normalized"),
    phone: text("phone"),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    status: text("status").notNull().default("active"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    mergedIntoId: uuid("merged_into_id").references((): AnyPgColumn => contacts.id, {
      onDelete: "restrict",
    }),
    version: integer("version").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("contacts_email_idx").on(t.emailNormalized),
    index("contacts_company_idx").on(t.companyId),
    index("contacts_owner_status_idx").on(t.ownerId, t.status),
    check("contacts_status_check", sql`${t.status} in ('active','archived','merged')`),
    check(
      "contacts_merge_consistent",
      sql`(${t.status} = 'merged') = (${t.mergedIntoId} is not null)`,
    ),
    check("contacts_not_self_merged", sql`${t.mergedIntoId} is null or ${t.mergedIntoId} <> ${t.id}`),
    check(
      "contacts_email_normalized_shape",
      sql`${t.emailNormalized} is null or (${t.emailNormalized} like '%@%' and char_length(${t.emailNormalized}) <= 254)`,
    ),
    check("contacts_first_name_length", sql`char_length(${t.firstName}) between 1 and 120`),
    check("contacts_version_positive", sql`${t.version} >= 1`),
  ],
);

export const pipelineStages = pgTable(
  "pipeline_stages",
  {
    id: id(),
    name: text("name").notNull(),
    position: integer("position").notNull(),
    kind: text("kind").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    // Unique and DEFERRABLE, created in 0001_invariants.sql (drizzle cannot express deferrable).
    uniqueIndex("pipeline_stages_position_key").on(t.position),
    check("pipeline_stages_kind_check", sql`${t.kind} in ('open','won','lost')`),
    check("pipeline_stages_name_length", sql`char_length(${t.name}) between 1 and 60`),
  ],
);

export const deals = pgTable(
  "deals",
  {
    id: id(),
    title: text("title").notNull(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    primaryContactId: uuid("primary_contact_id").references(() => contacts.id, {
      onDelete: "set null",
    }),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    stageId: uuid("stage_id")
      .notNull()
      .references(() => pipelineStages.id, { onDelete: "restrict" }),
    status: text("status").notNull().default("open"),
    amountCents: integer("amount_cents").notNull().default(0),
    currency: text("currency").notNull().default("EUR"),
    expectedCloseOn: date("expected_close_on"),
    stageEnteredAt: timestamp("stage_entered_at", { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    version: integer("version").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("deals_stage_status_idx").on(t.stageId, t.status),
    index("deals_owner_status_idx").on(t.ownerId, t.status),
    index("deals_company_idx").on(t.companyId),
    check("deals_status_check", sql`${t.status} in ('open','won','lost')`),
    check("deals_open_iff_no_close", sql`(${t.status} = 'open') = (${t.closedAt} is null)`),
    check("deals_amount_nonnegative", sql`${t.amountCents} >= 0`),
    check("deals_currency_check", sql`${t.currency} = 'EUR'`),
    check("deals_version_positive", sql`${t.version} >= 1`),
    check("deals_title_length", sql`char_length(${t.title}) between 1 and 200`),
  ],
);

export const activities = pgTable(
  "activities",
  {
    id: id(),
    kind: text("kind").notNull(),
    source: text("source").notNull().default("manual"),
    dealId: uuid("deal_id").references(() => deals.id, { onDelete: "restrict" }),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "restrict" }),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "restrict" }),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "restrict" }),
    body: text("body").notNull().default(""),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
    fromStageId: uuid("from_stage_id").references(() => pipelineStages.id, { onDelete: "restrict" }),
    toStageId: uuid("to_stage_id").references(() => pipelineStages.id, { onDelete: "restrict" }),
    correctsActivityId: uuid("corrects_activity_id").references((): AnyPgColumn => activities.id, {
      onDelete: "restrict",
    }),
    correctionReason: text("correction_reason"),
    originalBody: text("original_body"),
    externalMessageId: text("external_message_id"),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
  },
  (t) => [
    uniqueIndex("activities_external_message_key").on(t.externalMessageId),
    index("activities_deal_idx").on(t.dealId, t.occurredAt),
    index("activities_contact_idx").on(t.contactId, t.occurredAt),
    index("activities_company_idx").on(t.companyId, t.occurredAt),
    check(
      "activities_kind_check",
      sql`${t.kind} in ('note','call','email','stage_change','correction','merge','system')`,
    ),
    check("activities_source_check", sql`${t.source} in ('manual','bcc','system')`),
    check(
      "activities_has_anchor",
      sql`${t.dealId} is not null or ${t.contactId} is not null or ${t.companyId} is not null`,
    ),
    check(
      "activities_stage_change_shape",
      sql`${t.kind} <> 'stage_change' or (${t.fromStageId} is not null and ${t.toStageId} is not null and ${t.fromStageId} <> ${t.toStageId})`,
    ),
    check(
      "activities_correction_shape",
      sql`${t.kind} <> 'correction' or (${t.correctsActivityId} is not null and ${t.correctionReason} is not null and ${t.originalBody} is not null)`,
    ),
    check("activities_body_length", sql`char_length(${t.body}) <= 5000`),
  ],
);

export const tasks = pgTable(
  "tasks",
  {
    id: id(),
    title: text("title").notNull(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    dealId: uuid("deal_id").references(() => deals.id, { onDelete: "restrict" }),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "restrict" }),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "restrict" }),
    dueOn: date("due_on").notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    status: text("status").notNull().default("open"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completedBy: uuid("completed_by").references(() => users.id, { onDelete: "restrict" }),
    version: integer("version").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("tasks_owner_status_due_idx").on(t.ownerId, t.status, t.dueAt),
    index("tasks_deal_idx").on(t.dealId),
    check("tasks_status_check", sql`${t.status} in ('open','completed')`),
    check(
      "tasks_completed_consistent",
      sql`(${t.status} = 'completed') = (${t.completedAt} is not null)`,
    ),
    check("tasks_title_length", sql`char_length(${t.title}) between 1 and 200`),
    check("tasks_version_positive", sql`${t.version} >= 1`),
  ],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: id(),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "restrict" }),
    action: text("action").notNull(),
    subjectType: text("subject_type").notNull(),
    subjectId: text("subject_id"),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    requestId: text("request_id"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_events_subject_idx").on(t.subjectType, t.subjectId)],
);

export const imports = pgTable(
  "imports",
  {
    id: id(),
    kind: text("kind").notNull(),
    status: text("status").notNull().default("pending"),
    fileName: text("file_name").notNull(),
    fileKey: text("file_key"),
    fileSha256: text("file_sha256").notNull(),
    columnMapping: jsonb("column_mapping"),
    totalRows: integer("total_rows").notNull().default(0),
    validRows: integer("valid_rows").notNull().default(0),
    errorRows: integer("error_rows").notNull().default(0),
    duplicateRows: integer("duplicate_rows").notNull().default(0),
    errorSummary: text("error_summary"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    check("imports_kind_check", sql`${t.kind} in ('contacts','companies')`),
    check(
      "imports_status_check",
      sql`${t.status} in ('pending','processing','ready','completed','failed','cancelled')`,
    ),
  ],
);

export const importRows = pgTable(
  "import_rows",
  {
    id: id(),
    importId: uuid("import_id")
      .notNull()
      .references(() => imports.id, { onDelete: "cascade" }),
    rowNumber: integer("row_number").notNull(),
    normalized: jsonb("normalized").notNull(),
    errors: jsonb("errors").notNull().default(sql`'[]'::jsonb`),
    status: text("status").notNull(),
    matchContactId: uuid("match_contact_id").references(() => contacts.id, { onDelete: "restrict" }),
    matchCompanyId: uuid("match_company_id").references(() => companies.id, { onDelete: "restrict" }),
    decision: text("decision"),
    decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "restrict" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("import_rows_import_row_key").on(t.importId, t.rowNumber),
    check("import_rows_status_check", sql`${t.status} in ('valid','error','duplicate','created','linked','skipped')`),
    check("import_rows_decision_check", sql`${t.decision} is null or ${t.decision} in ('create','link','skip')`),
  ],
);

export const jobs = pgTable(
  "jobs",
  {
    id: id(),
    kind: text("kind").notNull(),
    payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    runAfter: timestamp("run_after", { withTimezone: true }).notNull().defaultNow(),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    lastError: text("last_error"),
    idempotencyKey: text("idempotency_key").notNull(),
    requestId: text("request_id"),
    createdAt: createdAt(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("jobs_idempotency_key").on(t.idempotencyKey),
    index("jobs_claim_idx").on(t.status, t.runAfter),
    check("jobs_status_check", sql`${t.status} in ('pending','running','succeeded','failed')`),
    check("jobs_attempts_nonnegative", sql`${t.attempts} >= 0`),
  ],
);

export const inboundEmails = pgTable(
  "inbound_emails",
  {
    id: id(),
    providerMessageId: text("provider_message_id").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    fromNormalized: text("from_normalized").notNull(),
    toAddress: text("to_address").notNull(),
    subject: text("subject").notNull().default(""),
    bodyExcerpt: text("body_excerpt").notNull().default(""),
    status: text("status").notNull(),
    matchedContactId: uuid("matched_contact_id").references(() => contacts.id, { onDelete: "restrict" }),
    matchedDealId: uuid("matched_deal_id").references(() => deals.id, { onDelete: "restrict" }),
    activityId: uuid("activity_id").references(() => activities.id, { onDelete: "restrict" }),
    rawSha256: text("raw_sha256").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("inbound_emails_provider_message_key").on(t.providerMessageId),
    uniqueIndex("inbound_emails_activity_key").on(t.activityId),
    index("inbound_emails_status_idx").on(t.status),
    check(
      "inbound_emails_status_check",
      sql`${t.status} in ('captured','ambiguous','unmatched','discarded','manually_matched')`,
    ),
    check("inbound_emails_subject_length", sql`char_length(${t.subject}) <= 200`),
    check("inbound_emails_body_length", sql`char_length(${t.bodyExcerpt}) <= 5000`),
  ],
);
