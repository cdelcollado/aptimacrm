# AptimaCRM

A deliberately small CRM for one sales team with one deal pipeline. It keeps contacts, companies, deal stage and the next action in one place. Interface in Catalan (default), Spanish and English.

The technical plan, data model, state transitions and retention rules are in [`docs/PLAN.md`](docs/PLAN.md). Read it before changing the schema or the permission model.

## Prerequisites

- Node.js 22.12 or newer (developed on 24).
- PostgreSQL 16 or newer. For a machine without Docker, `npm run db:dev` starts PostgreSQL 18 from the `embedded-postgres` package (data in `.pgdata-dev`).
- For browser tests: Chromium through Playwright (`npx playwright install chromium`).
- Optional: any S3-compatible bucket for production files. Development uses a private local directory.

## Local setup

```bash
npm install
cp .env.example .env.local          # then edit the values marked "replace"
npm run db:dev                      # terminal 1: local PostgreSQL on 127.0.0.1:54320
npm run db:migrate                  # terminal 2: apply versioned migrations
npm run db:seed                     # load demo data (wipes the database first)
npm run dev                         # http://localhost:3000
npm run worker                      # terminal 3: background jobs (imports, cleanup, purge)
```

Sign in with one of the seeded users. The password is the value of `SEED_PASSWORD` in your `.env.local`.

| Email | Role | What they see |
|---|---|---|
| `admin@aptima.test` | admin | Everything, including stage configuration and full CRM export |
| `manager@aptima.test` | manager | All records, imports, email matching, deal snapshot export, merges |
| `ana@aptima.test` | salesperson | Only records she owns. Her session in the seed is expired, to show the expired-session screen |
| `joan@aptima.test` | salesperson | Only records he owns |

## Environment variables

All variables are documented in `.env.example`. Nothing secret is committed.

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `STORAGE_DRIVER` | no (`local`) | `local` for development and tests, `s3` for production |
| `STORAGE_LOCAL_DIR` | when `local` | Private directory for staged CSV files |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | when `s3` | S3-compatible bucket (path-style addressing) |
| `INBOUND_EMAIL_SECRET` | for email capture | HMAC key for the BCC/forward webhook. Without it the endpoint answers 503 |
| `INBOUND_EMAIL_ADDRESS` | no | The capture address shown on deal screens |
| `ORG_TIMEZONE` | no (`Europe/Madrid`) | Timezone for due days and typed times |
| `ORG_CURRENCY` | no (`EUR`) | Only `EUR` is supported |
| `COOKIE_SECURE` | no | `true` or `false`. Defaults to `true` in production |
| `SEED_PASSWORD` | for seeding | Password for seeded users. At least 12 characters |
| `LOG_LEVEL` | no (`info`) | `debug`, `info`, `warn` or `error` |

Provider tokens and OAuth are not used in this release, so there is no token encryption path to configure.

## Migrations

Migrations are versioned SQL files in `drizzle/`:

- `0000_initial_schema.sql` is generated from `src/server/db/schema.ts`.
- `0001_invariants.sql` is hand-written. It holds the check constraints and triggers that the schema cannot express: append-only activities and audit events, the deal status and stage consistency trigger, and the deferrable stage position constraint.

Rules:

1. Change `schema.ts`, run `npm run db:generate -- --name=<short_name>`, then review the SQL.
2. Never edit a migration that has run anywhere. Add a new one.
3. Migrations are forward only. `npm run db:migrate` is idempotent.

Rollback: restore from a backup taken before the deploy (see below), or ship a new forward migration that undoes the change. There are no down migrations, because they cannot undo data written in the meantime.

## Tests

| Command | What it runs |
|---|---|
| `npm test` | Unit tests (no database) and integration tests. Integration tests start a throwaway PostgreSQL cluster, migrate a fresh database, and remove it at the end. |
| `npm run test:unit` | Unit tests only |
| `npm run test:integration` | Integration tests only |
| `npm run test:e2e` | Builds the app, then runs the browser tests twice, once on a desktop viewport (1280×800) and once on a phone viewport (390×844). Each run gets a fresh stack: `scripts/e2e-stack.ts` starts its own PostgreSQL on port 54330, seeds it, starts the worker and the production server. Two runs keep the data each journey expects.
| `npm run verify` | Typecheck, `npm test`, `npm run test:e2e` |

What is covered:

- **Domain unit tests:** email, domain, phone and company-name normalization; stage transition rules (reopen needs a manager and a reason); authorization predicates; metric math (conversion, win rate, totals in integer cents); timezone conversion across DST; CSV parsing and formula-injection escaping; column mapping; import duplicate rules; webhook signature verification; backoff; log redaction; translation completeness.
- **Integration tests:** every check and unique constraint; append-only triggers (update and delete rejected, re-anchoring allowed only in a merge transaction); stage move atomicity (forced failure rolls everything back) and concurrency (two moves with the same version, one wins); import duplicate flagging and idempotent confirmation; merge preserves activities, tasks and deals; BCC capture delivered twice creates one activity (acceptance scenario 3); job queue leases, backoff and failure states; storage adapter success, timeout, retry and denial paths; salesperson visibility on every query; route handlers for the inbound webhook and health; session expiry and idle timeout.
- **Browser tests:** the three journeys (import and merge; sales deal from company to pipeline; manager review and export), plus permission boundaries, the expired-session screen, sign-in failures, inbound email with a valid and an invalid signature, and language switching.

## Deployment

1. Build: `npm ci && npm run build`.
2. Set the environment from the table above. Set `COOKIE_SECURE=true` and serve only over HTTPS.
3. Run migrations as a separate step before starting the new version: `npm run db:migrate`.
4. Start the web process: `npm start`. Start one or more worker processes: `npm run worker`. Workers claim jobs with `SKIP LOCKED`, so several are safe.
5. Health check: `GET /api/health` returns 200 with database latency, storage reachability and job counts (`pending`, `retrying`, `running`, `failed24h`), or 503 when the database is down. It exposes no secrets and no personal data.
6. Put the app behind a reverse proxy that sets `X-Forwarded-For` (used for rate limits). Do not expose `/api/email/inbound` to anything other than your mail provider's webhook.

## Integration setup

### BCC and forwarding capture

Configure your mail provider (or a small relay) to POST each captured message to `https://<your-host>/api/email/inbound` with a JSON body:

```json
{ "messageId": "<unique id from the provider>", "receivedAt": "2026-10-25T09:00:00Z",
  "from": "contact@example.com", "to": "capture@crm.example.com",
  "subject": "Re: proposal", "text": "message body as plain text" }
```

Headers, computed with the shared secret:

```
X-Aptima-Timestamp: <unix seconds>
X-Aptima-Signature: sha256=<hex HMAC-SHA256 over "<timestamp>.<raw body>">
```

Responses: `202` captured, ambiguous or unmatched; `200 {"status":"duplicate"}` when the message id was already seen (no second activity); `400` invalid payload; `401` bad or stale signature (more than 5 minutes old or more than 1 minute in the future); `413` body above 256 KB; `429` rate limited (60 per minute per source); `503` not configured, or a temporary storage error (the provider should retry).

Matching rules: one active contact with that address → an email activity on the contact, attached to its deal only when it has exactly one open deal. Several contacts → "ambiguous", no activity, and a manager matches it on `/email`. No contact → "unmatched".

### Object storage (S3)

Use a private bucket with server-side encryption. The application needs `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject` and `s3:ListBucket` on the `imports/` prefix only. Keep the bucket versioned if you want recovery from accidental deletes. Files are never served by a URL; the server reads them.

## Security decisions

- **Authentication:** email and password, scrypt (N=16384, r=8, p=1) with a per-user salt. Sessions are random 32-byte tokens; only their SHA-256 is stored. Cookies are `HttpOnly`, `SameSite=Lax`, `Secure` in production and named with the `__Host-` prefix there. Idle timeout 8 hours, absolute timeout 7 days. Sign-out revokes the session row.
- **Sign-in throttling:** 5 failed attempts per email per 15 minutes. The error message is the same for unknown emails, wrong passwords and inactive users, and the timing is equalised.
- **Authorization:** enforced in the query and mutation layer, not in the UI. Salespeople see and change only records they own. A record they cannot see returns not-found, not forbidden, so ids cannot be probed. Owner changes, stage changes, merges, exports and stage configuration are restricted and audited. The company name on a deal is replaced with `[restricted]` when the company belongs to another owner.
- **Exports:** managers get a deal snapshot without contact email or phone. Full CRM exports are admin-only and every download is written to the audit log with its row count. CSV cells starting with `= + - @` or a tab are prefixed with `'` (formula injection).
- **Imports:** UTF-8 only, 2 MB and 5000 rows maximum, header required. The file is stored privately and deleted after confirmation or cancellation. Duplicates are never created or merged silently.
- **Activities:** append-only at the database level. Corrections insert a new row that keeps the original text, the reason, the editor and the time. The audit log is append-only too.
- **Inbound webhook:** HMAC signature with a timestamp window, constant-time comparison, message-id idempotency, body size limit and per-IP rate limit. Raw payloads are not stored, only a hash.
- **Input handling:** all text is length-limited and stripped of control characters on the server. Rendering escapes by default; no HTML from users is rendered. Post-login redirects must be same-origin relative paths.
- **HTTP headers:** a Content-Security-Policy restricting resources to the same origin, `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `nosniff`, a strict referrer policy and a permissions policy that denies camera, microphone and geolocation.
- **Logs:** JSON with a request id on every line. Keys that look like passwords, tokens, secrets, signatures, cookies, bodies or raw payloads are redacted. Emails appear as domain only.
- **Personal data:** only what the workflow needs. Import rows are removed after 90 days, inbound email excerpts after 180 days, and finished jobs after 30 days. Sessions expire and are deleted.

## Idempotency

| Operation | Mechanism |
|---|---|
| Stage move | Optimistic version; the same target stage is a no-op |
| Import confirmation | Import status checked under a row lock; a repeat changes nothing |
| Import parse and cleanup jobs | Unique idempotency keys in the `jobs` table |
| Inbound email | Unique provider message id; duplicates answer 200 |
| Merge | A repeat after success answers "already merged" |
| Task completion | Completing a completed task is a no-op |

## Backup and restore

- **Database:** nightly `pg_dump --format=custom --file=aptimacrm-$(date +%F).dump "$DATABASE_URL"`. Keep at least 30 days. Test a restore at least monthly.
- **Restore:** `pg_restore --clean --if-exists --no-owner --dbname="$DATABASE_URL" aptimacrm-<date>.dump`, then `npm run db:migrate` to bring a restored older schema up to date. Stop the workers during a restore.
- **Object storage:** keep versioning enabled. Staged imports are short-lived, so losing them only means uploading again.

## Screen contract

Every screen has a primary action, visible status and a recoverable failure. Specifically:

- **Dashboard:** quick create; counts link to the view they describe; "—" for rates with no data (never 0%).
- **Contacts and companies:** search, active or archived view, duplicate badge, merge entry point on the contact detail. Archiving is refused, with the reason, while open deals depend on the record.
- **Pipeline:** drag a card to move it, or use the stage menu on the card (works without JavaScript and from the keyboard). A conflict tells the user that someone else changed the deal and reloads the latest version.
- **Deal detail:** stage move, edit, activity log, corrections, tasks, email capture status.
- **Imports:** mapping with suggestions, then an automatic refresh while the file is checked, row-level errors, a required decision for each duplicate, and a retry button when the parse job has failed.

## Known limitations

- **Single instance for rate limits:** the sign-in and webhook limits are in memory. Several web instances each keep their own counters.
- **No live updates:** the board refreshes after each action. Import review refreshes every 5 seconds while processing.
- **Not PWA or offline.**
- **Single currency and timezone** (EUR, Europe/Madrid by configuration).
- **No self-service users:** accounts are created by an administrator. There is no password reset flow; reset by setting a new hash with the same scrypt format.
- **No hard delete in the interface.** Archived records are kept. A purge for archived business records is a manual, documented database procedure, not an app feature.
- **Company merge is not offered.** Duplicate companies are flagged; merging them is a future step with the same design as contact merge.
- **Content-Security-Policy allows inline scripts and styles** because Next.js emits inline bootstrap code. A nonce-based policy would tighten this and is a planned follow-up.
- **Forms with validation require JavaScript** for inline field errors. Without it, the server still validates and rejects; the plain forms (sign-in, stage moves, archive, task completion, stage configuration) work without JavaScript.
- **OAuth and provider tokens:** not used, so the token encryption path in the brief is not present.
- **Email sending:** the app captures email; it does not send any.
- **Capture is manual for ambiguous senders:** a manager must match them; there is no automatic rule.
