# Spandan

A multi-tenant WhatsApp Business platform with a built-in CRM: shared inbox,
bulk and scheduled campaigns, templates, contacts/segments, automation
(keyword rules, intent matching, visual workflows, AI agents), a sales CRM
(leads, deals, tasks, tickets, quotes, sequences, forecasting), a WhatsApp OTP
"Authentication API", a public REST API with OAuth, and subscription billing
with a prepaid wallet (Razorpay). Node.js/Express + Prisma/PostgreSQL +
BullMQ/Redis on the backend, React (Vite, custom history router) on the
frontend, Meta WhatsApp Cloud API for messaging.

This README is the standalone reference for picking the project up cold.
Related documents:

| Document | Contents |
| --- | --- |
| [backend/README.md](backend/README.md) | Backend quick start, scripts, tests, queue list |
| [backend/.env.example](backend/.env.example) | Every environment variable the backend reads |
| [DEPLOY.md](DEPLOY.md) | Render and VPS deployment, and the audit-remediation upgrade steps |
| [backend/docs/PUBLIC_API.md](backend/docs/PUBLIC_API.md) | Public REST API, API keys and OAuth |
| [docs/LOCAL_DEV_DATABASE.md](docs/LOCAL_DEV_DATABASE.md) | Local Postgres and the local-database guard |
| [audit/](audit/) | 2026 deep audit: `BUG_SHEET.md` (CF-001 … CF-227), `AUDIT_REPORT.md`, `REMEDIATION_STATUS.md` |
| [docs/archive/](docs/archive/) | Superseded historical bug reports and stabilisation notes |

---

## 1. Tech stack

| Layer | Technology |
|---|---|
| Runtime | **Node.js 22** (`engines: ">=22 <23"` in both packages, `.nvmrc`), ES modules |
| Backend | Express 5, Zod validation, Passport (Google OAuth) |
| Data | Prisma 5 → PostgreSQL (Supabase in production); optional `pg` driver adapter |
| Background work | BullMQ + Redis (`ioredis`) — nine queues, see §7 |
| Auth | JWT access tokens + hashed, rotating refresh tokens; bcrypt; e-mail OTP signup; Google sign-in |
| Messaging | Meta Graph API (WhatsApp Cloud API); Twilio for SMS fallback and Voice AI; Instagram messaging |
| Payments | Razorpay (plan checkout, add-ons, wallet top-ups, signed webhook) |
| AI | Gemini (`@google/genai`) with Ollama fallback; OpenAI / Cloudflare Workers AI for template header images |
| E-mail | `nodemailer` over SMTP, via the `emails` queue |
| Frontend | React 18, Vite, `recharts`; hand-rolled history router in `frontend/src/App.jsx` |

---

## 2. Repository layout

```
.
├── backend/                  Express API + BullMQ workers (see backend/README.md)
│   ├── src/
│   │   ├── server.js         Boot (migrations, DB, HTTP, workers, recovery, sweeps)
│   │   ├── worker.js         Worker-only entry point (npm run start:worker)
│   │   ├── app.js            Express app, CORS, raw-body capture, SPA serving, error handler
│   │   ├── config/env.js     Zod-validated environment — single source of truth
│   │   ├── routes/           ~65 routers, mounted in routes/index.js (§5)
│   │   ├── authentication/   WhatsApp OTP Authentication API product
│   │   ├── controllers/ services/ validators/ middleware/ lib/
│   │   ├── queues/ workers/  BullMQ queues and their workers (§7)
│   │   └── data/             Template library, site/help content for the website assistant
│   ├── prisma/schema.prisma  Data model; prisma/migrations (baseline + incremental)
│   ├── scripts/              Prisma wrapper, local-DB guard, seeds, re-encryption, check scripts
│   ├── tests/                Test bootstrap (setup.mjs) and two standalone suites
│   ├── docs/                 PUBLIC_API.md, local-redis-setup.md
│   └── .env.example          Environment template
├── frontend/                 React + Vite SPA
│   └── src/
│       ├── App.jsx           Router and auth/workspace guards
│       ├── lib/              api.js (wFetch/adminFetch/apiFetch + token refresh), permissions, polling, ...
│       ├── pages/            One file per screen (Dashboard shell lazy-loads the views)
│       └── components/       Shared UI (Feedback dialogs, ErrorBoundary, Copilot, CommandPalette, ...)
├── audit/                    2026 audit: bug sheet, report, route inventory, remediation status
├── docs/                     Product/engineering notes; docs/archive/ holds superseded reports
├── tests/, playwright.config.js   Playwright smoke specs (local by default, §10)
├── tests-e2e*.mjs            Scripted API end-to-end suites against a local stack (§10)
├── public-api-test/          Small client exercising the public API
├── render.yaml, DEPLOY.md    Render blueprint and deployment guide
└── deploy-vps.sh             One-command redeploy for the Hostinger VPS (PM2)
```

---

## 3. Getting started

Prerequisites: Node.js 22, a **local** PostgreSQL 14+, Redis 6+ (optional for UI
work; see `backend/docs/local-redis-setup.md`), and — for real sends — a Meta
app with WhatsApp Cloud API access and a Google OAuth client.

```bash
# Backend
cd backend
cp .env.example .env          # fill in the CHANGE_ME secrets and a local DATABASE_URL
npm install                   # postinstall generates the Prisma client
node --env-file=.env scripts/assert-local-db.js && node scripts/prisma-cli.js migrate deploy
npm run dev                   # http://localhost:4000

# Frontend (second terminal)
cd frontend
npm install
npm run dev                   # http://localhost:5173, proxies /api to :4000
```

Never run `prisma migrate dev` / `npm run db:migrate` against a shared or hosted
database. In production the backend serves the built SPA from `frontend/dist`,
so the API and UI share one origin (see DEPLOY.md).

---

## 4. Environment variables

The full list, with defaults and notes, is in
[`backend/.env.example`](backend/.env.example), generated from
`backend/src/config/env.js`. The app exits at boot when a required variable is
missing or invalid.

| Variable | Required | Notes |
|---|---|---|
| `NODE_ENV` | **yes** for the server | `src/server.js` refuses to start when unset; `development` locally, `production` on servers |
| `CLIENT_URL`, `APP_URL`, `REDIS_URL` | **yes** when `NODE_ENV=production` | Frontend origin; backend public URL (OAuth callbacks, Twilio signatures); Redis shared by every deployment on the same database |
| `DATABASE_URL` | **yes** | Postgres (pooled). `DIRECT_URL` optional for migrations |
| `DATABASE_POOL_SIZE` | no (5) | Prisma connections per process |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | **yes** (32+ chars) | |
| `ADMIN_EMAIL` | **yes** | The platform super-admin account |
| `ENCRYPTION_KEY` | **yes** (32 ASCII or 64 hex) | AES-256-GCM key for tokens/credentials at rest |
| `ENCRYPTION_KEYS_PREVIOUS` | no | Old keys accepted during rotation; then run `node scripts/reencrypt-secrets.js --apply` |
| `META_APP_ID`, `META_APP_SECRET`, `META_BUSINESS_ID`, `META_WABA_ID`, `META_SYSTEM_USER_TOKEN`, `META_WEBHOOK_VERIFY_TOKEN` | **yes** | Meta app and platform WABA. `META_SYSTEM_USER_ID` and `META_DISPLAY_NAME` are optional and unused |
| `META_TWO_STEP_PIN` | no | 6-digit PIN for registering numbers that already have two-step verification |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | **yes** | Google sign-in |
| `TRUST_PROXY_HOPS` | set in production | `1` on Render and the VPS; rate limits key on the derived client IP |
| `RUN_WORKERS` | no (`true`) | Whether this process owns workers, schedules, recovery and the billing sweep — exactly one per database |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | for billing | Checkout and the `POST /api/v1/webhook/razorpay` webhook (503 without its secret) |
| `ALLOW_DEMO_RECHARGE` | no (`false`) | Unpaid demo wallet top-up; only honoured outside production |
| `EXPOSE_ERROR_DETAIL` | no (`false`) | Raw 5xx messages in responses; only with `NODE_ENV=development` |
| `GEMINI_*`, `OLLAMA_*`, `OPENAI_*`, `CLOUDFLARE_*`, `IMAGE_PROVIDER` | no | AI features degrade without them |
| `SMTP_*`, `EMAIL_FROM*` | no | E-mail is skipped when SMTP is not configured |
| `TWILIO_*`, `INSTAGRAM_*` | no | SMS fallback / Voice AI; Instagram app (falls back to the Meta app) |

Platform credentials (API keys, SMTP password, …) can also be overridden from
the super-admin settings screen; those values live in the database and take
effect without a redeploy.

---

## 5. API surface

Everything is under `/api/v1` (`backend/src/routes/index.js`).
`audit/ROUTE_INVENTORY.md` lists every route.

**Public and account-level**

| Prefix | Purpose |
|---|---|
| `GET /health`, `GET /health/ready` | Liveness; readiness (503 until boot finished and Postgres + Redis answer) |
| `GET /pricing` | Published per-category message rates |
| `/auth` | `/register/start` → `/register/verify` (e-mail OTP; `/register/resend`), `/login`, `/refresh`, `/logout`, `/forgot-password`, `/reset-password`, `/exchange` (one-time code → session), Google sign-in, Meta and Instagram connect callbacks. There is no single-step `/register` |
| `/oauth` | Spandan as an OAuth authorization server (`/authorize`, consent, `/token`, `/revoke`) — issues scoped API keys |
| `/public` | Public REST API authenticated by API key (messages, templates, campaigns, contacts, analytics, wallet balance, AI agent, webhooks) — see `backend/docs/PUBLIC_API.md` |
| `/authentication` | WhatsApp OTP Authentication API (`/generate`, `/verify`), API-key authenticated |
| `/webhook` | Meta WhatsApp webhook (`GET` verify, `POST` signed events), Razorpay webhook (`/razorpay`), Instagram webhook |
| `/voice` | Twilio Voice AI callbacks (signature-verified) |
| `/forms`, `/invitations`, `/assistant` | Public lead forms; invitation accept; website assistant chatbot |
| `/users`, `/notifications`, `/onboarding` | Current user profile/sessions; user notifications; AI onboarding chat |
| `/admin` | Platform super-admin (`ADMIN_EMAIL`): number pool, platform settings and credential checks, workspaces, users (impersonate, sign out, disable), plans, payments, audit log |
| `POST /workspaces` | Create a workspace — the creator becomes its `ADMIN` |

**Workspace-scoped** — `/api/v1/workspaces/:workspaceId/…`

| Area | Prefixes |
|---|---|
| Messaging | `whatsapp`, `templates`, `campaigns`, `conversations`, `contacts`, `segments`, `clusters`, `opt-outs` (alias `blocked-numbers`), `whatsapp-forms`, `widgets`, `instagram` |
| Automation and AI | `automation`, `workflows`, `intents`, `ai-agent`, `ai-agents`, `ai` (drafting, simulator), `copilot`, `agent` (autonomous CRM agent) |
| CRM | `leads`, `deals`, `tasks`, `activities`, `tickets`, `quotes`, `products`, `sequences`, `lead-forms`, `lead-distribution`, `pipeline-stages`, `forecast`, `custom-fields` (alias `custom`), `saved-views`, `teams`, `search`, `insights`, `crm-analytics`, `crm-data` (import/export), `crm-sales-inbox`, `crm-permissions`, `crm-customization`, `progress` (gamification) |
| Billing | `subscription` (plans, checkout, change/renew, billing profile, add-ons), `wallet` (balance, summary, Razorpay top-up) |
| Workspace | `settings`, `members`, `invitations`, `switch`, `api-keys`, `authentication` (OTP product config), `integrations`, `analytics`, `support` |

### 5.1 Roles and access control

- **Tenancy.** Every workspace router runs `authenticate` + `workspaceContext`.
  `workspaceContext` re-reads the caller's `WorkspaceMember` row for the
  `:workspaceId` in the URL (403 when not a member), blocks suspended
  workspaces and workspaces whose subscription is `CANCELLED`/`EXPIRED`
  (except the `subscription` and `wallet` routes), and sets `req.user.role`
  from that row — a stale JWT role is never trusted.
- **Roles** (`WorkspaceMember.role`), lowest to highest: `VIEWER`, `AGENT`,
  `CLIENT` (shown as "Member"), `ADMIN`. `authorize('CLIENT')` means "CLIENT or
  higher".
  - `VIEWER` is read-only; `AGENT` may only do an explicit list of inbox and
    contact writes (reply, media, notes, assign/status/bot toggle, create/edit a
    contact, block a number, log a CRM activity, preview an AI reply) —
    `middleware/roleCapabilities.js`. Bulk contact/opt-out exports need CLIENT.
  - `CLIENT` creates and edits workflows, clusters, leads, campaigns and other
    day-to-day records, and unblocks numbers.
  - `ADMIN` only: members and invitations, billing (checkout, plan change,
    renew, billing profile, add-ons, wallet top-up), API keys (except the
    playground test send), OAuth app connect, outgoing webhook destination and
    test, Authentication-API (OTP) config, WhatsApp number connect/onboard/
    embedded signup/pool/disconnect, CRM customization, lead deletion and
    distribution-rule management (CRM permission matrix,
    `services/crmPermissions.service.js`).
- **Platform super admin** is the account whose e-mail equals `ADMIN_EMAIL`
  (`superAdmin` on the JWT), orthogonal to workspace roles. Impersonation
  issues a 30-minute, marked access token with no refresh token, requires a
  reason, is held in tab-scoped `sessionStorage`, and cannot mint lasting
  credentials; admin actions are written to an audit log.

### 5.2 Website assistant (RAG chatbot)

A retrieval-grounded chatbot that answers questions about Spandan from the
site's own content and declines anything that content does not cover.

| Endpoint | Auth | Purpose |
| --- | --- | --- |
| `POST /assistant/chat` | public, 12 req/min per IP | `{ question, history }` → `{ answer, grounded, sources, reason }` |
| `GET /assistant/status` | public | Index health |
| `POST /assistant/reindex` | super admin | Force a re-sync (`{ force: true }` re-embeds everything) |

Sources (`services/siteKnowledge.service.js`): `data/siteContent.js` (also
rendered by the landing page), `data/helpContent.js`, and the active `Plan` rows
and message rate card from the database, so quoted prices are what checkout
charges. The index syncs by content hash on boot (owner process only) or on
`/reindex`. Retrieval blends Gemini-embedding cosine similarity with BM25; when
nothing relevant is found no model is called and a fixed refusal is returned.
UI: `frontend/src/components/SiteAssistant.jsx`.

---

## 6. Data model

Full schema: `backend/prisma/schema.prisma`. Core models:

- **User**, **RefreshToken** (SHA-256 hash only, token family for reuse
  detection), **WorkspaceMember** (`role`: VIEWER/AGENT/CLIENT/ADMIN),
  **Workspace** (tenant boundary: settings, wallet balance, suspension, AI and
  voice settings), **Invitation**, **EmailOtp**.
- Messaging: **WaNumber** (encrypted access token), **NumberPool**,
  **Template**, **Contact**, **Segment**, **Conversation**, **Message**,
  **Campaign** / **CampaignRecipient** (per-recipient status, quota
  reservation, AI context), **CampaignAiSession**, **AutomationTrigger**,
  **Workflow** / **WorkflowRun**, opt-outs.
- CRM: leads, deals (+ stage history, line items), tasks, CRM activities,
  tickets, quotes, products, sequences/enrolments, teams, saved views, custom
  field definitions, lead forms and submissions, pipeline stages.
- Billing: **Plan** (quota, limits, per-category overage rates, feature
  flags), **Subscription** (billing cycle, pending change, cancel-at-period-end),
  **UsageCounter**, **WalletTransaction** (append-only ledger with unique
  idempotency key), **GatewayPayment** (each Razorpay payment applied once),
  **Invoice**, workspace add-ons.
- Platform: **ApiKey** (hashed, scoped, actor), OAuth clients/grants,
  **WorkspaceIntegration** (encrypted credentials), **SupportTicket**, admin
  audit log, site-knowledge chunks.

Migrations: `prisma/migrations/20260101000000_baseline` creates the
pre-migration schema on an empty database and is a no-op on existing ones;
later migrations are incremental. Apply with `prisma migrate deploy` only.

### 6.1 Campaign AI agent

A campaign can carry a deployed WhatsApp AI agent (campaign wizard). The
customer taps the campaign's CTA ("Ask Anything" or a chosen label) and talks
to the agent about *that* campaign.

- The CTA rides on the template's approved quick-reply button; the send stamps
  it with a per-recipient payload (`cfp_campaign_ai:<recipientId>`). Without a
  quick reply the agent still opens if the customer types the label.
- The agent answers from a snapshot: `CampaignRecipient.aiContext` (the message
  that contact received, variables resolved), falling back to
  `Campaign.aiAgentContext` from launch, so later edits cannot change what an
  existing recipient is told.
- An active `CampaignAiSession` is layer 4 of inbound handling — after opt-out,
  human handoff and control commands, ahead of forms, workflows, keyword and
  intent rules, welcome/OOO and the general AI agent (full order in the comment
  block of `services/webhook.service.js`).
- Sessions expire after `SESSION_TTL_MINUTES` (24 hours) without activity and
  end on an exit command. Every lookup is scoped by `workspaceId`; the payload
  is re-checked against the contact and workspace.

---

## 7. Background jobs

Exactly one process per database runs background work: the one with
`RUN_WORKERS=true` (default). It starts every worker, registers the repeatable
schedules, re-queues scheduled campaigns, pending retries and stranded
campaigns at boot (plus a 5-minute stranded-campaign sweep), backfills
subscriptions and runs the billing sweep. `npm run start:worker` runs the same
boot without HTTP so workers can live in their own process.

| Queue | Worker | Work |
| --- | --- | --- |
| `campaigns` | `campaign.worker.js` | Sends campaigns (rate-limited by `CAMPAIGN_RATE_DELAY_MS`), retries, SMS/e-mail fallback, refunds unsent units, completion e-mail |
| `emails` | `email.worker.js` | Transactional e-mail |
| `billing` | `billing.worker.js` | Daily billing-cycle renewals, cancellations, past-due retries |
| `workflows` | `workflow.worker.js` | Workflow runs and delayed resumes |
| `sequences` | `sequence.worker.js` | CRM sequence steps, with a recovery sweep |
| `agent` | `agent.worker.js` | Autonomous CRM agent tick and sweep |
| `webhooks` | `webhook.worker.js` | Inbound Meta events, processed in order per customer |
| `outgoing-webhooks` | `outgoingWebhook.worker.js` | Durable, retried delivery of workspace webhooks (SSRF-guarded) |
| `crm-maintenance` | `crmMaintenance.worker.js` | Debounced lead re-scoring, nightly score refresh and quote expiry |

The Meta webhook endpoint verifies the signature, enqueues the event and only
then answers 200 (503 if it cannot be queued, so Meta redelivers). Meta's
callback URL must therefore point at a deployment whose Redis is read by a
process running the `webhooks` worker. In development without Redis, events
are processed inline.

---

## 8. Billing and wallet

- **Plans** (`Plan`): FREE, BASIC and GROWTH are created on first boot if
  missing (`scripts/seed-plans.js` re-seeds); super admins edit the catalogue.
  Each has a monthly message quota (GROWTH unlimited), contact/member/API-key
  limits, per-category overage rates and feature flags (`campaignAi`, …).
- **Subscriptions** are bought through Razorpay checkout (monthly, or
  quarterly where the plan has a quarterly price). The daily billing sweep
  renews them from the wallet, applies scheduled downgrades and
  cancel-at-period-end, and moves a failed renewal to `PAST_DUE`, which keeps
  working for a 3-day grace period. `CANCELLED`/`EXPIRED` blocks the workspace
  apart from the billing screens.
- **Usage**: each send consumes plan quota first, then debits the wallet at the
  plan's per-category rate. Campaigns reserve quota and wallet at launch and
  settle at the end, refunding what was not sent. On unlimited plans campaigns
  cost nothing from the wallet.
- **Wallet**: `Workspace.walletBalance` changes only inside a transaction that
  locks the workspace row and writes a `WalletTransaction` with a unique
  idempotency key (payment id, campaign id), so replays and retries cannot
  double-credit or double-charge, and a debit never takes the balance below
  zero. Top-ups go through Razorpay; the order amount is read back from
  Razorpay, never from the client.
- **Razorpay webhook** `POST /api/v1/webhook/razorpay` (`payment.captured`,
  `order.paid`, HMAC with `RAZORPAY_WEBHOOK_SECRET`) applies payments whose
  browser checkout never reached the verify call; `GatewayPayment` guarantees
  each payment is applied once whichever path arrives first.
- **Demo recharge** (`POST /wallet/recharge`) credits without payment and only
  works when `ALLOW_DEMO_RECHARGE=true` and `NODE_ENV` is not production.
- Invoices (INR, decimal amounts) and a billing profile are kept per
  workspace. Add-ons are 30-day packs bought separately; buying one again
  extends it (they do not stack or auto-renew).

The original design spec, still cited in code comments as "README §12.x", is
kept in [docs/archive/BILLING_SPEC.md](docs/archive/BILLING_SPEC.md).

---

## 9. Security notes

- Secrets at rest (WhatsApp tokens, integration credentials) use AES-256-GCM
  (`lib/encryption.js`); legacy CBC values are still readable. Rotate with
  `ENCRYPTION_KEYS_PREVIOUS` + `scripts/reencrypt-secrets.js --apply`.
- Refresh tokens are stored as hashes, rotate on every use, and reuse of a
  rotated token revokes the whole family; logout and "sign out other sessions"
  revoke families, and revoked access tokens are denylisted. Disabled users
  cannot refresh.
- Meta, Instagram, Twilio and Razorpay webhooks are signature-verified over
  the raw body; the Meta verify challenge is echoed as `text/plain`.
- Outbound requests to user-supplied URLs (outgoing webhooks, website
  crawling and knowledge import, template image URLs) go through `lib/safeUrl.js` (private-address and redirect
  checks with DNS pinning).
- Uploads are size- and type-checked (`lib/uploadGuard.js`, multer 2); large
  files go to disk, DOCX files are checked for zip bombs.
- CORS is an allow-list (`CLIENT_URL` + `CORS_EXTRA_ORIGINS`). Rate limits are
  Redis-backed with an in-memory fallback and key on the client IP derived via
  `TRUST_PROXY_HOPS`.
- Google sign-in uses a signed `state` plus a nonce cookie; tokens reach the SPA
  through a one-time code (`POST /auth/exchange`), never the URL.
- `.env` files are git-ignored except `backend/.env.example`. Rotate any
  credential that was ever committed to history.

---

## 10. Testing

| Command | Scope |
| --- | --- |
| `cd backend && npm test` | Backend unit tests (`src/**/*.test.js`, node:test). Uses `backend/.env.test` when present and refuses to run against a non-local database; DB-backed suites skip when no local DB is reachable |
| `cd backend && npm run test:otp` / `test:prisma-schema` | OTP scope suite; schema canonical-form check |
| `cd frontend && npm test` | Frontend unit tests (`src/**/*.test.mjs`) |
| `cd frontend && npx vite build` | Build check |
| `node --env-file=backend/.env tests-e2e.mjs` (and `-v2`, `-v3`) | Scripted API end-to-end suites. Each starts the app in-process on port 4000 against the **local** Postgres + Redis in `backend/.env`, and refuses to run if any database URL is not local. Accounts are created through `/auth/register/start` + `/register/verify`, with the OTP read from the local database by `backend/scripts/signup-helper.mjs`. v2 also needs `ALLOW_DEMO_RECHARGE=true` |
| `npx playwright test` | Smoke specs in `tests/`; base URL `E2E_BASE_URL`, default `http://localhost:5173` |

`backend/scripts/*-check.mjs` are scenario scripts against a running local
server; the Meta-facing ones send real WhatsApp messages and cost money.

---

## 11. Known gaps

The audit's open items and the remediation outcome per issue are in
[`audit/REMEDIATION_STATUS.md`](audit/REMEDIATION_STATUS.md). Notable
remaining gaps at the time of writing:

- Real-time updates are polling, not push (inbox, campaigns, templates).
- Uploaded files are on local disk and do not survive a Render redeploy.
- DLT template enforcement for SMS fallback, PKCE for the OAuth server, and
  add-on stacking/auto-renew are not implemented.
- The frontend hides screens by role in the sidebar; the server is the
  enforcement point.

---

## 12. Licence

No project licence has been chosen yet: there is no LICENSE file, and
`package.json` still carries npm's default `ISC` value. Third-party notices
are in [ATTRIBUTION.md](ATTRIBUTION.md).
