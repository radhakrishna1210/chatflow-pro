# Spandan — Backend

Node.js 22 + Express 5 + Prisma 5 (PostgreSQL) + BullMQ (Redis) backend for the
Spandan WhatsApp Business / CRM platform. The root [README](../README.md) is the
full reference; [DEPLOY.md](../DEPLOY.md) covers Render and the VPS.

## Requirements

- **Node.js 22** (`engines: ">=22 <23"`; `.nvmrc` at the repo root). Other
  majors are outside the supported range — `--experimental-test-module-mocks`
  in particular behaves differently on 24.
- PostgreSQL 14+ — for development and tests, a **local** database only (see
  [docs/LOCAL_DEV_DATABASE.md](../docs/LOCAL_DEV_DATABASE.md)).
- Redis 6+ — see [docs/local-redis-setup.md](docs/local-redis-setup.md). Without
  Redis the dev server still starts, but no background work runs.

## Quick start

```bash
cd backend

# 1. Environment. Fill in at least the CHANGE_ME secrets and a LOCAL DATABASE_URL.
cp .env.example .env

# 2. Install. postinstall generates the Prisma client (no DB connection needed)
#    and, on deploys, builds the frontend.
npm install

# 3. Create the schema in your local database. The guard refuses any non-local URL.
node --env-file=.env scripts/assert-local-db.js && node scripts/prisma-cli.js migrate deploy

# 4. Optional seed data
node --env-file=.env scripts/seed-plans.js
node --env-file=.env scripts/create-test-user.js   # test@example.com / password123

# 5. Run
npm run dev        # node --watch, http://localhost:4000
```

`migrate deploy` builds an empty database because the first migration,
`20260101000000_baseline`, creates the pre-migration schema (on an existing
database it is a guarded no-op). Do **not** use `npm run db:migrate`
(`prisma migrate dev`) against any shared or hosted database — it can prompt to
reset it. In development `src/server.js` does not run migrations itself; on
servers (`NODE_ENV` other than `development`) it runs `migrate deploy` at boot
and refuses to start if that fails.

## Environment variables

[`.env.example`](.env.example) lists every variable `src/config/env.js` reads,
with defaults and notes; the root README §4 has the same table. The app exits on
boot if a required one is missing. Required: `NODE_ENV` (the server refuses to
start without it), `DATABASE_URL`, `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET`
(32+ chars each), `ADMIN_EMAIL`, `ENCRYPTION_KEY` (32 ASCII or 64 hex chars),
`META_APP_ID`, `META_APP_SECRET`, `META_BUSINESS_ID`, `META_WABA_ID`,
`META_SYSTEM_USER_TOKEN`, `META_WEBHOOK_VERIFY_TOKEN`, `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`. With `NODE_ENV=production`, `CLIENT_URL`, `APP_URL` and
`REDIS_URL` must also be set explicitly.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | API + workers with `--env-file=.env` and `--watch` |
| `npm start` / `npm run start:prod` | `node src/server.js` (reads `.env` from the current directory via dotenv) |
| `npm run start:worker` | Background work only, no HTTP (`src/worker.js`) |
| `npm test` | Unit tests (see below) |
| `npm run test:otp` | Authentication-product OTP scope tests (`tests/otp-scope.test.mjs`) |
| `npm run test:prisma-schema` | Schema canonical-form check (no DB) |
| `npm run db:push` / `db:studio` | Prisma `db push` / Studio — local databases only |
| `node scripts/reencrypt-secrets.js [--apply]` | Re-encrypts stored secrets with the current `ENCRYPTION_KEY` (dry run without `--apply`) |

## Tests

```bash
npm test
# = node --import ./tests/setup.mjs --experimental-test-module-mocks --test "src/**/*.test.js"
```

- `tests/setup.mjs` runs first. If `backend/.env.test` exists it **replaces**
  `.env` for the whole run (git-ignored; copy `.env.example` and point
  `DATABASE_URL` at a local test database). Without it `.env` is used.
- Either way `scripts/require-local-db.js` then **refuses to run** unless every
  database URL the process could use is local (loopback host, no managed-provider
  marker). Tests create and delete real rows; they must never reach a shared DB.
- Most suites mock Prisma and need no database. Suites that do need one skip
  themselves (`database unavailable`) when it is not reachable, so a run with a
  dummy URL such as `postgresql://test:test@127.0.0.1:1/none` still passes and
  reports those as skipped.
- Frontend unit tests: `cd ../frontend && npm test`.

The `scripts/*-check.mjs` scenario scripts drive a running local server and,
for Meta-facing ones, real WhatsApp sends that cost money; they are not part of
`npm test`.

## Architecture

```
src/
├── server.js              Boot: migrate deploy (non-dev), DB, platform settings, HTTP,
│                          then — when RUN_WORKERS — plan backfill, workers, schedules,
│                          recovery and the billing sweep; /health/ready flips to 200 after
├── worker.js              Same boot without HTTP (npm run start:worker)
├── app.js                 Express app: security headers, CORS, raw-body capture for
│                          signed webhooks, Passport, /api/v1 router, SPA, error handler
├── config/env.js          Zod-validated environment (+ super-admin DB overrides)
├── routes/                ~65 routers; routes/index.js mounts them (see root README §5)
├── authentication/        WhatsApp OTP "Authentication API" product (/authentication)
├── controllers/           Thin request/response handlers
├── services/              Business logic and Prisma queries
├── validators/            Zod schemas (validators/index.js and per-area files)
├── middleware/            authenticate, authenticateApiKey, workspaceContext,
│                          roleCapabilities, authorize, requireFeature, rateLimit,
│                          adminAudit, securityHeaders, errorHandler
├── lib/                   prisma, redis, meta (Graph API), encryption (AES-256-GCM),
│                          razorpay, llm (Gemini/Ollama), mailer, safeUrl (SSRF guard),
│                          tokenDenylist, readiness, campaignCharge, messagePricing, ...
├── queues/                BullMQ queues (below) and deterministic job ids
└── workers/               One worker per queue
```

Queues and workers (all started by the process with `RUN_WORKERS=true`):

| Queue | Worker | Purpose |
| --- | --- | --- |
| `campaigns` | `campaign.worker.js` | Campaign sends, retries, charge settlement |
| `emails` | `email.worker.js` | Transactional e-mail via SMTP |
| `billing` | `billing.worker.js` | Daily billing-cycle renewals/cancellations |
| `workflows` | `workflow.worker.js` | Workflow runs and delayed resumes |
| `sequences` | `sequence.worker.js` | CRM sequence steps (+ recovery sweep) |
| `agent` | `agent.worker.js` | Autonomous CRM agent tick and sweep |
| `webhooks` | `webhook.worker.js` | Inbound Meta webhook events, serialised per customer |
| `outgoing-webhooks` | `outgoingWebhook.worker.js` | Durable delivery of workspace webhooks |
| `crm-maintenance` | `crmMaintenance.worker.js` | Lead re-scoring and nightly quote expiry |

All routes are under `/api/v1`; workspace-scoped ones under
`/api/v1/workspaces/:workspaceId/*`, behind `authenticate` + `workspaceContext`
(membership, suspension, inactive subscription and the VIEWER/AGENT capability
floor), with `authorize('CLIENT'|'ADMIN')` on writes.
