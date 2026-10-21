# Employee Management System (EMS)

A secure, role-based system for employee records, onboarding and verification, payroll and payslips, retirement monitoring, internal communication and governance.

- **Backend:** Node.js, Express 5, Drizzle ORM, PostgreSQL. In development and tests the database is an embedded PGlite instance, so no database server is needed.
- **Frontend:** React 19, React Router, TanStack Query, Tailwind CSS v4, built with Vite and served by the same Node process.
- **Security model:** deny-by-default RBAC enforced on the server for every request. Field-level privacy, moderator scopes, approval workflows with separation of duties, and an append-only audit log.

---

## Contents

1. [Quick start (development)](#quick-start-development)
2. [Project layout](#project-layout)
3. [Environment variables](#environment-variables)
4. [Database and migrations](#database-and-migrations)
5. [Super admin provisioning and recovery](#super-admin-provisioning-and-recovery)
6. [Roles and access control](#roles-and-access-control)
7. [Key workflows](#key-workflows)
8. [Scheduled jobs](#scheduled-jobs)
9. [Testing](#testing)
10. [Backups and restore](#backups-and-restore)
11. [Deploying to Render](#deploying-to-render)
12. [Security notes](#security-notes)
13. [Integration boundaries and what remains](#integration-boundaries-and-what-remains)

---

## Quick start (development)

Requires **Node.js 22 or newer**. Node 20.11 runs the server, but the `--env-file-if-exists` flag used by the dev scripts needs a newer Node.

```bash
npm install
cp .env.example .env          # optional in development; defaults work out of the box
npm run setup:superadmin -- --email you@example.org --username yourname --name "Your Name"
npm run dev                   # API on http://localhost:3000, web app on http://localhost:5173
```

Open <http://localhost:5173> and sign in with the account you just created. You will be asked to choose a new password on first sign-in.

### Demo data (optional, development only)

```bash
npm run seed:demo
```

This creates locations, job titles and grades, plus 12 employees. It also creates an approved and paid payroll period with payslips, an open payroll period, announcements, an event and one pending self-registration. Every demo account uses the password **`Demo-Password-2026`**:

| Username | Role |
|---|---|
| `demo.super` | Super Admin |
| `demo.admin` | Administrator |
| `demo.finance` | Finance Officer |
| `demo.finance2` | Finance Officer, used as the second approver |
| `demo.moderator` | Moderator, scoped to Construction at St Mark's, Mzuzu plus direct reports |
| `demo.employee` | Employee |
| `demo.pending` | Self-registered account awaiting verification |

The seed refuses to run when `NODE_ENV=production`. It also refuses to write to an external `DATABASE_URL` unless you pass `--allow-database-url`. The proposed retirement policy (age 60) is deliberately left **unadopted**. To see retirement reviews:

1. Sign in as `demo.super`.
2. Open **Retirement → Policies → Verify & adopt**.
3. Go to **Settings → Scheduled jobs → Run now**.

To reset local data, stop the server and delete `.data/pglite`.

---

## Project layout

```
client/            React single-page app (Vite root)
  src/components/  Layout, UI primitives, dialogs
  src/pages/       One file or folder per feature area
  src/lib/         API client (CSRF, re-auth retry), auth context, formatting
server/
  index.ts         Process entry: migrate, seed reference data, listen, schedule jobs
  app.ts           Express app: security headers, CSRF, sessions, error handling, SPA hosting
  routes.ts        HTTP routes; thin wrappers over services
  authz/policy.ts  Permission, scope and field-level checks (single source of enforcement)
  services/        Business logic: employees, payroll, retirement, comms, audit, ...
  db/              Drizzle schema, SQL migrations, idempotent reference seed
shared/            Permission catalogue and role mappings shared by server and client
scripts/           migrate, setup-superadmin, run-jobs, seed-demo, smoke
tests/             Vitest + Supertest suites, run against an in-memory database
```

---

## Environment variables

See `.env.example` for a commented template.

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `DATABASE_URL` | **Production** | — | PostgreSQL connection string. When unset outside production, embedded PGlite is used. |
| `PGLITE_DIR` | No | `.data/pglite` | Where the development PGlite database is stored. |
| `APP_SECRET` | **Production** (at least 32 characters) | dev-only placeholder | Encrypts TOTP secrets at rest (AES-256-GCM). Rotating it invalidates existing MFA enrolments. |
| `APP_URL` | No | `RENDER_EXTERNAL_URL`, then `http://localhost:5173` | Base URL used in invitation links. |
| `PORT` / `HOST` | No | `3000` / `0.0.0.0` | Listen address. Render sets `PORT` automatically. |
| `NODE_ENV` | Production | — | `production` enables secure cookies, strict config and the `DATABASE_URL` requirement. |
| `TRUST_PROXY` | No | `1` in production | Express trust-proxy setting, so client IPs and rate limits are correct behind a load balancer. |
| `CORS_ORIGINS` | No | empty | Extra origins allowed to make credentialed API calls. Not needed when the API serves the SPA. |
| `SESSION_IDLE_MINUTES` | No | `30` | Idle session timeout. |
| `SESSION_ABSOLUTE_HOURS` | No | `12` | Maximum session lifetime. |
| `REAUTH_WINDOW_MINUTES` | No | `10` | How long a password re-confirmation stays valid for sensitive actions. |
| `MAX_UPLOAD_BYTES` | No | `5242880` | Document upload size limit. |
| `RUN_JOBS_IN_PROCESS` | No | `true` (false in tests) | Run scheduled jobs inside the web process. |
| `JOB_INTERVAL_MINUTES` | No | `60` | In-process job interval. |
| `BOOTSTRAP_SUPERADMIN_*` | No | — | One-time super admin bootstrap. See below. |

No secret is ever needed in frontend code. The client only talks to its own origin.

---

## Database and migrations

- The schema lives in `server/db/schema.ts`. SQL migrations live in `server/db/migrations/` and are committed to the repository.
- **Migrations run automatically** on server start, on `npm run jobs:run:prod` and on `npm run setup:superadmin`. You can also run them explicitly:
  - Development: `npm run db:migrate`
  - Production build: `npm run db:migrate:prod`
- **Changing the schema:** edit `schema.ts`, run `npm run db:generate` to create a new SQL migration, review the SQL, commit it, then run the tests.
- **Reference data** is seeded idempotently on every start: permissions, role mappings, the five initial departments (ADM, CLG, CON, PRT, MED), the parishes and stations of the Anglican Diocese of Northern Malawi (diocesan office in Mzuzu, St Peter's Cathedral and St Peter's Mission Hospital on Likoma, and the published parishes of the Likoma, Nkhata Bay, Mzuzu, Karonga and Mzimba archdeaconries), default settings and a *draft* retirement policy. A database that still has the placeholder organisation name “Employee Management System” is renamed to **Anglican Diocese of Northern Malawi** on the next start. A name that has already been changed is left as it is. No user accounts are ever seeded.

### Integrity rules enforced inside the database

These do not rely on application code:

- `audit_logs` is append-only. A trigger rejects `UPDATE` and `DELETE`.
- Issued employment numbers cannot be changed or cleared.
- Approved and superseded payroll records and their line items are immutable. Corrections are made through new revisions.
- Each department has its own row-locked employment-number sequence. Numbers are therefore unique under concurrency and never reused, even after archival or transfer.

---

## Super admin provisioning and recovery

There is **no default administrator account**. Create the first super admin with the CLI:

```bash
# development
npm run setup:superadmin -- --email admin@example.org --username admin --name "Jane Banda"

# production (after `npm run build`, with DATABASE_URL set)
npm run setup:superadmin:prod -- --email admin@example.org --username admin --name "Jane Banda"
```

The password is prompted for interactively, so it never appears in shell history. In a non-interactive environment it is read from `SETUP_PASSWORD`. The account must change its password at first sign-in.

**Break-glass recovery:** re-running the same command for an existing username does the following:

- resets the password and forces a password change
- clears MFA and lockouts
- revokes all of the account's sessions
- ensures the account holds the super admin role

All of this is audited. Run it only from a trusted shell with database access.

**Alternative for hosts without a shell:** set `BOOTSTRAP_SUPERADMIN_EMAIL`, `_USERNAME`, `_PASSWORD` and (optionally) `_NAME`, then start the app once.

- The variables are only honoured when **no active super admin exists**.
- **Delete them immediately afterwards.**

**Ongoing safeguards:**

- The last active super admin cannot be demoted, suspended, deactivated or retired.
- Role and grant changes require password re-confirmation and end the target user's sessions.
- Super admins can issue a one-time temporary password for other users under **Users & access → Recover access**.

---

## Roles and access control

| Role | Summary |
|---|---|
| **Super Admin** | All permissions. Governs roles, settings, retirement policy and decisions, and executive overrides. |
| **Administrator** | Organisation-wide employee records, verification, documents, moderator scopes, announcements and events, organisational reports. Cannot assign roles, change settings, read payroll or make retirement decisions. |
| **Moderator** | Views and updates employees **only within assigned scopes**: a department, a location, both, or direct reports. Employment-critical changes go to approval. |
| **Finance Officer** | Payroll preparation and approval (never their own records, and never approving their own preparation), payslips, retirement statements, financial reports. Sees age but not other personal details. |
| **Employee** | Own profile, own approved payslips, correction requests, announcements, events and comments. |

- The permission catalogue and role mappings are in `shared/permissions.ts`. Enforcement happens **only** in `server/authz/policy.ts` and the services. The client uses permissions purely to decide what to show.
- Records outside a user's scope return `404`, so their existence is not disclosed.
- Denied attempts are written to the audit log as `authz.denied`.

---

## Key workflows

- **Self-registration**
  - Steps: account, then employment details, then *pending verification*.
  - An Administrator or Super Admin verifies the registration, optionally correcting details. Verification activates the account and issues an employment number `DEPT-000001`.
  - Public registration can never select a role. It can be switched off under **Settings**.
- **Invitations:** administrators create the employee record and an invitation link. The link is shown once and expires.
- **Controlled changes:** changes to department, job title, grade, supervisor, status or employment dates are routed to an approver. A Super Admin can apply them directly as an *override*, which requires a reason and is audited.
- **Payroll**
  - Lifecycle: draft, then pending approval, then approved and immutable, then marked paid, then payslip issued.
  - Second-person approval is on by default.
  - Corrections create a new revision. The approved original stays in force until the revision is approved, which then supersedes it.
  - Payslips are printable or can be saved as PDF from the browser (MWK by default).
  - Each period has period-end tools for the accountants: a close checklist with the employees who still have no record, a pay run that marks every approved record paid on one date, remittances by deduction (tax, pension, loans, other) with the payee labels used on records, cost allocation by department and by parish or station, a balanced salaries journal, a comparison with the previous period that flags new people, missing records and changes over a chosen percentage, and a register CSV with one column per earning and deduction category.
- **Retirement**
  - Monitoring only runs under an **adopted** policy.
  - Finance prepares a statement with an explicit calculation method and source figures. A different reviewer verifies it. The Super Admin approves, rejects or defers.
  - Finalising archives the record, which is never deleted, and deactivates the login.
- **Communication:** targeted announcements and events, optional comments with duplicate and rate checks, moderation, and in-app notifications.

---

## Scheduled jobs

These jobs run hourly or daily:

- retirement scan
- event reminders
- contract-expiry notices
- profile-completion reminders

Each run is recorded in `job_runs` with a unique run key, and notifications carry dedupe keys. Running jobs from several places at once (in-process, a cron job, or **Settings → Run now**) is therefore safe and never sends duplicates.

- **In-process:** enabled by default (`RUN_JOBS_IN_PROCESS=true`).
- **External scheduler:** `npm run jobs:run:prod` (`--force` re-runs today's jobs). The Render blueprint runs this hourly as a cron job and turns off in-process jobs.

---

## Testing

```bash
npm run typecheck
npm test
```

Tests run against a fresh in-memory PGlite database per suite. They cover:

- **Acceptance criteria:**
  - registration and verification, unique employment numbers under concurrency, invitations
  - approval workflows and overrides, archival and restore
  - directory filtering, sorting and pagination, CSV export restrictions
  - payroll second-person approval and immutability, retirement monitoring under an adopted policy
  - announcements, events and comments, audit immutability
  - MFA, re-authentication, session revocation on role change, rate limiting
- **Negative authorization per role:** what an employee, moderator, administrator and finance officer cannot do, plus cross-scope access attempts and governance endpoints.
- **Pure helpers:** money totals, CSV-injection escaping, file-type detection, redaction, date arithmetic.

After deploying, run the smoke check against the live URL:

```bash
npm run smoke -- --url https://your-app.onrender.com
SMOKE_USERNAME=... SMOKE_PASSWORD=... npm run smoke -- --url https://your-app.onrender.com   # includes sign-in
```

---

## Backups and restore

All business data lives in PostgreSQL, including uploaded documents, which are stored as `bytea`. The application filesystem holds nothing that needs backing up.

- **Render PostgreSQL:** paid database plans include daily backups and point-in-time recovery. Free databases expire after 30 days and have no backups, so do not use them for real data.
- **Logical backup:**
  ```bash
  pg_dump --format=custom --no-owner --file=ems-$(date +%F).dump "$DATABASE_URL"
  ```
- **Restore into an empty database:**
  ```bash
  pg_restore --no-owner --dbname="$NEW_DATABASE_URL" ems-YYYY-MM-DD.dump
  ```
  Then point `DATABASE_URL` at it and start the app. Pending migrations apply automatically.
- **Test restores regularly.** Keep `APP_SECRET` in your secret store alongside backups. Without it, restored MFA enrolments cannot be decrypted and users must re-enrol, which a super admin can trigger with **Recover access**.
- **Development (PGlite):** stop the server and copy the `.data/pglite` folder.

---

## Deploying to Render

`render.yaml` defines:

- **`ems`**: a Node web service. It builds the client and server, serves both from one process, binds to `0.0.0.0:$PORT`, and uses `/api/health` as its health check.
- **`ems-db`**: managed PostgreSQL.
- **`ems-jobs`**: an hourly cron job that runs the scheduled jobs.
- **`ems-shared`**: an environment group holding `NODE_ENV=production` and a generated `APP_SECRET`.

**Steps:**

1. Push the repository to GitHub, GitLab or Bitbucket.
2. In Render, choose **New → Blueprint** and select the repository. Review the plans; adjust `plan:` values in `render.yaml` if needed.
3. After the first deploy, create the super admin from the web service's **Shell** tab:
   ```bash
   npm run setup:superadmin:prod -- --email admin@example.org --username admin --name "Your Name"
   ```
   If shell access is unavailable on your plan, use the `BOOTSTRAP_SUPERADMIN_*` variables for one deploy, then remove them.
4. Sign in, change the password, and enable MFA under **Account & security**.
5. Under **Settings**, set the organisation details and consider turning on **Require MFA for privileged roles**.
6. Run `npm run smoke -- --url https://<service>.onrender.com` from your machine.

**Notes:**

- Migrations run on every start. With a single instance this needs no extra step. If you scale to several instances, add `preDeployCommand: npm run db:migrate:prod` (paid plans) so migrations run once before the new release starts.
- The filesystem is ephemeral. Nothing is written to disk in production, because documents are stored in PostgreSQL.
- Rate limits are kept in process memory. With several instances, each instance enforces its own limits. Account lockout is stored in the database and applies globally.
- Free web services sleep after 15 minutes of inactivity, so in-process jobs do not run while asleep. The cron job covers this.

### Using Supabase instead of Render PostgreSQL

The application only needs a PostgreSQL connection string, so a Supabase project works as the database. Set up the web service by hand (**New → Web Service**, build `npm ci --include=dev && npm run build`, start `npm start`, health check `/api/health`) and set these variables: `NODE_ENV=production`, `NODE_VERSION=22`, `APP_SECRET` (use Render's Generate), `DATABASE_URL`, `RUN_JOBS_IN_PROCESS=true` if you have no cron service, `DB_POOL_MAX=5` on the free tiers, and the `BOOTSTRAP_SUPERADMIN_*` variables for the first deploy.

- **Use the Session pooler string** for `DATABASE_URL`: in Supabase click **Connect → Session pooler**. It looks like `postgresql://postgres.<project>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres`. The project's `https://<project>.supabase.co` API URL is not a database, and the direct `db.<project>.supabase.co` host is IPv6-only, which Render cannot reach. The transaction pooler on port 6543 does not support prepared statements. URL-encode `@ # : / %` in the password.
- **Start with an empty database.** The application applies and records its own migrations. If the SQL files were pasted into the Supabase SQL editor beforehand, start-up fails with `relation ... already exists`; reset with `drop schema public cascade; create schema public; drop schema if exists drizzle cascade;` in the SQL editor and redeploy.
- **Turn off the Data API.** Supabase exposes tables in the `public` schema through its REST API to the `anon` and `authenticated` roles unless row level security is enabled, and this application does not use row level security because it never talks to that API. Under **Project Settings → Data API**, disable the Data API (or remove `public` from the exposed schemas) so staff and payroll data cannot be read with the project's anon key.
- Free Supabase projects pause after a week without activity; restore them from the Supabase dashboard. Start-up then reports a connection timeout until the project is back.

---

## Security notes

- **Passwords:**
  - Hashed with scrypt and a per-password salt.
  - Minimum of 12 characters with mixed case and a number.
  - Failed sign-ins lead to account lockout.
- **Sessions:**
  - Random tokens in an `HttpOnly`, `SameSite=Lax` cookie, marked `Secure` in production. Only the SHA-256 hash of the token is stored.
  - Idle and absolute timeouts apply.
  - Sessions are revoked on password change, role removal, suspension and recovery.
- **CSRF:** double-submit token. Every state-changing request must include the `X-CSRF-Token` header.
- **MFA:** TOTP (RFC 6238), with secrets encrypted at rest. It can be required for every privileged role.
- **Re-authentication:** role, grant and status changes, recovery, policy adoption, retirement finalisation, MFA disable and security settings all require a recent password confirmation.
- **Headers:** Helmet sets a strict Content-Security-Policy, HSTS in production, `nosniff` and frame denial.
- **Uploads:**
  - Size limit applies.
  - The type is detected from file content (magic bytes) and must be on an allow-list.
  - Downloads are served as attachments with `nosniff`.
- **Exports:** CSV exports neutralise spreadsheet formulas, apply the same field-level restrictions as the screen, and are audited.
- **Logging:**
  - Errors are logged with a request ID only.
  - Audit records redact secrets such as passwords, tokens and MFA secrets.
  - Responses never include stack traces or SQL.

---

## Integration boundaries and what remains

These features need infrastructure or credentials that this repository does not have. They are implemented up to a clear boundary and **do not pretend to succeed**:

| Area | Current behaviour | To complete |
|---|---|---|
| **Email / SMS delivery** | In-app notifications are stored and shown in the app. Invitation links and temporary passwords are shown **once** to the administrator, who delivers them out of band. | Add a mail or SMS provider (e.g. Postmark, SES, Africa's Talking) in `server/services/notifications.ts` and the invitation flow. |
| **PDF payslips** | Payslips are print-optimised pages. Users choose *Print / Save as PDF* in the browser. | Add server-side PDF rendering if signed or batch-emailed PDFs are required. |
| **Document storage** | Stored in PostgreSQL (`bytea`, 5 MB limit by default). | For large volumes, move to object storage (e.g. S3 or R2) behind `server/services/documents.ts`. |
| **Malware scanning** | Uploads are type-checked by content but not virus-scanned. | Add a scanning step (e.g. ClamAV or a cloud scanning API) before storing documents. |
| **Statutory payroll calculations** | Tax, pension and other deductions are entered as explicit line items. No statutory formula is invented. The remittance and journal views total what was entered. | Implement Malawi PAYE and pension rules once they have been confirmed by the organisation's finance or legal advisers. |
| **General ledger posting** | The salaries journal uses account names (basic salaries, allowances, PAYE payable, net salaries payable, and so on) and departments as cost centres. It is exported as CSV. | Map the names to the diocese's chart of accounts, or add a posting integration to the accounting package in use. |
| **Retirement age** | Age 60 exists only as a *draft* policy and has no effect until a Super Admin verifies and adopts it. | Confirm the applicable age and terms, then adopt the policy in the app. |
| **Single sign-on** | Local accounts with optional TOTP MFA. | Add OIDC or SAML if the organisation uses an identity provider. |
