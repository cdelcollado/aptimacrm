# AptimaCRM — Technical plan

Status: planning document, written before implementation. Decisions below resolve the contradictions in the brief in favour of the narrow audience (a small B2B team with one deal pipeline).

## 1. Stack decisions

| Concern | Choice | Why |
|---|---|---|
| Framework | Next.js 16 (App Router, RSC), TypeScript | Brief selects Next.js. Server Components by default. |
| Mutations | Server Actions for authenticated forms; Route Handlers for CSV download, inbound email webhook, health | Matches brief. |
| DB | PostgreSQL 16+ via `pg`, Drizzle ORM, drizzle-kit versioned SQL migrations | Brief. Custom SQL migrations for triggers and check constraints. |
| Tests DB | Real Postgres started by `embedded-postgres` (npm), one isolated database per test run | Isolation without Docker. |
| Object storage | `StorageAdapter` interface: `LocalStorage` (dev/test, private dir) and `S3Storage` (`@aws-sdk/client-s3`, timeouts, retries) | Brief: S3-compatible, server-only. |
| Background work | Postgres-backed job table (`jobs`) with leases, attempts, backoff, and a worker process (`npm run worker`) | Real job system without extra infrastructure. |
| Styling | Plain CSS with design tokens in `:root` | Calm, specific visual system; no template kit. |
| i18n | Dictionary `ca` (default), `es`, `en`; locale in cookie, set by a form | Brief: three languages. |
| Timezone | Org timezone `Europe/Madrid` stored in config; instants stored as `timestamptz` | Brief: retain named timezone context. |
| Currency | Single org currency, `EUR`, stored in config; amounts as integer cents | Avoids multi-currency aggregation for a single pipeline. |

Capability context mentioned in the brief (Astro, HTMX, D1) is **not** adopted. Next.js is the selected framework, and there is no native, edge-only, or real-time requirement that would force a different runtime. Live updates are out of scope for this slice: the board refreshes after each action and the import page polls via `<meta refresh>` while a job is pending. Documented as a known limitation.

## 2. Roles and ownership model

Three roles, one per real need in the brief:

| Role | Read | Mutate |
|---|---|---|
| `salesperson` | Contacts, companies, deals, tasks, activities **where `owner_id = self`** (and activities/tasks attached to those records) | Own records only: create, edit, log activity, add task, move stage. Cannot reassign owner. |
| `manager` | All records | All record mutations, reassign owner, merge, archive/restore, approve imports, manual email matching, export **deal pipeline snapshot** (scoped to the filter, no contact PII beyond the deal's primary contact name) |
| `admin` | All records | Everything a manager can do, plus pipeline stage configuration, user management (seeded only), **full CRM export** (contacts, companies, deals, activities) |

Ownership rules, enforced server-side in `src/server/authz/policy.ts`:

- A deal's visibility follows its `owner_id`. A salesperson can create a deal from a company only if they can read that company and they become the deal owner.
- A salesperson can see a company they own. Company context on a deal is shown only if the deal owner can read the company; otherwise the company name is replaced by `[restricted]` in the detail view. (Decision recorded because it is the only visibility edge case in the brief.)
- Activities inherit visibility from their `deal_id` / `contact_id` / `company_id` anchor. An email capture with no visible anchor is not shown to salespeople.
- Every query goes through a scoped repository function that takes a `Principal` and applies the visibility predicate. There is no unscoped `db.select` outside `src/server/repositories/*` and tests.

Sign-in is email + password (scrypt, `node:crypto`, no extra dependency). No OAuth in this slice; the brief's OAuth rules are noted as not applicable because there is no provider token to store.

## 3. Routes and pages

| Route | Who | Purpose | Primary action | Secondary |
|---|---|---|---|---|
| `/sign-in` | public | Sign in, locale selector | Sign in | Change language |
| `/dashboard` | all | Pipeline value, conversion, win rate, overdue tasks, recent activity, owner filter, import status | Create deal / contact / task | Open pipeline, import |
| `/contacts` | all (scoped) | Searchable directory, duplicate badges, owner, open deals, last activity, archive filter | New contact | Import CSV, archive/restore |
| `/contacts/[id]` | scoped | Contact detail, activities, tasks | Log call / note | Edit, archive, open merge |
| `/companies` | scoped | Directory with duplicate badges, open deals, last activity | New company | Import CSV, archive |
| `/companies/[id]` | scoped | Company detail, contacts, deals | New deal from company | Edit, archive |
| `/imports/new` | manager, admin | Upload CSV, choose kind, map columns | Upload and map | Download template |
| `/imports/[id]` | uploader, manager, admin | Status (pending/processing/completed/failed), row errors, duplicate matches, decisions | Confirm import | Cancel import |
| `/contacts/merge/[id]?with=[otherId]` | manager, admin; salesperson only if owner of both | Merge preview with field picks and counts of records that will move | Confirm merge | Back |
| `/pipeline` | all (scoped) | Board: ordered stages, cards, stage totals, filters (owner, stage, overdue) | Drag or move-to-stage | Filter |
| `/deals/new?companyId=` | all (scoped) | Create deal | Create | Cancel |
| `/deals/[id]` | scoped | Context, stage/value/owner, activity composer, immutable timeline, tasks, email-capture status, archive | Log activity / add task | Move stage, edit, archive |
| `/tasks?filter=overdue` | all (scoped) | Overdue and open tasks, complete action | Complete task | Reschedule |
| `/admin/stages` | admin | Ordered stages: rename, reorder, add, delete when unused | Save | — |
| `/admin/email` | manager, admin | Unmatched inbound emails, manual match | Match to contact | Discard |
| `/api/exports/deals.csv` | manager, admin | Authorized deal snapshot CSV (honours filter query) | Download | — |
| `/api/exports/full.csv?type=contacts|companies|deals|activities` | admin | Full CRM export; audited | Download | — |
| `/api/email/inbound` | external provider (HMAC) | BCC/forward capture | — | — |
| `/api/health` | ops | DB ping, storage ping, job backlog counts | — | — |

Signed-out users are redirected to `/sign-in?next=/relative/path` (the `next` value is validated as a same-origin relative path). Expired sessions redirect to `/sign-in?reason=expired`. Role mismatches render `/forbidden` (HTTP 403). Unknown records render a not-found page that does not reveal whether the record exists but is out of scope.

Every screen specifies primary/secondary actions, visible status, validation feedback, empty state, pending state, success confirmation and recoverable failure. These are encoded per-page in the README section "Screen contract" and checked in e2e tests where a journey depends on them.

## 4. Data model

All tables have `id uuid primary key default gen_random_uuid()`, `created_at timestamptz not null default now()`, and `updated_at timestamptz` where mutable. Money is `integer` cents. Dates that carry local meaning (`expected_close_date`, `due_on` for tasks) are `date` plus the org timezone; instants are `timestamptz`.

### users
- Purpose: people who sign in. Tenant boundary: single org.
- Columns: `email_normalized` (unique, lowercase, trimmed), `name`, `role` (check in `admin|manager|salesperson`), `password_hash`, `active` boolean, `locale` (check in `ca|es|en`).
- Constraints: unique(`email_normalized`); check role/locale.

### sessions
- Columns: `id`, `user_id` (FK, cascade), `token_hash` (sha256 of random token, unique), `created_at`, `last_seen_at`, `expires_at`, `revoked_at`.
- Idle timeout 8 h, absolute 7 days. Revoked on sign-out.

### companies
- Purpose: organisations. Owner-scoped.
- Columns: `name` (1–200), `domain_normalized` (nullable, lowercase, no `www.`), `owner_id` (FK users, restrict), `status` (`active|archived|merged`), `archived_at`, `merged_into_id` (FK self), `updated_at`, `version` int.
- Constraints: check `status in (...)`; check (`status='merged'` ⇔ `merged_into_id is not null`); check `merged_into_id <> id`; check `name` length.
- Index: `(domain_normalized)` for duplicate suggestions; `(owner_id, status)` for directory.
- Duplicates are **suggested** by domain match; no unique constraint, because the brief requires reviewed merges.

### contacts
- Columns: `first_name`, `last_name`, `email` (display), `email_normalized` (nullable), `phone` (normalized to E.164-like digits, nullable), `company_id` (FK companies, set null), `owner_id` (FK users, restrict), `status` (`active|archived|merged`), `archived_at`, `merged_into_id` (FK self), `version`, `updated_at`.
- Constraints: check status/merge consistency as for companies; check `email_normalized` is null or contains `@`; check length limits on names and email.
- Duplicate suggestion: `email_normalized` match. Import **never** creates a second contact with a matching normalized email silently — it creates a `duplicate` import row awaiting a decision.
- Index: `(email_normalized)`, `(company_id)`, `(owner_id, status)`.

### pipeline_stages
- Columns: `name` (1–60), `position` int, `kind` (`open|won|lost`), `created_at`.
- Constraints: unique(`position`) — reorder runs in one transaction using a two-phase update (negative temp positions) to avoid the unique collision; check `kind in ('open','won','lost')`.
- Seed: Qualified, Proposal, Negotiation (open), Won (won), Lost (lost). Names are user data, not translations.

### deals
- Columns: `title` (1–200), `company_id` (FK companies, restrict), `primary_contact_id` (FK contacts, set null), `owner_id` (FK users, restrict), `stage_id` (FK pipeline_stages, restrict), `status` (`open|won|lost`, kept in sync with stage kind inside the transition service), `amount_cents` (check ≥ 0), `currency` (check `= 'EUR'`), `expected_close_on` date (nullable), `stage_entered_at` timestamptz, `closed_at` (nullable), `archived_at`, `version` int, `updated_at`.
- Constraints: check (`status='open'` ⇔ `closed_at is null`); check amount ≥ 0; check version ≥ 1.
- Indexes: `(stage_id, status)` for board; `(owner_id, status)`; `(company_id)`.

### activities (append-only)
- Purpose: timeline for notes, email summaries, calls, stage changes, corrections, merges, imports.
- Columns: `kind` (`note|call|email|stage_change|correction|merge|system`), `source` (`manual|bcc|system`), `deal_id`, `contact_id`, `company_id` (each nullable FK, at least one anchor required by check), `actor_id` (FK users, restrict; null for `system`), `body` (≤ 5000 chars), `occurred_at` timestamptz, `created_at`, `from_stage_id`, `to_stage_id` (for stage_change), `corrects_activity_id` (self FK, for correction), `correction_reason` (for correction), `original_body` (for correction, verbatim copy), `external_message_id` (unique, for BCC dedupe), `metadata` jsonb (kept small; never raw email bodies beyond `body`).
- Constraints: check at least one anchor; check `kind='stage_change'` ⇒ from/to not null and `from <> to`; check `kind='correction'` ⇒ `corrects_activity_id` and `correction_reason` not null; check body length.
- **Immutability**: a trigger `activities_append_only` rejects `UPDATE` and `DELETE`. The only allowed update is re-anchoring (`contact_id`, `company_id`, `deal_id` change) and only when the session setting `app.merge_reparent = 'on'` is set with `SET LOCAL` inside the merge transaction. Re-anchoring is also rejected for any other column change.
- Corrections: a new `correction` activity references the original, stores the original body in `original_body`, the editor in `actor_id`, the reason, and its own `created_at` as the correction timestamp. The UI shows the original value and the corrected value.

### tasks
- Columns: `title` (1–200), `owner_id` (FK users, restrict), `deal_id`, `contact_id`, `company_id` (nullable, at least one anchor is not required — a task can be personal to the owner), `due_on` date (org-timezone calendar date), `due_at` timestamptz (computed as start of next day in org timezone, used for overdue compare), `status` (`open|completed`), `completed_at`, `completed_by`, `version`, `updated_at`.
- Constraints: check (`status='completed'` ⇔ `completed_at is not null`); check title length.
- Overdue: `status = 'open' and due_at < now()`. Computed in SQL, tested with fixed clock.

### audit_events (append-only)
- Columns: `actor_id`, `action` (`stage.changed`, `owner.changed`, `export.full`, `export.deals`, `import.confirmed`, `merge.completed`, `user.signed_in`, `stage.created` etc.), `subject_type`, `subject_id`, `metadata` jsonb (counts and ids, no PII), `created_at`, `request_id`.
- Same append-only trigger as activities.

### imports and import_rows
- `imports`: `kind` (`contacts|companies`), `status` (`pending|processing|ready|completed|failed|cancelled`), `file_key` (object-storage key, nullable after cleanup), `file_sha256`, `column_mapping` jsonb, `counts` (total, valid, error, duplicate), `created_by`, `error_summary`, `created_at`, `completed_at`.
- `import_rows`: `import_id` (FK cascade), `row_number`, `normalized` jsonb, `errors` jsonb (array of `{field, code}`), `status` (`valid|error|duplicate|created|linked|skipped`), `match_contact_id` / `match_company_id` (nullable), `decision` (`create|link|skip`, nullable), `decided_by`, `decided_at`.
- Unique(`import_id`, `row_number`).
- Confirmation is one transaction per import: creates valid rows, applies explicit duplicate decisions, writes `import.confirmed` audit event, sets status `completed`. Re-running a confirmed import is a no-op (idempotent by status check and `unique(import_id, row_number)`).

### jobs
- Columns: `kind` (`import.parse`, `import.cleanup_file`, `email.process`), `payload` jsonb, `status` (`pending|running|succeeded|failed`), `attempts`, `max_attempts`, `run_after`, `locked_until`, `last_error` (redacted), `idempotency_key` (unique), `created_at`, `finished_at`.
- State `retrying` is represented as `pending` with `attempts > 0` and `run_after` in the future; the UI shows it as "retrying".
- Worker claims with `UPDATE ... WHERE id = (SELECT id ... FOR UPDATE SKIP LOCKED LIMIT 1)`. Backoff: `min(2^attempts * 5 s, 10 min)`. Lease 2 min; expired leases are reclaimed.

### inbound_emails
- Columns: `provider_message_id` (unique), `received_at`, `from_normalized`, `to_address`, `subject` (≤ 200), `body_excerpt` (≤ 5000), `status` (`captured|ambiguous|unmatched|discarded|manually_matched`), `matched_contact_id`, `matched_deal_id`, `activity_id` (unique when set), `signature_valid` boolean, `raw_sha256`.
- Raw payloads are not stored; only the normalized excerpt and hash.

## 5. Lifecycle and state transitions

### Deal stage (`moveDeal` in `src/server/domain/deals/transition.ts`)
- Input: `dealId`, `toStageId`, `expectedVersion`, `actor`, `reason?`.
- Pre-checks in the transaction after `SELECT ... FOR UPDATE`:
  1. Principal can mutate the deal (policy).
  2. `deal.version === expectedVersion` (otherwise `conflict`, and the UI reloads).
  3. Target stage exists.
  4. `to !== from` (otherwise no-op success, no activity).
  5. If moving **out of** `won` or `lost` (reopen): only `manager` or `admin`, and `reason` is required.
- Effects in one transaction: update deal `stage_id`, `status` (from target kind), `closed_at` (set when entering won/lost, cleared when reopening), `stage_entered_at`, `version + 1`; insert `stage_change` activity (from, to, actor, `occurred_at = now()`); insert audit event `stage.changed`.
- Metrics are read-from-committed-data functions. The server action calls `revalidatePath` **after** the transaction resolves, so no partially-applied value is ever visible.
- Terminal: `won` and `lost` are terminal for salespeople; reopen is manager/admin with reason. Every transition is in the timeline.

### Company / contact / deal archive
- `active → archived` (manager, admin; salesperson for own record). `archived → active` (restore; manager, admin).
- Archived deals are excluded from board and metrics; archived contacts are excluded from new-deal pickers.
- A company or contact with an open, non-archived deal cannot be archived; the UI lists the blocking deals.

### Merge (`mergeContacts` in `src/server/domain/contacts/merge.ts`)
- Preview (read-only): counts of activities, tasks, deals to re-anchor, field conflicts (name, phone, company, email).
- Confirm (one transaction, `SELECT ... FOR UPDATE` on both rows, ordered by id to avoid deadlocks):
  1. Both contacts must be `active` and distinct.
  2. Principal authorized (manager/admin, or owner of both).
  3. `SET LOCAL app.merge_reparent = 'on'`; update activities, tasks, deals to point to the surviving contact; update fields chosen in the preview.
  4. Source contact: `status = 'merged'`, `merged_into_id = survivor`, `version + 1`.
  5. Insert `merge` activity on survivor (body records source id and counts) and audit event `merge.completed`.
- Not reversible from the UI. The source row is kept (never deleted) so old links resolve to "merged into …".

### Import (see section 7)
States: `pending → processing → ready → completed`, or `→ failed`, or `ready → cancelled`. `completed`, `failed`, and `cancelled` are terminal.

### Inbound email
`received → captured` (single contact match, activity created) | `ambiguous` (multiple contacts) | `unmatched` (no contact) | `discarded` (admin/manager) | `manually_matched` (from `ambiguous`/`unmatched`, creates the activity).

## 6. Authorization boundaries and protections

- Policy predicates are pure functions in `src/server/authz/policy.ts`: `canRead(principal, record)`, `canMutate(...)`, `canExport(principal, kind)`, `canReopen(...)`, `canMerge(...)`. These are unit-tested.
- Repositories accept a `Principal` and build the visibility predicate into the SQL `WHERE` clause. Guessed URLs get the same `not-found` response as truly missing records.
- Server Actions verify the session on every call and re-derive the principal from the DB, not from client-supplied role fields.
- CSRF: Server Actions are origin-checked by Next. Route Handlers that mutate (`/api/email/inbound`) use HMAC instead of cookies. GET downloads are read-only.
- Sessions: `HttpOnly`, `SameSite=Lax`, `Secure` in production, `__Host-` prefix in production. Token is 32 random bytes; only its sha256 is stored.
- Sign-in is rate-limited per email and IP (in-process token bucket: 5 attempts / 15 min); documented as single-instance only.
- Redirect targets (`next`) must start with `/` and not `//` or `/\`.
- Headers set in `next.config.ts`: `Content-Security-Policy` (self only, `frame-ancestors 'none'`), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` denying camera/mic/geo.
- Escaping: React escaping by default; no `dangerouslySetInnerHTML`. Activity bodies are plain text with preserved line breaks, not markdown.
- CSV export: cells beginning with `= + - @ TAB CR` are prefixed with `'` (formula-injection protection). Import: accept only `text/csv`, ≤ 2 MB, ≤ 5 000 rows, UTF-8 (BOM stripped), headers required.

## 7. Import flow (job-backed)

1. Manager/admin uploads a CSV on `/imports/new` (Route Handler `POST /api/imports` for the multipart upload; the form then redirects to `/imports/[id]`). The file is streamed to private object storage under `imports/<import-id>.csv` with a SHA-256 checksum; an `import.parse` job is enqueued with idempotency key `import.parse:<import-id>`.
2. The user chooses the column mapping on `/imports/[id]` (a server action). Mapping is required before parsing starts; the job is created by the mapping action, not by the upload, so it runs once.
3. `import.parse` (worker): reads the object, parses, validates every row, normalizes emails/domains/phones, and detects duplicates:
   - contacts: against existing active contacts by `email_normalized` and against earlier rows in the same file;
   - companies: against existing active companies by `domain_normalized` and by normalized name within the file.
   Each row gets `valid | error | duplicate` and `import_rows` rows are written in one transaction. Import status becomes `ready`.
4. Review page shows counts, row errors (row number, field, code, human message), and duplicates with the matched record and a required decision: `link` (use existing), `create` (create a second record, explicit), `skip`. Duplicates have **no default** decision; confirming is blocked until every duplicate has one.
5. Confirm (server action, one transaction): creates valid rows, applies decisions, sets `completed`, writes `import.confirmed`, enqueues `import.cleanup_file` (deletes the object; retries with backoff; `file_key` nulled on success). Re-submitting the confirm form finds `status = completed` and does nothing.
6. Failure: parse errors on the whole file set `failed` with a redacted `error_summary`; the UI offers "Upload again". Row-level errors never fail the whole import.

## 8. Email capture (BCC / forward)

- Endpoint `POST /api/email/inbound`. Provider-agnostic JSON: `{ messageId, receivedAt, from, to, subject, text }`.
- Signature: header `X-Aptima-Timestamp` and `X-Aptima-Signature: sha256=<hex>` where the HMAC-SHA256 is computed over `timestamp + "." + rawBody` with `INBOUND_EMAIL_SECRET`. Reject if timestamp is older than 5 minutes or more than 1 minute in the future, or if the signature mismatches (constant-time compare). Rejected requests are logged without the body.
- Idempotency: `inbound_emails.provider_message_id` unique. Insert with `ON CONFLICT DO NOTHING`; if nothing was inserted, return `200 {status:"duplicate"}` and create no activity. Activity `external_message_id` is also unique as a second safety net.
- Matching: `from_normalized` against `contacts.email_normalized` (active only).
  - exactly one contact → `captured`: `email` activity anchored to the contact and to its single open deal if it has exactly one open deal (otherwise anchored to contact + company only).
  - more than one contact → `ambiguous`, no activity until a manager matches manually.
  - none → `unmatched`.
- Processing runs inside the request (it is one insert and one transaction, fast) and the job queue is used for retries of the email-to-activity step if the DB is briefly unavailable (`email.process`, idempotency key = `provider_message_id`). Provider receives 202 when stored, so a retry from the provider does not create a duplicate.
- Rate limit: 60 requests / minute per source IP (in-process), returns 429 with `Retry-After`.
- Storage: only the normalized subject and a 5 000 char excerpt are retained; raw payload hash only.

## 9. Adapters (external boundaries)

| Adapter | Interface | Real | Dev/test fake | Timeout | Retry | Rejection path |
|---|---|---|---|---|---|---|
| Object storage | `put`, `get`, `delete`, `signedGetUrl` | `S3Storage` (`@aws-sdk/client-s3`) | `LocalStorage` (private dir, same contract) | 10 s per op via `AbortSignal` | 3 attempts, exponential backoff with jitter on 5xx/timeouts; no retry on 403/404 | Normalized `StorageError` with `code` (`timeout`, `denied`, `not_found`, `unavailable`); redacted key in logs |
| Inbound email | `verifyInbound(rawBody, headers)` | HMAC verify (provider-neutral) | Same code with test secret | n/a (in-process) | Provider retries; idempotent by message id | `401` bad signature, `409`-free duplicate `200`, `422` invalid payload, `413` body too large |
| Auth secrets | none external | — | — | — | — | — |

Adapters return `Result` values; they never throw raw SDK errors into domain code. `signedGetUrl` lifetime is 60 seconds and is only issued after an authorization check on the record that owns the file (currently: only import files, which are manager/admin-only and never linked to a URL the user can see after completion).

## 10. Idempotency summary

| Operation | Key | Behaviour on repeat |
|---|---|---|
| Stage move | `expectedVersion` + no-op when `to = from` | Stale version → conflict; same target → success without activity |
| Import confirm | import id + status check | Already completed → no-op |
| Import parse job | `import.parse:<id>` unique in `jobs` | Enqueue is a no-op |
| Inbound email | `provider_message_id` unique | `200 duplicate`, no activity |
| Merge confirm | source row `status='merged'` | Second confirm → "already merged" success |
| Export | none (read-only), audit event per request | Each request audited |
| Job retries | attempts + backoff, handlers are re-entrant | Re-run after partial failure converges |

## 11. Logging, errors, operations

- Structured JSON logs (`src/server/log/logger.ts`) with `requestId`, `jobId`, `eventId`, `level`, `event`, `durationMs`. Redaction list: `password`, `token`, `secret`, `signature`, `cookie`, `authorization`, `body`, `email` (emails are logged as domain + hash prefix).
- Request IDs come from `x-request-id` or are generated; they are returned in `x-request-id` and shown in error pages.
- Health: `GET /api/health` returns DB latency, storage reachability, job counts (`pending`, `retrying`, `failed` in last 24 h). Returns 503 if DB is down.
- Backup: `pg_dump --format=custom` nightly; restore with `pg_restore --clean --if-exists`. Object storage: versioned bucket recommended. Documented in README.
- Migrations: forward-only versioned SQL files. Rollback = restore from backup or a new forward migration; down-migrations are not shipped. Documented.

## 12. Retention and deletion

| Data | Retention | Deletion |
|---|---|---|
| Archived contacts, companies, deals | Indefinite (archive is not deletion) | Hard deletion is not in the UI; a manual SQL procedure is documented |
| Activities, audit events | Indefinite; append-only | Not deleted by the app |
| Sessions | 7 days absolute | Expired rows deleted by the worker hourly |
| Import file in object storage | Deleted after confirm or failure, by `import.cleanup_file` job | Retries with backoff; `file_key` nulled |
| Import rows | Kept with the import for 90 days | Worker deletes rows and imports older than 90 days in `completed/failed/cancelled` state |
| Inbound email excerpt | 180 days | Worker purge job |
| Jobs | 30 days after finish | Worker purge job |

## 13. Test strategy

- **Unit (Vitest, no DB):** normalization (email, domain, phone), stage transition decision function, authz predicates, reopen rules, money/metrics math (conversion, win rate, totals, rounding), CSV formula-injection escaping, CSV parsing and mapping, HMAC signature verification, redaction, backoff calculation.
- **Integration (Vitest + embedded Postgres, isolated DB per run):** every check constraint and unique constraint, append-only triggers (update/delete rejected; merge re-anchor allowed only with setting), stage move atomicity (forced failure after deal update rolls everything back), concurrent stage move conflicts (`FOR UPDATE`), import duplicate flagging and no silent second contact, import confirm idempotency, merge preserves activities/tasks/deals, inbound email idempotency (same message twice → one activity), ambiguous email → no activity, storage adapter success/timeout/retry/denied paths (S3 client stubbed at the transport boundary), inbound signature success/bad signature/stale timestamp/duplicate.
- **Browser (Playwright, desktop 1280×800 and mobile 390×844):** one test per journey (import+merge, deal creation → call → task → stage move, manager overdue + filters + export), plus permission boundary tests (salesperson cannot export full CRM; guessed URL for another owner's deal returns not-found; expired session redirects to sign-in).
- Single commands: `npm test` (unit + integration), `npm run test:e2e` (starts embedded Postgres, migrates, seeds an isolated DB, starts the app, runs Playwright), `npm run verify` (both).

## 14. Acceptance scenarios mapping

1. Imported contact with existing normalized email → import row status `duplicate`, decision required; test asserts no new contact row unless decision is `create`.
2. Dragged deal → one transaction; test forces a failure after the deal update and asserts deal, activity, audit, and metrics are all unchanged.
3. Same BCC email delivered twice → one `inbound_emails` row, one activity; ambiguous email → zero activities, status `ambiguous`.

## 15. Known limitations (to be stated in README)

- Single-instance rate limiting and job worker concurrency rely on Postgres; horizontal scaling needs a shared limiter.
- No live updates; the board refreshes after actions. Pending imports refresh via meta refresh.
- Single currency (EUR) and single timezone (Europe/Madrid) by configuration.
- No OAuth, no provider tokens, so no token-encryption path exists in this slice.
- Users are seeded, not self-service; there is no password reset flow (admin resets via script).
- No hard delete in the UI; retention purge for archived business records is manual.
- Offline/PWA support is not included.
