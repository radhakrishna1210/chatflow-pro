# ChatFlow Pro

A full-stack, multi-tenant WhatsApp Business messaging platform — conversations (inbox), bulk campaigns, contacts/segments, message templates, automation workflows, analytics, a wallet/billing ledger, and platform-level super-admin tools. Built with Node.js/Express on the backend and React (Vite, no router library — custom history-based router) on the frontend, backed by PostgreSQL, Redis/BullMQ, and the Meta WhatsApp Business (Cloud API) platform.

This document is meant to be a complete standalone reference for anyone (human or AI agent) picking up the project cold — architecture, data model, environment, conventions, and known gaps.

---

## 1. Tech Stack

| Layer | Technology |
|---|---|
| Backend runtime | Node.js 20+, ES Modules (`"type": "module"`) |
| Backend framework | Express 5 |
| ORM / DB | Prisma ORM → PostgreSQL (via `@prisma/adapter-pg` driver adapter) |
| Queues / background jobs | BullMQ + Redis (`ioredis`) — campaign sending queue, transactional email queue |
| Auth | JWT (access + refresh tokens), `bcryptjs` password hashing, Passport.js + Google OAuth 2.0, email-OTP signup verification |
| Validation | Zod (request body/param/query schemas) |
| WhatsApp messaging | Meta Graph API (WhatsApp Business Cloud API) via `axios`; also `twilio` dependency present |
| AI | `@google/genai` (Gemini) with an Ollama (local LLM) fallback, used for AI-assisted onboarding, template copy, and workflow generation |
| Email | `nodemailer` (SMTP) via a BullMQ-backed email worker |
| Frontend | React 18, Vite 5, `recharts` for charts — no CSS framework, all inline styles / a single `index.css` |
| Frontend routing | Hand-rolled history-based router in `frontend/src/App.jsx` (no react-router) |

---

## 2. Repository Layout

```
chatflow-pro/
├── backend/                       Express API + BullMQ workers
│   ├── src/
│   │   ├── app.js                 Express app: middleware, CORS, Passport, route mounting, error handler
│   │   ├── server.js              Entry point: connects DB/Redis, starts workers, starts HTTP server, graceful shutdown
│   │   ├── config/env.js          Zod-validated environment variables (single source of truth for config)
│   │   ├── routes/                Express routers, one per resource (see §5)
│   │   ├── controllers/           Thin request/response handlers — call into services
│   │   ├── services/              Business logic, Prisma queries (no Express dependencies)
│   │   ├── middleware/            authenticate, authorize (RBAC), workspaceContext, rateLimit, errorHandler
│   │   ├── validators/index.js    All Zod schemas, grouped by resource (authSchemas, campaignSchemas, ...)
│   │   ├── lib/                   Singletons & low-level helpers: prisma.js, redis.js, meta.js (Graph API), encryption.js (AES-256), llm.js (Gemini/Ollama), mailer.js
│   │   ├── queues/                BullMQ queue definitions (campaign.queue.js, email.queue.js)
│   │   ├── workers/                BullMQ worker processes (campaign.worker.js sends messages, email.worker.js sends email)
│   │   └── data/templateLibrary.js Prebuilt WhatsApp message template library (30+ templates) used by AI onboarding / template picker
│   ├── prisma/schema.prisma       Full data model (see §6)
│   ├── scripts/                   One-off maintenance scripts (create-test-user.js, reset-numbers.js)
│   ├── docs/local-redis-setup.md  How to run Redis locally on Windows via WSL
│   ├── .env / .env.test           Local environment files (gitignored — see §7)
│   └── README.md                  Backend-specific quick start (subset of this file)
├── frontend/                      React + Vite SPA
│   └── src/
│       ├── App.jsx                Router + auth/workspace route guards
│       ├── main.jsx                Vite entry point
│       ├── lib/api.js             `wFetch`/`adminFetch`/`apiFetch` — authenticated fetch wrapper w/ token refresh
│       ├── pages/                 One file per screen (Login, Register, WorkspaceSetup, Dashboard, InboxView, CreateCampaign, ContactsView, AutomationView, AnalyticsView, SettingsView, ApiKeysView, IntegrationsView, PaymentsView, SupportView, SuperAdminView, UserAnalyticsView, NumberSetupView, AuthCallback, Landing, ...)
│       └── components/            Shared UI: Btn, Icons, AIOnboardingCard, dashboard/ChatAnalytics
├── screenshots/                   App screenshots for docs/marketing
├── tests-e2e.mjs                  End-to-end test suite (v1) — hits a live running backend + Postgres
├── tests-e2e-v2.mjs               End-to-end test suite (v2, newer features)
├── BUGS.md / BUGS-v2.md           Historical bug audits from prior stabilization sprints
├── STABILIZATION_REPORT.md / _V2.md  Write-ups of what was fixed in each stabilization pass
└── ChatFlow Pro.html              Standalone static demo/landing page (not part of the app build)
```

---

## 3. Getting Started

### Prerequisites
- Node.js 20+
- PostgreSQL 14+
- Redis 6+ (see `backend/docs/local-redis-setup.md` for a WSL-based local setup on Windows)
- A Meta developer app with WhatsApp Business Cloud API access (for real message sending — the app will still boot and most non-WhatsApp features work without valid Meta credentials, but `env.js` requires the variables to be *present*, see §7)
- A Google Cloud OAuth 2.0 client (for "Sign in with Google")

### Backend
```bash
cd backend
npm install --legacy-peer-deps
cp .env.example .env          # there is no .env.example checked in — copy backend/.env.test as a starting template, or create one from §7
npm run db:generate           # generate the Prisma client
npm run db:migrate            # run/create migrations against DATABASE_URL
npm run dev                   # node --watch, http://localhost:4000
```

Other backend scripts:
```bash
npm start                     # production start (no watch)
npm run db:push               # push schema without generating a migration file
npm run db:studio             # Prisma Studio GUI
node scripts/create-test-user.js   # upserts test@example.com / password123 with a workspace
node scripts/reset-numbers.js      # wipes WaNumber rows and frees the NumberPool (dev utility)
```

### Frontend
```bash
cd frontend
npm install
npm run dev        # Vite dev server, http://localhost:5173 (proxies /api to the backend — check vite.config)
npm run build       # production build → frontend/dist
npm run preview     # preview the production build locally
```

### Running both together
Backend defaults to port `4000`, frontend dev server to `5173`. The frontend calls relative paths like `/api/v1/...`; `frontend/vite.config.js` proxies `/api` to `http://localhost:4000` in dev. In production the frontend is expected to be served from the same origin as the API, or `CLIENT_URL`/`CORS_EXTRA_ORIGINS` must be configured for cross-origin requests.

---

## 4. Environment Variables

Defined and validated in `backend/src/config/env.js` (Zod schema — the app **will not boot** if a required variable is missing/invalid). No `.env.example` is currently checked into the repo; use this table as the source of truth. **Never commit real values** — `.env` files are gitignored.

| Variable | Required | Default | Notes |
|---|---|---|---|
| `PORT` | no | `4000` | HTTP port |
| `NODE_ENV` | no | `development` | `development` \| `production` \| `test` |
| `CLIENT_URL` | no | `http://localhost:5173` | Frontend origin — used for CORS allow-list and OAuth redirects |
| `CORS_EXTRA_ORIGINS` | no | — | Comma-separated extra allowed origins (e.g. a preview deploy) |
| `JSON_BODY_LIMIT` | no | `2mb` | Express body size limit |
| `DATABASE_URL` | **yes** | — | Postgres connection string (pooled, used at runtime) |
| `DIRECT_URL` | no | falls back to `DATABASE_URL` | Non-pooled connection for Prisma migrations |
| `REDIS_URL` | no | `redis://localhost:6379` | BullMQ + ioredis connection |
| `JWT_ACCESS_SECRET` | **yes** (min 32 chars) | — | Signs short-lived access tokens |
| `JWT_REFRESH_SECRET` | **yes** (min 32 chars) | — | Signs long-lived refresh tokens |
| `JWT_EXPIRES_IN` | no | `15m` | Access token TTL |
| `JWT_REFRESH_EXPIRES_IN` | no | `7d` | Refresh token TTL |
| `ADMIN_EMAIL` | **yes** | — | The single email treated as the **platform super admin** (`superAdmin: true` on JWT, unlocks `/admin/platform/*`) — not a workspace role |
| `BCRYPT_SALT_ROUNDS` | no | `12` | |
| `ENCRYPTION_KEY` | **yes** (min 32 chars, 32 ASCII or 64 hex) | — | AES-256-CBC key used to encrypt WhatsApp access tokens & integration credentials at rest. Generate with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `META_APP_ID` | **yes** | — | Meta developer app ID |
| `META_APP_SECRET` | **yes** | — | Used for webhook HMAC signature verification and OAuth code exchange |
| `META_BUSINESS_ID` | **yes** | — | |
| `META_WABA_ID` | **yes** | — | Default/platform WhatsApp Business Account ID |
| `META_SYSTEM_USER_ID` | **yes** | — | |
| `META_SYSTEM_USER_TOKEN` | **yes** | — | Long-lived system-user token for platform-level Graph API calls |
| `META_DISPLAY_NAME` | **yes** | — | |
| `META_WEBHOOK_VERIFY_TOKEN` | **yes** | — | Token Meta must echo back to verify the webhook subscription (`GET /webhook/meta`) |
| `META_API_VERSION` | no | `v21.0` | Graph API version pinned across `lib/meta.js` |
| `META_REDIRECT_URI` | no | `{APP_URL}/api/v1/auth/meta/callback` | Must exactly match the redirect URI configured in the Meta dashboard for Embedded Signup |
| `META_ES_CONFIG_ID` | referenced by frontend/backend for Embedded Signup | — | Facebook Login for Business config ID (see STABILIZATION_REPORT_V2.md) |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` | no | — | Present as a dependency; optional/partial integration |
| `CAMPAIGN_BATCH_SIZE` | no | `50` | |
| `CAMPAIGN_WORKER_CONCURRENCY` | no | `2` | BullMQ worker concurrency for campaign sends |
| `CAMPAIGN_RATE_DELAY_MS` | no | `250` (floor enforced in code) | Delay between sends — Meta Tier-1 numbers allow ~250 msgs/min, so 250ms ≈ 240/min |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | **yes** | — | Google OAuth 2.0 ("Sign in with Google") |
| `GOOGLE_CALLBACK_URL` | no | `{APP_URL}/api/v1/auth/google/callback` | |
| `GEMINI_API_KEY` | no | — | Enables Gemini for AI onboarding / workflow generation; falls back to Ollama, then a deterministic canned-response generator if absent |
| `OLLAMA_URL` | no | `http://127.0.0.1:11434` | Local LLM fallback |
| `OLLAMA_MODEL` | no | `phi3` | |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASSWORD` | no | `SMTP_PORT=587`, `SMTP_SECURE=false` | Transactional email (welcome, OTP, invites, campaign-complete, etc.) — email sending is skipped gracefully if unconfigured |
| `EMAIL_FROM_NAME` | no | `ChatFlow Pro` | |
| `EMAIL_FROM` | no | — | |
| `APP_URL` | no | `http://localhost:{PORT}` | Backend's own public URL, used to derive default OAuth/webhook callback URLs |

---

## 5. API Surface

All routes are mounted under `/api/v1` (see `backend/src/app.js` + `backend/src/routes/index.js`). Workspace-scoped resources live under `/api/v1/workspaces/:workspaceId/*` and are protected by `authenticate` (JWT) + `workspaceContext` (verifies membership, attaches `req.user.role` for that workspace, blocks suspended workspaces) + `authorize('ADMIN')` on write/admin-only endpoints.

| Prefix | Router file | Purpose |
|---|---|---|
| `GET /health` | `routes/index.js` | Liveness check |
| `/auth` | `auth.routes.js` | Register (legacy single-step), OTP-verified register (`/register/start`, `/register/verify`, `/register/resend`), login, refresh, logout, Google OAuth (`/google`, `/google/callback`), one-time-code session exchange (`/exchange`), Meta account-connect OAuth handshake |
| `/webhook` | `webhook.routes.js` | Meta webhook verification (`GET`) + inbound event receiver (`POST`) — signature-verified with `META_APP_SECRET` |
| `/admin` | `admin.routes.js` | Platform-level (super-admin only): number pool assignment, workspace list/suspend, platform-wide stats |
| `/workspaces` | `workspaces.routes.js` | `POST /workspaces` — the **only** way a user becomes a workspace `ADMIN`: explicitly creating a workspace. Invited users join as `CLIENT`. |
| `/workspaces/:workspaceId/whatsapp` | `whatsapp.routes.js` | Number connection (own-number OAuth + Embedded Signup), message sending, subscription status |
| `/workspaces/:workspaceId/templates` | `templates.routes.js` | WhatsApp message template CRUD, Meta sync, install-from-library |
| `/workspaces/:workspaceId/campaigns` | `campaigns.routes.js` | Campaign CRUD, add recipients, launch/cancel, reply-flow/retry/tracking config |
| `/workspaces/:workspaceId/contacts` | `contacts.routes.js` | Contact CRUD + CSV import |
| `/workspaces/:workspaceId/conversations` | `conversations.routes.js` | Inbox: list/read conversations, send/receive messages |
| `/workspaces/:workspaceId/analytics` | `analytics.routes.js` | Workspace messaging/campaign analytics |
| `/workspaces/:workspaceId/automation` | `automation.routes.js` | Keyword-triggered `AutomationTrigger` rules |
| `/workspaces/:workspaceId/workflows` | `workflow.routes.js` | Visual workflow builder (`Workflow.nodes`/`edges` JSON), AI-assisted generation, simulation |
| `/workspaces/:workspaceId/settings` | `settings.routes.js` | Workspace settings, notification toggles, webhook config |
| `/workspaces/:workspaceId/members` | `members.routes.js` | Invite/list/update-role/remove workspace members (ADMIN-only writes) |
| `/workspaces/:workspaceId/api-keys` | `apikeys.routes.js` | Programmatic API key issuance/revocation |
| `/workspaces/:workspaceId/segments` | `segments.routes.js` | Contact segments (tag-like groupings used for targeted campaigns) |
| `/workspaces/:workspaceId/whatsapp-forms` | `whatsappForms.routes.js` | WhatsApp Flow-style forms (CRUD scaffolding) |
| `/workspaces/:workspaceId/wallet` | `wallet.routes.js` | Server-authoritative wallet ledger: balance + recharge (ADMIN-only, demo/no live payment gateway) |
| `/workspaces/:workspaceId/integrations` | `integrations.routes.js` | Third-party integration connections (credentials encrypted at rest) |
| `/workspaces/:workspaceId/support` | `support.routes.js` | Submit support tickets (surfaced to super admins) |
| `/onboarding` | `onboarding.routes.js` | AI onboarding chat assistant (guided template/campaign/workflow creation) |
| `/ai` | `ai.routes.js` | Misc AI-assisted endpoints |

**Auth model**: JWT access token carries `{ sub: userId, workspaceId, role, superAdmin }`. `role` and `workspaceId` can be `null` for a signed-up user who hasn't created/joined a workspace yet (see `frontend/src/pages/WorkspaceSetup.jsx` — such users are routed to `/setup`). `workspaceContext` middleware re-derives the effective role per-request from the `WorkspaceMember` row for the `:workspaceId` in the URL, so a stale JWT role never grants access to a different workspace. `superAdmin` is computed by comparing the user's email to `ADMIN_EMAIL` — it is a platform-level flag, orthogonal to any workspace's `Role`.

---

## 6. Data Model (PostgreSQL via Prisma)

Full schema: `backend/prisma/schema.prisma`. Key models and relationships:

- **User** — global account (email/password or Google). Has many `WorkspaceMember` rows (i.e. can belong to multiple workspaces) and `RefreshToken`s.
- **Workspace** — the tenant boundary. Everything else (contacts, campaigns, templates, numbers, wallet, integrations, tickets...) is scoped to a `workspaceId`. Also holds notification toggles, wallet balance, suspension state, and Voice-AI settings.
- **WorkspaceMember** — join table `User` ↔ `Workspace` with a `role: Role` (`ADMIN` | `CLIENT`). Composite PK `(userId, workspaceId)`. **A user's workspace `role` only exists here** — it is not a global attribute of `User`.
- **WaNumber** — a connected WhatsApp phone number (Meta Cloud API), holding an AES-256-encrypted access token, quality/status, and `appSubscribed` (whether the app is subscribed to webhooks for this number's WABA — critical, see below).
- **NumberPool** — platform-owned pool of numbers that can be assigned to workspaces (admin-managed onboarding path, alternative to a customer connecting their own number via Embedded Signup).
- **Template** — a WhatsApp message template (`components` JSON matching Meta's template component schema), optionally scoped to a specific `WaNumber`, with approval `status`.
- **Contact** — a workspace's WhatsApp contact (unique per `(workspaceId, phoneNumber)`), can belong to many `Segment`s.
- **Campaign** — a bulk-send job against a `Template` + `WaNumber`, with `replyRules`/`retryConfig`/`trackingConfig` JSON columns and rollup counters (`sent`/`delivered`/`read`/`failed`).
- **CampaignRecipient** — join row per `(campaignId, contactId)` tracking per-recipient delivery status; linked `Message`s let delivery/read webhooks update the right row.
- **Conversation** / **Message** — the inbox: one `Conversation` per `(contactId, waNumberId)`, `Message.direction` is `INBOUND`/`OUTBOUND`, indexed on `metaMessageId` for webhook correlation.
- **AutomationTrigger** — simple keyword → response-template auto-reply rules.
- **Workflow** — visual automation builder state (`nodes`/`edges` JSON), can be AI-generated.
- **ApiKey** — hashed programmatic API keys per workspace.
- **WalletTransaction** — append-only ledger (`CREDIT`/`DEBIT`) backing `Workspace.walletBalance`; balance only ever changes inside a server-side transaction.
- **WorkspaceIntegration** — third-party integration connections (`apikey`/`oauth`/`webhook` type), credentials encrypted at rest, one row per `(workspaceId, provider)`.
- **EmailOtp** — signup email-verification codes: hashed code + attempt counter + expiry; also stashes the pending `name`/`passwordHash` so the real `User` is only created after successful verification.
- **SupportTicket** — workspace support requests, visible to super admins.
- **Segment** — named contact groupings (many-to-many with `Contact`).
- **AiSession** — persisted state for the AI onboarding chat assistant's multi-turn flow.
- **RefreshToken** — persisted, single-use, revocable JWT refresh tokens.

Enums: `Role` (ADMIN/CLIENT), `NumberPoolStatus`, `TemplateStatus`, `CampaignStatus`, `CampaignRecipientStatus`, `ConversationStatus`, `MessageDirection`.

---

## 7. Background Jobs (BullMQ)

- **`campaigns` queue / `campaign.worker.js`** — processes one campaign at a time per job: claims the campaign (atomic status guard against concurrent cancellation), iterates `PENDING` `CampaignRecipient`s, sends each via the Meta Graph API with a rate-limit delay (`CAMPAIGN_RATE_DELAY_MS`, floor 250ms), fills in template variable parameters (currently: the contact's name for every `{{n}}` placeholder — there's no per-recipient custom-field data source), records `Message` rows, updates recipient/campaign status, and emails a completion/failure notice. Recovers `SCHEDULED` campaigns on server restart (`recoverScheduledCampaigns`) in case queued jobs were lost.
- **`email` queue / `email.worker.js`** — sends transactional email (welcome, signup OTP, member invites, campaign completed/failed, template approved/rejected) via `nodemailer`/SMTP. Silently no-ops if SMTP isn't configured (dev-friendly).

Both workers are started from `server.js` alongside the HTTP server and are shut down gracefully on `SIGTERM`/`SIGINT` (in-flight jobs finish before the process exits).

---

## 8. Frontend Notes

- **Routing**: `App.jsx` implements a minimal history-API router (no react-router). Route guards: unauthenticated users are bounced to `/login`; authenticated users without a workspace are bounced to `/setup` (`WorkspaceSetup.jsx`) until they create one (which grants them `ADMIN`) or are invited to one by an existing admin.
- **Auth/session storage**: `accessToken`, `refreshToken`, and a `user` JSON blob (id/name/email/role/superAdmin/workspaceId/workspaceName) live in `localStorage`.
- **API calls**: `frontend/src/lib/api.js` exports `wFetch` (prefixes `/api/v1/workspaces/:workspaceId`, reads the workspace from stored `user`), `adminFetch` (prefixes `/api/v1/admin`), and `apiFetch` (raw authenticated fetch). All three attach the bearer token and transparently retry once after a silent token refresh on a 401.
- **Pages** map roughly 1:1 to the API resources above (Dashboard is the shell/layout; individual `*View.jsx` files are the tab contents).

---

## 9. Security Notes

- WhatsApp access tokens and integration credentials are encrypted at rest with AES-256-CBC (`lib/encryption.js`, key from `ENCRYPTION_KEY`) — never stored or returned in plaintext.
- Meta webhook payloads are verified via HMAC signature using `META_APP_SECRET`.
- CORS is a strict allow-list (`CLIENT_URL` + `CORS_EXTRA_ORIGINS`) — never a wildcard.
- Passwords hashed with `bcryptjs` (`BCRYPT_SALT_ROUNDS`, default 12).
- Refresh tokens are persisted server-side, single-use (rotated on refresh), and revocable (logout deletes the row).
- Signup requires email OTP verification (6-digit code, 10-minute expiry, 5-attempt limit, 60s resend cooldown) before a `User` row is created.
- Google OAuth uses a signed, timing-safe-compared `state` parameter for CSRF protection, and hands tokens to the SPA via a short-lived one-time Redis-backed code (never in the redirect URL) — see `POST /auth/exchange`.
- Rate limiting (`middleware/rateLimit.js`) is applied to login/register/refresh endpoints.
- `.env` files are gitignored; **rotate any credentials that were ever committed to history**.

---

## 10. Testing

- `tests-e2e.mjs` and `tests-e2e-v2.mjs` are Node scripts (not a test framework — plain `fetch` + assertions) that exercise the running API end-to-end against a live Postgres + Redis + BullMQ stack. Run the backend first, then:
  ```bash
  node tests-e2e.mjs
  node tests-e2e-v2.mjs
  ```
- These tests create real rows (users, workspaces, campaigns, etc.) — point them at a disposable/dev database, not production.
- No frontend automated test suite currently exists; UI changes should be manually verified in the browser (see any project-specific `/verify` or `/run` tooling if using Claude Code).

---

## 11. Known Gaps / Honesty Notes

(See `BUGS.md`, `BUGS-v2.md`, `STABILIZATION_REPORT.md`, `STABILIZATION_REPORT_V2.md` for the full history.) As of the latest stabilization pass:
- Campaign wizard "fallback channels" step is explicitly unbuilt ("Coming Soon").
- AI Intent Matching and WhatsApp AI Agent automation tabs are explicitly unbuilt ("Coming Soon"), not faked.
- Wallet recharge is a **demo** flow — server-authoritative ledger, but no live payment gateway integration.
- Voice AI (inbound calls) settings persist but there is no telephony engine behind them.
- WhatsApp Forms have CRUD but no real form-rendering/submission backend yet.
- Instagram integration is a stub (OAuth redirect only, no token exchange or persisted connection).
- Twilio dependency is present but not fully wired into the primary WhatsApp send path (Meta Cloud API is primary).

When picking up work here, treat anything marked "Coming Soon" in the UI as intentionally unbuilt rather than broken, and check the two STABILIZATION_REPORT files before assuming a feature is fake — most surface-level issues from the original audits have already been fixed end-to-end.

---

## 12. Planned Feature Spec: Subscription Plans + Wallet Quota Model

**Status: not yet implemented — this section is the implementation spec**, written against the current codebase so an external engineer/agent can build it without further discovery. It describes the target behavior, the current state it replaces, the data model changes, and where in the existing code each piece of enforcement plugs in.

### 12.1 Current state (what exists today)

- `Workspace.plan` (`schema.prisma`) is a free-text `String` defaulting to `"FREE"`. It is **stored and displayed** (`admin.service.js#listWorkspacesDetailed`) but **never enforced anywhere** — there is no plan catalog, no limits, and no code path that reads `plan` to gate behavior.
- `Workspace.plan` cannot be changed via any existing API — `settings.service.js`'s `ALLOWED_SETTINGS_FIELDS` allow-list explicitly excludes it ("prevents mass-assignment of sensitive columns (plan, webhookVerifyToken, etc.)").
- `Workspace.walletBalance` + `WalletTransaction` (`wallet.service.js`) is a working, server-authoritative ledger: `credit()` and `debit()` both run inside a Prisma transaction and append an immutable ledger row. `POST /workspaces/:id/wallet/recharge` is ADMIN-only and explicitly documented as a **demo** top-up (no live payment gateway — see §11).
- Nothing today consumes the wallet or any quota when a message is sent, a campaign is launched, a contact is created, or a member is invited — all of those are currently unlimited regardless of `plan` or `walletBalance`.
- Role model is per-workspace only: `WorkspaceMember.role` is `ADMIN` or `CLIENT` (`authorize()` in `middleware/authorize.js`, hierarchical: ADMIN ⊇ CLIENT). There is also a platform-level `superAdmin` flag (single `ADMIN_EMAIL`), orthogonal to workspace roles.

### 12.2 Target model

**Two-layer usage model, workspace-scoped (not per-member):**

1. **Subscription quota** — each workspace subscribes to a `Plan`. The plan grants a fixed **included message quota** per billing cycle (plus optional hard caps on contacts/team members/campaigns/API keys/features). Usage against the plan is free (already paid for via the subscription).
2. **Wallet overflow** — once the cycle's included quota is exhausted, further WhatsApp sends are **not blocked outright**; instead each send is debited from `Workspace.walletBalance` at a per-message rate (pay-as-you-go). If the wallet is also insufficient, the send is rejected with a clear "quota + wallet exhausted" error and the workspace is prompted to recharge or upgrade.

This mirrors how the wallet already works today (server-authoritative ledger) — the new work is (a) a plan catalog + subscription record, (b) a quota counter that resets per cycle, and (c) wiring the existing `wallet.service.js#debit` into the send path as the overflow mechanism, instead of leaving usage completely unmetered.

**Role-based rules:**

| Action | ADMIN | CLIENT (member) |
|---|---|---|
| View workspace's plan, quota usage, wallet balance/ledger | ✅ | ✅ (read-only) |
| Change/upgrade/downgrade the workspace's subscription plan | ✅ | ❌ |
| Recharge the wallet | ✅ | ❌ (same restriction pattern already used for `POST /wallet/recharge`) |
| Send messages / launch campaigns that consume quota or wallet | ✅ | ✅ — **usage always debits the workspace's shared quota/wallet**, regardless of which member triggered it. There is no per-member sub-quota; the workspace is the billing unit. |
| Invite a member beyond the plan's included seat limit | ✅, but blocked by plan limit until upgrade | n/a (members can't invite) |

Platform **super admin** (`ADMIN_EMAIL`) can additionally: define/edit the plan catalog, override a workspace's plan or quota manually (e.g. comped account), and view cross-workspace usage — extending the existing `/admin/platform/*` surface (`admin.routes.js`, `requireSuperAdmin`).

### 12.3 Data model changes (Prisma)

```prisma
model Plan {
  id                String       @id @default(cuid())
  key               String       @unique   // "FREE" | "STARTER" | "PRO" | "ENTERPRISE" | ...
  name              String
  priceMonthly      Decimal      @db.Decimal(10, 2)
  currency          String       @default("USD")
  messageQuota      Int          // included messages per billing cycle; 0 = none, -1 = unlimited
  contactLimit      Int?         // null = unlimited
  memberLimit       Int?
  campaignLimit     Int?         // concurrent/active campaigns, or per-cycle sends — define precisely before build
  apiKeyLimit       Int?
  overageRatePerMsg Decimal      @db.Decimal(10, 4) // wallet debit per message once quota is exhausted
  features          Json         @default("{}")     // feature flags: { automation: true, workflows: true, aiOnboarding: true, integrations: true, ... }
  isActive          Boolean      @default(true)
  createdAt         DateTime     @default(now())
  subscriptions     Subscription[]
}

model Subscription {
  id                String    @id @default(cuid())
  workspaceId       String    @unique   // one active subscription per workspace
  planId            String
  status            String    @default("ACTIVE") // ACTIVE | PAST_DUE | CANCELLED | EXPIRED
  currentPeriodStart DateTime @default(now())
  currentPeriodEnd   DateTime
  cancelAtPeriodEnd  Boolean  @default(false)
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt
  workspace           Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  plan                Plan      @relation(fields: [planId], references: [id])
}

model UsageCounter {
  id              String   @id @default(cuid())
  workspaceId     String
  periodStart     DateTime // matches Subscription.currentPeriodStart for the active cycle
  periodEnd       DateTime
  messagesUsed    Int      @default(0) // count against the plan's included messageQuota
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  workspace       Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@unique([workspaceId, periodStart])
}
```

- `Workspace.plan` (the current free-text column) should be **deprecated and migrated** to `Subscription.planId` — keep the old column briefly for backfill, then drop it once `Subscription` rows exist for every workspace (a migration script, not a live dual-write).
- Every existing workspace needs a bootstrapped `Subscription` row (e.g. `FREE` plan, `currentPeriodEnd` = +30 days) as part of the migration, so enforcement code never has to special-case "no subscription".

### 12.4 Enforcement points in existing code

Quota/wallet checks must be added at the point of **consumption**, not just at display time. Based on the current codebase:

| Consumption event | Where it happens today | What to add |
|---|---|---|
| Campaign message send (bulk) | `workers/campaign.worker.js` — the `for (const recipient of recipients)` loop, right before `sendWhatsAppMessage(...)` | Before each send: increment/check `UsageCounter.messagesUsed` against `Plan.messageQuota`; once exceeded, call `wallet.service.js#debit(workspaceId, plan.overageRatePerMsg, { reason: 'Campaign overage' })`. If `debit` returns `{ ok: false }`, mark that recipient `FAILED` with a `failReason` of `"Quota and wallet balance exhausted"` and continue to the next recipient (don't abort the whole campaign — matches the existing per-recipient try/catch pattern already in this file). |
| Single/manual message send | `services/whatsapp.service.js` (conversation reply / test send) | Same quota→wallet check before calling the Meta send helper. |
| Campaign launch (pre-flight) | `services/campaigns.service.js` (launch endpoint) | Optional pre-flight estimate: if `recipients.length` exceeds the *remaining* quota + max affordable wallet overage, warn (not necessarily block) the admin before launch, so a campaign doesn't silently fail mid-run for most of its recipients. |
| Contact creation | `services/contacts.service.js` (create + CSV import) | If `plan.contactLimit` is set, reject creation past the limit with 403 + a clear "upgrade your plan" error. |
| Member invite | `services/members.service.js#inviteMember` | If `plan.memberLimit` is set, count existing `WorkspaceMember` rows and reject past the limit. |
| API key creation | `services/apikeys.service.js` | Same pattern, against `plan.apiKeyLimit`. |
| Feature-gated tabs (Workflows, AI onboarding, Integrations, ...) | Various `services/*` + corresponding frontend views | Check `plan.features.<flag>` — mirror the existing "Coming Soon" pattern already used in the UI (§11) for plan-gated-but-technically-built features, so a downgraded workspace sees a clear upsell state rather than a broken one. |
| Workspace suspension | `middleware/workspaceContext.js` already blocks all access when `Workspace.suspended` | Reuse this exact mechanism for a **CANCELLED/EXPIRED** subscription — don't invent a second suspension flag. Either flip `suspended: true` with a subscription-specific `suspendedReason`, or extend `workspaceContext` to also check `Subscription.status`. |

### 12.5 New/changed API surface

| Endpoint | Method | Role | Purpose |
|---|---|---|---|
| `/workspaces/:workspaceId/subscription` | `GET` | ADMIN, CLIENT (read) | Current plan, cycle dates, quota used/remaining, wallet balance — a single dashboard-ready summary |
| `/workspaces/:workspaceId/subscription` | `PATCH` | ADMIN only | Change plan (upgrade/downgrade) — validate against current usage (e.g. block downgrade below current member count) |
| `/workspaces/:workspaceId/wallet` | `GET` | existing | No change — already returns balance + ledger |
| `/workspaces/:workspaceId/wallet/recharge` | `POST` | existing, ADMIN only | No change to the endpoint; the *source* of debits against this balance expands from "manual admin action" to "automatic overage debits from the worker/services above" |
| `/admin/platform/plans` | `GET`/`POST`/`PATCH` | super admin only | CRUD for the `Plan` catalog (extends the existing `/admin/platform/*` surface in `admin.routes.js`) |
| `/admin/platform/workspaces/:id/subscription` | `PATCH` | super admin only | Manual override (comp a plan, extend a cycle) — extends `setWorkspaceSuspended`-style admin tooling in `admin.service.js` |

### 12.6 Billing-cycle reset

A new **repeatable BullMQ job** (alongside the existing `campaigns`/`email` queues in `queues/` + a worker in `workers/`) should run daily, find `Subscription` rows where `currentPeriodEnd <= now()`:
- Roll `currentPeriodStart`/`currentPeriodEnd` forward by one cycle and create a fresh `UsageCounter` row (quota resets — wallet balance does **not** reset, it's separate money).
- If `cancelAtPeriodEnd` is true, transition `status` to `CANCELLED` instead of renewing, and set `Workspace.suspended` per §12.4.
- This mirrors the existing `recoverScheduledCampaigns()` startup-recovery pattern in `server.js` for resilience against missed runs (a job that didn't fire while the server was down should still catch up on next boot, not wait for the next scheduled tick).

### 12.7 Frontend changes

- `SettingsView.jsx` (or a new `BillingView.jsx`) — plan display, usage bar (messages used / quota), upgrade/downgrade UI (ADMIN-only, matching the existing `isAdmin` gating already used in `Dashboard.jsx`).
- `PaymentsView.jsx` (wallet UI already exists) — add a "quota exhausted, now billing from wallet" indicator once `UsageCounter.messagesUsed >= Plan.messageQuota`, and a low-balance warning tied to `Workspace.notifyRateLimit`-style notification toggles already on the `Workspace` model.
- `SuperAdminView.jsx` — plan catalog management + per-workspace subscription override, alongside the existing suspend/reinstate controls.

### 12.8 Explicit non-goals for this pass

- No live payment gateway integration (Stripe/Razorpay/etc.) — wallet recharge stays the existing demo/manual flow described in §11; only the *consumption* side (quota → wallet overage) is new.
- No per-member sub-quotas — usage is workspace-level only, per §12.2.
- No proration on mid-cycle plan changes — an upgrade/downgrade takes effect at the *next* billing cycle unless a later pass explicitly adds proration.

---

## 13. License

MIT
