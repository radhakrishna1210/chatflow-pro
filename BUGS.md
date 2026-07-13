# ChatFlow Pro — Complete Bugs Sheet

> Every issue found across all 80+ files. From critical security holes to minor cosmetic problems.
> Total: **60 issues** (55 code-level + 5 functional/UX bugs).
> Last updated: 2026-07-09

---

## Legend

| Severity | Meaning |
|----------|---------|
| 🔴 CRITICAL | Security breach, data loss, or complete feature failure |
| 🟠 HIGH | Feature partially broken, exploitable, or causes wrong data |
| 🟡 MEDIUM | Functional bug with a workaround, or code that will break at scale |
| 🔵 LOW | Code quality issue, bad practice, or latent bug |
| ⚪ MINOR | Cosmetic, style, or very small cleanup item |
| 🟣 FUNCTIONAL | Bugs observed from actual live usage of the app |

---

## 🔴 CRITICAL (Must Fix Immediately)

---

### BUG-001 · `.env` file with live secrets is NOT excluded from Git properly

| Field | Detail |
|-------|--------|
| **File** | `.gitignore` lines 7–11, `backend/.env` |
| **Line** | `.env` lines 1–66 |
| **Category** | Security |
| **Description** | `.gitignore` lists `backend/.env` as ignored but the **file already exists in the working tree** and may have been committed before `.gitignore` was added. If `git status` shows it untracked the gitignore works, but if it was ever committed it's in history forever. The file contains live credentials: Meta System User Token, Twilio SID+Auth, Google OAuth secret, Gmail app password, PostgreSQL connection string with password, Redis password, JWT secrets. |
| **Impact** | Full account takeover, credential abuse, API billing fraud |
| **Fix** | Run `git rm --cached backend/.env` to untrack. Rotate ALL credentials immediately. Use environment variable injection (Railway, Render, Vercel env vars) instead. |

---

### BUG-002 · CORS allows all origins (`*`)

| Field | Detail |
|-------|--------|
| **File** | `backend/src/app.js` |
| **Line** | Line 18 |
| **Category** | Security |
| **Description** | `res.setHeader('Access-Control-Allow-Origin', '*')` — any website on the internet can make cross-origin requests to the API. Even with Bearer tokens, this allows phishing pages to make calls on behalf of logged-in users via JavaScript. |
| **Impact** | Cross-site request forgery-style attacks, data exfiltration |
| **Fix** | Replace `'*'` with `env.CLIENT_URL`. For multiple origins use a whitelist array. |

---

### BUG-003 · Webhook status tracking is completely broken

| Field | Detail |
|-------|--------|
| **File** | `backend/src/services/webhook.service.js` |
| **Line** | Lines 198–244 |
| **Category** | Logic — Data Integrity |
| **Description** | `handleStatusUpdate` finds a message by `metaMessageId` (correct), then: (1) fetches a recipient with `where: { campaign: { recipients: { some: {} } } }` — matches ANY recipient in ANY campaign, not the correct one. (2) Calls `prisma.campaignRecipient.updateMany({ ..., data: {} })` — `data: {}` updates nothing. (3) Campaign delivered/read/failed counters increment based on workspace, not specific campaign/recipient. |
| **Impact** | Wrong campaign statistics, per-recipient delivery tracking silently fails, analytics are wrong |
| **Fix** | Store `campaignRecipientId` on `Message` model, or look up recipient by linking `metaMessageId` through proper joins. Update the actual recipient record's `deliveredAt`, `readAt`, `failedAt`. |

---

### BUG-004 · AI onboarding controller creates fake campaign stats in DB

| Field | Detail |
|-------|--------|
| **File** | `backend/src/controllers/onboarding.controller.js` |
| **Line** | Lines 166–189, 279–305 |
| **Category** | Data Integrity |
| **Description** | The "one-shot" AI campaign creation hard-codes `sent: 250, delivered: 245, read: 190` (or `sent: 100, delivered: 98, read: 75`) as if real messages were actually sent. These fabricated stats are written permanently to the DB and appear in analytics dashboards. |
| **Impact** | Poisoned analytics, users see fake data as real campaign results, business decisions based on false numbers |
| **Fix** | Create campaigns as `DRAFT` with `sent: 0` only. Let the actual campaign worker handle sending and tracking. |

---

### BUG-005 · AI auto-approves templates bypassing Meta review

| Field | Detail |
|-------|--------|
| **File** | `backend/src/controllers/onboarding.controller.js`, `backend/src/controllers/ai.controller.js` |
| **Line** | `onboarding.controller.js` lines 145, 225; `ai.controller.js` line 14 |
| **Category** | Data Integrity |
| **Description** | AI-created templates are stored with `status: 'APPROVED'` directly in DB without submitting to Meta for review. These templates cannot actually be used in campaigns (Meta API will reject them). Users think templates are ready but campaigns will all fail silently. |
| **Impact** | Campaigns fail 100% for AI-created templates; users misled into thinking templates are ready |
| **Fix** | Set `status: 'PENDING'`. Either submit to Meta via `createMetaTemplate()` or mark clearly as "local draft only" in UI. |

---

### BUG-006 · Meta OAuth callback route is unauthenticated

| Field | Detail |
|-------|--------|
| **File** | `backend/src/routes/auth.routes.js` |
| **Line** | Lines 28–74 |
| **Category** | Security |
| **Description** | `GET /api/v1/auth/meta/callback?code=...&workspaceId=...` — the `workspaceId` query param is trusted without verifying the caller has any relation to it. An attacker can inject WhatsApp phone numbers into an arbitrary workspace. |
| **Impact** | Unauthorized workspace access, credential injection, data contamination |
| **Fix** | Require authentication on this route. Use an HMAC-signed `state` parameter in the OAuth flow to bind `workspaceId` to the user who initiated the flow. |

---

### BUG-007 · OAuth tokens exposed in browser redirect URL

| Field | Detail |
|-------|--------|
| **File** | `backend/src/controllers/auth.controller.js` |
| **Line** | Lines 26–38 |
| **Category** | Security |
| **Description** | `googleCallback` sends `accessToken` and `refreshToken` as URL query parameters. These appear in browser history, server logs, CDN/proxy logs, and Referer headers sent to any external resources on the page. |
| **Impact** | Token theft from logs/history; session hijacking |
| **Fix** | Use a short-lived Redis key and redirect with a one-time `code` param. Or use hash fragment (`#`) so tokens don't reach the server in logs. |

---

## 🟠 HIGH

---

### BUG-008 · Campaign worker has no graceful shutdown on SIGTERM

| Field | Detail |
|-------|--------|
| **File** | `backend/src/server.js` |
| **Line** | Lines 33–36 |
| **Category** | Reliability |
| **Description** | On SIGTERM, only `prisma.$disconnect()` is called. BullMQ workers are never closed. Active jobs mid-flight will be interrupted, Redis connections are left open, and BullMQ may retry jobs that were partially completed — causing double sends. |
| **Impact** | Duplicate WhatsApp messages sent to real customers, data inconsistency |
| **Fix** | Call `worker.close()` on both workers before disconnecting Prisma. Return worker references from start functions. |

---

### BUG-009 · Campaign rate limit is 60ms — 16x too fast for Meta

| Field | Detail |
|-------|--------|
| **File** | `backend/src/workers/campaign.worker.js` |
| **Line** | Line 9 |
| **Category** | Logic |
| **Description** | `RATE_DELAY_MS = 60` means ~16 messages/second = ~1000 messages/minute. Meta WhatsApp Cloud API Tier 1 limit is 250 msgs/min per phone number. Sending at 4x the base rate limit will trigger rate errors (error code 131042), causing failed sends and potentially getting the number flagged/suspended. |
| **Impact** | Mass campaign failures, number quality degradation, possible WABA suspension |
| **Fix** | Set `RATE_DELAY_MS = 250` minimum (240 msgs/min safe margin). Ideally read `messagingLimit` from the `WaNumber` record to calculate per-tier delay. |

---

### BUG-010 · Cancelled campaign still marked as COMPLETED in worker

| Field | Detail |
|-------|--------|
| **File** | `backend/src/workers/campaign.worker.js` |
| **Line** | Lines 109–112 |
| **Category** | Logic |
| **Description** | After the recipient loop exits via `break` on CANCELLED, execution falls through to `prisma.campaign.update({ data: { status: 'COMPLETED' } })`. A cancelled campaign is overwritten to COMPLETED with `completedAt` set and completion email queued. |
| **Impact** | Cancelled campaigns show as COMPLETED in dashboard; users receive "campaign completed" email notification; analytics incorrect |
| **Fix** | Check status before final update: `const latest = await prisma.campaign.findUnique(...); if (latest.status === 'CANCELLED') return;` |

---

### BUG-011 · `ai.controller.js` creates campaign with `totalContacts: 100` hardcoded

| Field | Detail |
|-------|--------|
| **File** | `backend/src/controllers/ai.controller.js` |
| **Line** | Lines 27–45 |
| **Category** | Data Integrity |
| **Description** | `createCampaign` sets `totalContacts: 100` regardless of actual recipients, and `status: 'RUNNING'` for a campaign that has no `waNumberId` and no recipients. Second fake-data code path in addition to `onboarding.controller.js`. |
| **Impact** | DB polluted with phantom campaigns, analytics corrupted |
| **Fix** | Create as `DRAFT` with `totalContacts: 0`, require `waNumberId` to be passed, or remove this endpoint and use the proper campaigns service. |

---

### BUG-012 · `ai.controller.js` `createTemplate` sets `status: 'APPROVED'` (2nd path for BUG-005)

| Field | Detail |
|-------|--------|
| **File** | `backend/src/controllers/ai.controller.js` |
| **Line** | Line 14 |
| **Category** | Data Integrity |
| **Description** | Same issue as BUG-005 but in the separate `/api/v1/ai/template/create` code path. Two different AI entry points both auto-approve templates. |
| **Impact** | Same as BUG-005 — templates appear approved but fail in campaigns |
| **Fix** | Set `status: 'PENDING'`. Submit to Meta or mark as draft. |

---

### BUG-013 · `requireAdmin` checks JWT role, not live DB role

| Field | Detail |
|-------|--------|
| **File** | `backend/src/middleware/authorize.js` |
| **Line** | Lines 22–27 |
| **Category** | Security |
| **Description** | `requireAdmin` checks `req.user?.role !== 'ADMIN'`. But `req.user.role` is set from the JWT payload at login time. If a user's role is changed in the DB after login (demoted), their existing token still has `role: 'ADMIN'` and will pass this check for up to 15 minutes. The `authorize()` function does a live DB lookup — two inconsistent role-check mechanisms coexist. |
| **Impact** | A demoted admin retains admin access until token expiry |
| **Fix** | Replace all uses of `requireAdmin` with `authorize('ADMIN')` which does live DB lookup. Remove `requireAdmin`. |

---

### BUG-014 · `workspaceContext` and `authorize` both query `WorkspaceMember` table

| Field | Detail |
|-------|--------|
| **File** | `backend/src/middleware/workspaceContext.js`, `backend/src/middleware/authorize.js` |
| **Line** | `workspaceContext.js:7`, `authorize.js:8` |
| **Category** | Performance |
| **Description** | Most routes apply both middlewares in sequence. Both independently query `prisma.workspaceMember.findUnique()` for the same user+workspace pair — double DB roundtrip on every protected route. |
| **Impact** | 2x unnecessary DB queries on every workspace API call |
| **Fix** | After `workspaceContext` resolves the member, store `req.member = member`. Have `authorize` read from `req.member` instead of re-querying. |

---

### BUG-015 · `queueMemberInvitedEmail` looks up workspace by name (non-unique)

| Field | Detail |
|-------|--------|
| **File** | `backend/src/services/email.service.js` |
| **Line** | Lines 371–382 |
| **Category** | Logic |
| **Description** | `prisma.workspace.findFirst({ where: { name: workspaceName } })` — workspace names are not unique in the schema. Two workspaces can have the same name. The wrong workspace's email notification settings could be used. |
| **Impact** | Invite emails suppressed or sent based on wrong workspace's settings |
| **Fix** | Pass and use `workspaceId` instead of `workspaceName`. |

---

### BUG-016 · `handleStatusUpdate` has dead code — fetches recipient and runs empty updateMany

| Field | Detail |
|-------|--------|
| **File** | `backend/src/services/webhook.service.js` |
| **Line** | Lines 205–218 |
| **Category** | Logic |
| **Description** | Variable `recipient` is fetched but never used (line 205). The `updateMany` on line 215 updates with `data: {}` (empty — no-op). Dead code that adds 2 unnecessary DB queries on every delivery status webhook. |
| **Impact** | 2 wasted DB queries per webhook status event |
| **Fix** | Remove lines 205–218 entirely. |

---

### BUG-017 · `/onboarding/chat` route has no authentication middleware

| Field | Detail |
|-------|--------|
| **File** | `backend/src/routes/onboarding.routes.js` |
| **Line** | Lines 1–8 |
| **Category** | Security |
| **Description** | `POST /api/v1/onboarding/chat` has no `authenticate` middleware. The controller does "soft auth" (tries to decode token but ignores failures), meaning unauthenticated users can trigger AI calls (Ollama/Gemini API usage) and potentially create templates/campaigns by passing any `workspaceId` in the body. |
| **Impact** | Anonymous AI API abuse, potential unauthenticated DB writes |
| **Fix** | Add `authenticate` middleware to the route. If anonymous chat is intentional, gate the workspace DB operations behind the userId check. |

---

### BUG-018 · CSV import fails due to wrong Content-Type in `authedFetch`

| Field | Detail |
|-------|--------|
| **File** | `frontend/src/lib/api.js` |
| **Line** | Lines 53–56 |
| **Category** | Logic |
| **Description** | `authedFetch` always sets `'Content-Type': 'application/json'`. When uploading a CSV via `FormData`, the Content-Type must be `multipart/form-data` with a boundary set by the browser automatically. Setting it manually to `application/json` breaks multipart parsing — the server receives no file. |
| **Impact** | CSV contact import silently fails; uploaded files are never processed |
| **Fix** | Check `if (opts.body instanceof FormData)` and skip setting `Content-Type` header in that case. |

---

### BUG-019 · Prisma schema missing `directUrl` for Supabase pooler

| Field | Detail |
|-------|--------|
| **File** | `backend/prisma/schema.prisma` |
| **Line** | Lines 5–8 |
| **Category** | Configuration |
| **Description** | `.env` defines `DIRECT_URL` (Supabase bypass URL needed for migrations). However `schema.prisma` datasource only sets `url = env("DATABASE_URL")` — `directUrl` is never referenced. Running `prisma migrate dev` or `prisma db push` will try to use the pooled connection which may timeout or fail. |
| **Impact** | DB migrations may fail in CI/CD or when running `prisma db push` |
| **Fix** | Add `directUrl = env("DIRECT_URL")` to the datasource block in `schema.prisma`. |

---

### BUG-020 · `listSegments` returns ALL contacts per segment with no limit

| Field | Detail |
|-------|--------|
| **File** | `backend/src/services/segments.service.js` |
| **Line** | Line 5 |
| **Category** | Performance |
| **Description** | `include: { contacts: true }` fetches every contact in every segment with no limit. A segment with 10,000 contacts returns all 10,000 on every segments list API call — memory spike + slow response + large payload. |
| **Impact** | API timeout, out-of-memory crash, slow dashboard for large workspaces |
| **Fix** | Change to `_count: { select: { contacts: true } }` for list endpoint. Add separate paginated endpoint for contacts within a segment. |

---

### BUG-021 · `getDeliveryStats` runs 14 sequential DB queries in a loop

| Field | Detail |
|-------|--------|
| **File** | `backend/src/services/analytics.service.js` |
| **Line** | Lines 62–87 |
| **Category** | Performance |
| **Description** | A `for` loop runs 7 iterations, each with 2 `await prisma.campaignRecipient.count()` calls — 14 sequential DB roundtrips for a single analytics endpoint. Each query is ~10-50ms = 140-700ms total just for this function. |
| **Impact** | Analytics endpoint is slow, hurts perceived dashboard performance |
| **Fix** | Use a single `$queryRaw` with `GROUP BY DATE(...)` (same approach used in `getChatAnalytics`). |

---

### BUG-022 · Encryption key encoding is ambiguous — `utf8` vs `hex`

| Field | Detail |
|-------|--------|
| **File** | `backend/src/lib/encryption.js` |
| **Line** | Line 5 |
| **Category** | Security / Correctness |
| **Description** | `Buffer.from(env.ENCRYPTION_KEY, 'utf8')` — the key `a8f3d2e1c4b7a6f5e9d8c3b2a1f0e7d6` looks like hex but is treated as UTF-8. Currently works because it's 32 ASCII chars = 32 bytes. But if someone generates a real hex key (64 chars) expecting hex encoding, `Buffer.from(key, 'utf8')` would give 64 bytes — wrong for AES-256. |
| **Impact** | Silent key mismatch if key is regenerated using hex convention |
| **Fix** | Explicitly document key format in env.js comments. Or switch entirely to `Buffer.from(key, 'hex')` with a 64-char hex key. |

---

### BUG-023 · `connectOwnNumber` returns object with `encryptedAccessToken: undefined` key present

| Field | Detail |
|-------|--------|
| **File** | `backend/src/services/whatsapp.service.js` |
| **Line** | Lines 48–54 |
| **Category** | Logic |
| **Description** | `return { ...number, encryptedAccessToken: undefined }` — the key exists in the object with value `undefined`. JSON.stringify drops `undefined` values so API response is correct, but the in-memory object is polluted. Inconsistent with `listNumbers()` which uses proper destructuring. |
| **Impact** | Latent confusion if the object is used in-memory before serialization |
| **Fix** | Use destructuring: `const { encryptedAccessToken: _, ...rest } = number; return rest;` |

---

## 🟡 MEDIUM

---

### BUG-024 · `server.js` has duplicate env module import

| Field | Detail |
|-------|--------|
| **File** | `backend/src/server.js` |
| **Line** | Lines 1 and 3 |
| **Category** | Code Quality |
| **Description** | Line 1: `import './config/env.js'` (side-effect only). Line 3: `import { env } from './config/env.js'` (named import). Module is cached so line 1 is completely redundant. |
| **Impact** | Misleading code, no functional effect |
| **Fix** | Remove line 1; keep only line 3. |

---

### BUG-025 · No input validation on any route — `validators/` directory is empty

| Field | Detail |
|-------|--------|
| **File** | `backend/src/validators/` (empty), all controllers |
| **Line** | All controllers passing `req.body` directly to services |
| **Category** | Security / Robustness |
| **Description** | Every controller passes `req.body` raw to service functions with no Zod or other schema validation. Malformed input causes confusing Prisma errors or unexpected behavior. |
| **Impact** | Confusing error messages, possible Prisma crashes, unexpected behavior from malformed input |
| **Fix** | Add Zod schemas in `validators/`. Parse `req.body` with `schema.parse()` before passing to services. Express 5 will auto-catch thrown Zod errors. |

---

### BUG-026 · `storeRefreshToken` hardcodes 7-day expiry instead of using env var

| Field | Detail |
|-------|--------|
| **File** | `backend/src/services/auth.service.js` |
| **Line** | Line 22 |
| **Category** | Code Quality |
| **Description** | `new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)` hardcodes 7 days. `JWT_REFRESH_EXPIRES_IN = '7d'` from env is used for JWT signing but NOT for the DB `expiresAt` field. If env value is changed to e.g. `30d`, the DB record still expires in 7 days. |
| **Impact** | Inconsistency between JWT expiry and DB token expiry if env is changed |
| **Fix** | Parse `env.JWT_REFRESH_EXPIRES_IN` to ms and use it for `expiresAt`. |

---

### BUG-027 · `findOrCreateGoogleUser` crashes if user has no workspace member record

| Field | Detail |
|-------|--------|
| **File** | `backend/src/services/auth.service.js` |
| **Line** | Lines 175–190 |
| **Category** | Logic |
| **Description** | If a user is found by email but has no `WorkspaceMember` record (edge case where workspace creation failed), `member` is `null`. Line 182 `member.workspaceId` throws `Cannot read properties of null`. |
| **Impact** | 500 error on Google OAuth for users with broken workspace state |
| **Fix** | Add null check: `if (!member) { /* create workspace and member */ }` before accessing `member.workspaceId`. |

---

### BUG-028 · `ai.controller.js` update routes lack workspace ownership verification

| Field | Detail |
|-------|--------|
| **File** | `backend/src/controllers/ai.controller.js` |
| **Line** | Lines 48–78 |
| **Category** | Security |
| **Description** | `updateCampaign` and `updateTemplate` use `workspaceId` from `req.user` (JWT payload) to scope updates. The `/api/v1/ai/*` routes only apply `authenticate`, not `workspaceContext`. Users could potentially target resources in workspaces they're members of by crafting requests. |
| **Impact** | Potential cross-workspace data modification |
| **Fix** | Add `workspaceContext` middleware or validate member belongs to the resource's workspace. |

---

### BUG-029 · Google OAuth flow has no CSRF `state` parameter

| Field | Detail |
|-------|--------|
| **File** | `backend/src/app.js`, `backend/src/routes/auth.routes.js` |
| **Line** | `auth.routes.js:14` |
| **Category** | Security |
| **Description** | Google OAuth flow doesn't use a `state` parameter. Without `state`, the authorization flow is vulnerable to CSRF: an attacker can trick a user into clicking a crafted URL and linking the attacker's Google account to the victim's session. |
| **Impact** | Account hijacking via OAuth CSRF |
| **Fix** | Generate random `state` per request, store in Redis/session, verify on callback. |

---

### BUG-030 · BullMQ queues share one Redis connection instance

| Field | Detail |
|-------|--------|
| **File** | All queue and worker files |
| **Line** | `connection: redis` in all 4 BullMQ instances |
| **Category** | Reliability |
| **Description** | All 4 BullMQ instances (2 queues + 2 workers) share the same `redis` singleton. BullMQ docs require separate connection instances per queue/worker because it uses blocking commands (`BLPOP`, `SUBSCRIBE`) that conflict on a shared connection. |
| **Impact** | Job processing may stall, events may be missed, Redis connection errors under load |
| **Fix** | Pass `{ host, port, password, tls }` connection options object to each BullMQ instance instead of a shared IORedis client. |

---

### BUG-031 · `sync-from-meta` templates route has no `authorize` guard

| Field | Detail |
|-------|--------|
| **File** | `backend/src/routes/templates.routes.js` |
| **Line** | Line 13 |
| **Category** | Security |
| **Description** | `POST /sync-from-meta` — any authenticated workspace member (even CLIENT role) can trigger a full Meta template sync, which makes external API calls and writes to the DB. |
| **Impact** | CLIENT-role users trigger external API calls and DB writes |
| **Fix** | Add `authorize('ADMIN')` to this route. |

---

### BUG-032 · `connect-own-number` WhatsApp route has no `authorize` guard

| Field | Detail |
|-------|--------|
| **File** | `backend/src/routes/whatsapp.routes.js` |
| **Line** | Line 13 |
| **Category** | Security |
| **Description** | `POST /numbers/connect-own` — any authenticated member can connect a phone number to the workspace. This is a privileged action. |
| **Impact** | CLIENT role members can add unauthorized phone numbers |
| **Fix** | Add `authorize('ADMIN')`. |

---

### BUG-033 · `disconnect` WhatsApp route has no `authorize` guard

| Field | Detail |
|-------|--------|
| **File** | `backend/src/routes/whatsapp.routes.js` |
| **Line** | Line 16 |
| **Category** | Security |
| **Description** | `DELETE /numbers/:id` — any authenticated member can disconnect a number and trigger deletion of all templates in the workspace. |
| **Impact** | CLIENT role members can destroy workspace WhatsApp connection and delete all templates |
| **Fix** | Add `authorize('ADMIN')`. |

---

### BUG-034 · `updateSegment` passes raw `req.body` to Prisma (mass assignment)

| Field | Detail |
|-------|--------|
| **File** | `backend/src/controllers/segments.controller.js`, `backend/src/services/segments.service.js` |
| **Line** | `controller:31`, `service:17` |
| **Category** | Security |
| **Description** | `const updates = req.body` is passed directly to `prisma.segment.update({ data: updates })`. A client can set any field on the Segment model, including `workspaceId`, `createdAt`, `id`. |
| **Impact** | Users can reassign segments to other workspaces or manipulate internal fields |
| **Fix** | Whitelist allowed fields: `name`, `desc`, `color` only. |

---

### BUG-035 · `updateContactInSegment` also has mass-assignment issue

| Field | Detail |
|-------|--------|
| **File** | `backend/src/services/segments.service.js` |
| **Line** | Line 53 |
| **Category** | Security |
| **Description** | `prisma.contact.update({ where: { id: contactId }, data: updates })` — `updates` is raw `req.body`. Caller can change `workspaceId`, `optedOut`, and other sensitive fields on any contact linked to a segment. |
| **Impact** | Users can move contacts between workspaces or set opt-out status arbitrarily |
| **Fix** | Whitelist: `name`, `phoneNumber`, `email`, `tags` only. |

---

### BUG-036 · `wFetch` throws synchronously instead of returning rejected Promise

| Field | Detail |
|-------|--------|
| **File** | `frontend/src/lib/api.js` |
| **Line** | Lines 90–96 |
| **Category** | Logic |
| **Description** | `if (!user?.workspaceId) { throw new Error('Workspace not found'); }` — throws synchronously. Callers using `wFetch(...).then(...)` won't catch it; only `async/await` with try/catch will. Some React components may have unhandled errors. |
| **Impact** | Unhandled exceptions, app crash in components that don't use try/catch |
| **Fix** | Return `Promise.reject(new Error('Workspace not found'))` instead of throwing synchronously. |

---

### BUG-037 · `App.jsx` has no routing — browser navigation doesn't work

| Field | Detail |
|-------|--------|
| **File** | `frontend/src/App.jsx` |
| **Line** | Lines 31–48 |
| **Category** | UX |
| **Description** | Page switching is done via `useState`. Browser back/forward buttons, deep links, and page refresh navigation don't work. Refreshing any navigated page brings users back to landing. |
| **Impact** | Poor UX, users can't share links or use browser navigation |
| **Fix** | Integrate React Router v6 with `<BrowserRouter>` and `<Routes>`. |

---

### BUG-038 · `automation.service.js` initializes Gemini client at module load time — crashes if key missing

| Field | Detail |
|-------|--------|
| **File** | `backend/src/services/automation.service.js` |
| **Line** | Lines 1–7 |
| **Category** | Reliability |
| **Description** | `const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY })` runs at module import time. `GEMINI_API_KEY` is optional in env schema (can be undefined). If undefined, `new GoogleGenAI({ apiKey: undefined })` may throw at startup before the server can listen. |
| **Impact** | Server startup crash when `GEMINI_API_KEY` is not set |
| **Fix** | Lazily initialize: `let ai = null; function getAi() { if (!ai && env.GEMINI_API_KEY) ai = new GoogleGenAI(...); return ai; }` |

---

### BUG-039 · Ollama URL hardcoded to localhost — broken in production

| Field | Detail |
|-------|--------|
| **File** | `backend/src/controllers/onboarding.controller.js` |
| **Line** | Line 10 |
| **Category** | Configuration |
| **Description** | `fetch('http://127.0.0.1:11434/api/generate')` — hardcoded to localhost. In any cloud deployment, every Ollama call fails silently and falls back to generic hardcoded responses. No env var for `OLLAMA_URL`. |
| **Impact** | AI onboarding always uses dumb hardcoded fallback in production |
| **Fix** | Add `OLLAMA_URL` env var defaulting to `http://127.0.0.1:11434`. |

---

### BUG-040 · Expired refresh tokens are never cleaned up from DB

| Field | Detail |
|-------|--------|
| **File** | `backend/src/services/auth.service.js` |
| **Line** | Lines 110–117 |
| **Category** | Housekeeping |
| **Description** | When a refresh token is expired (`stored.expiresAt < new Date()`), an error is thrown and the token is NOT deleted. The token stays in `RefreshToken` table indefinitely. No periodic cleanup exists. |
| **Impact** | `RefreshToken` table grows indefinitely; DB bloat over time |
| **Fix** | Delete expired token even when refusing to refresh: `await prisma.refreshToken.delete({ where: { token } })` before throwing. Add a weekly cleanup job. |

---

### BUG-041 · `addRecipients` reports incorrect `skipped` count (doesn't count duplicates)

| Field | Detail |
|-------|--------|
| **File** | `backend/src/services/campaigns.service.js` |
| **Line** | Lines 42–57 |
| **Category** | Logic |
| **Description** | `skipped: invalidIds.length` only counts IDs not in the workspace, not actual duplicates skipped by `skipDuplicates: true`. Response says `skipped: 0` even when 100 duplicate recipients were silently ignored. |
| **Impact** | Inaccurate response; users don't know how many contacts were already added |
| **Fix** | Use the result count from `createMany` to calculate actual inserts vs total valid IDs. |

---

### BUG-042 · `workflow.controller.js` does redundant JSON parse — Prisma already returns objects

| Field | Detail |
|-------|--------|
| **File** | `backend/src/controllers/workflow.controller.js` |
| **Line** | Lines 7–11, 22–26, 37–41 |
| **Category** | Code Quality |
| **Description** | `typeof w.nodes === 'string' ? JSON.parse(w.nodes) : w.nodes` — Prisma `Json` fields are always returned as JavaScript objects, never as strings. The `typeof ... === 'string'` branch is dead code that runs on every workflow response. |
| **Impact** | Unnecessary conditional checks on every workflow API response |
| **Fix** | Remove the ternary — just use `w.nodes` directly. |

---

## 🔵 LOW

---

### BUG-043 · CSV import accepts invalid phone numbers (no format validation)

| Field | Detail |
|-------|--------|
| **File** | `backend/src/services/contacts.service.js` |
| **Line** | Lines 27–38 |
| **Category** | Data Quality |
| **Description** | CSV rows are only filtered by `c.phoneNumber` being truthy. No E.164 format check. Values like `"abc"`, `"123"`, `"N/A"` are imported successfully and will cause campaign send failures for those contacts. |
| **Impact** | Garbage contacts in DB, failed sends, wasted campaign quota |
| **Fix** | Validate with regex like `/^\+?[1-9]\d{7,14}$/` and skip invalid rows with a warning count. |

---

### BUG-044 · Phone numbers not normalized on import — causes contact matching failure

| Field | Detail |
|-------|--------|
| **File** | `backend/src/services/contacts.service.js` |
| **Line** | Lines 29–35 |
| **Category** | Data Quality |
| **Description** | Phone numbers stored as-is from CSV (e.g., `+91 98765 43210`). The campaign worker normalizes on send (`normalizePhone`), but `handleInboundMessage` in webhook service does not normalize before `findFirst`. A contact imported as `+91 98765 43210` won't match an inbound message from `919876543210`. |
| **Impact** | Contacts not matched to inbound conversations; auto-reply broken for CSV-imported contacts |
| **Fix** | Normalize to E.164 on import. Strip spaces, dashes; ensure `+` prefix. |

---

### BUG-045 · `importContacts` returns misleading count (total rows, not actual inserts)

| Field | Detail |
|-------|--------|
| **File** | `backend/src/services/contacts.service.js` |
| **Line** | Lines 37–38 |
| **Category** | UX |
| **Description** | `return { imported: data.length }` returns count of valid CSV rows processed, not count actually inserted. With `skipDuplicates: true`, if 300 of 500 contacts already exist, the response says `imported: 500` — misleading. |
| **Impact** | Users think all 500 were imported when only 200 were new |
| **Fix** | `const result = await prisma.contact.createMany(...); return { imported: result.count, total: data.length, skipped: data.length - result.count }` |

---

### BUG-046 · `decrypt` uses `split(':')` — could fail with malformed encrypted strings

| Field | Detail |
|-------|--------|
| **File** | `backend/src/lib/encryption.js` |
| **Line** | Lines 15–22 |
| **Category** | Correctness |
| **Description** | `const [ivHex, dataHex] = encryptedText.split(':')` — if `encryptedText` is corrupted or null, `split` returns `[undefined, undefined]` causing silent failures. No guard for malformed input. |
| **Impact** | Cryptic error if stored encrypted token is corrupted in DB |
| **Fix** | Add validation: `if (!encryptedText || !encryptedText.includes(':')) throw new Error('Invalid encrypted value')`. Use fixed-length slice instead of split. |

---

### BUG-047 · Login and refresh token endpoints have no rate limiting

| Field | Detail |
|-------|--------|
| **File** | `backend/src/routes/auth.routes.js` |
| **Line** | Lines 9–12 |
| **Category** | Security |
| **Description** | `POST /auth/login` and `POST /auth/refresh` have no rate limiting. Unlimited brute-force attempts against login credentials or token guessing are possible. |
| **Impact** | Brute-force login attacks |
| **Fix** | Add `express-rate-limit`: 10 attempts/min/IP for login, 30/min/IP for refresh. |

---

### BUG-048 · `cancelCampaign` can't stop an in-progress worker — only removes queued jobs

| Field | Detail |
|-------|--------|
| **File** | `backend/src/services/campaigns.service.js` |
| **Line** | Lines 100–103 |
| **Category** | Logic |
| **Description** | `campaignQueue.getJobs(['delayed', 'waiting'])` only removes jobs not yet started. An actively running worker won't be stopped until its next in-loop DB check (after the current recipient is processed). A few extra messages may be sent. |
| **Impact** | Small number of extra messages after cancel; expected but undocumented behavior |
| **Fix** | Document this limitation. Optionally use a Redis flag checked in the worker loop for faster cancellation. |

---

### BUG-049 · Root `app.jsx` is dead code — abandoned prototype

| Field | Detail |
|-------|--------|
| **File** | `app.jsx` (project root) |
| **Line** | All 19 lines |
| **Category** | Code Quality |
| **Description** | Standalone `app.jsx` at project root imports from `./components/landing.jsx` and `./components/dashboard.jsx`. Not part of the Vite build. An old prototype superseded by `frontend/src/`. |
| **Impact** | Repo confusion, stale code |
| **Fix** | Delete `app.jsx` and the root `components/` directory. |

---

### BUG-050 · `ChatFlow Pro.html` at root is an orphaned prototype

| Field | Detail |
|-------|--------|
| **File** | `ChatFlow Pro.html` (project root) |
| **Line** | All lines |
| **Category** | Code Quality |
| **Description** | A 4KB standalone HTML file at project root. Not served by backend or frontend build. Old design prototype. |
| **Impact** | Confusing repo structure |
| **Fix** | Delete or move to `/docs/` folder. |

---

### BUG-051 · `mailer.js` singleton transporter never re-initializes if SMTP config changes

| Field | Detail |
|-------|--------|
| **File** | `backend/src/lib/mailer.js` |
| **Line** | Lines 4–19 |
| **Category** | Code Quality |
| **Description** | `_transporter` is a module-level singleton. Once created, it never refreshes even if SMTP config changes. In practice this requires a restart, but is worth documenting. |
| **Impact** | Old SMTP config used after credential rotation until restart |
| **Fix** | Document behavior. Or create transporter inline per call for easier testing. |

---

## ⚪ MINOR

---

### BUG-052 · `index.css` references fonts not imported — wrong font displayed

| Field | Detail |
|-------|--------|
| **File** | `frontend/src/index.css` |
| **Line** | Lines 25, 42 |
| **Category** | UI |
| **Description** | `font-family: 'Plus Jakarta Sans', sans-serif` (line 25) and `font-family:'Syne',sans-serif` (line 42) — neither font is imported via `@import` or `<link>` tag. Browser falls back to system `sans-serif`. |
| **Impact** | Wrong fonts rendered; UI looks different from design intent |
| **Fix** | Add to top of `index.css`: `@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&family=Syne:wght@600;700&display=swap');` |

---

### BUG-053 · `main.jsx` should use `React.StrictMode`

| Field | Detail |
|-------|--------|
| **File** | `frontend/src/main.jsx` |
| **Line** | All |
| **Category** | Best Practice |
| **Description** | React apps should wrap the root with `<React.StrictMode>` in development to catch double-render issues and deprecated API usage early. |
| **Impact** | Latent bugs (e.g., non-idempotent effects) may not surface in development |
| **Fix** | Wrap `<App />` with `<React.StrictMode>`. |

---

### BUG-054 · Error response format is inconsistent across controllers

| Field | Detail |
|-------|--------|
| **File** | Multiple controllers |
| **Line** | Various |
| **Category** | Code Quality |
| **Description** | Some controllers (segments, automation, workflow) have their own try/catch and return `{ error: err.message }`. Others (campaigns, contacts, templates) rely on the global `errorHandler`. Two different error-handling patterns in the same codebase. |
| **Impact** | Inconsistent error responses; frontend may need to handle errors differently per endpoint |
| **Fix** | Standardize: use the global `errorHandler` everywhere. Remove local try/catch from controllers. Create a shared `AppError` class for typed errors. |

---

### BUG-055 · `CHATFLOW_PRO_URL` env var is defined but never used anywhere

| Field | Detail |
|-------|--------|
| **File** | `backend/.env` line 5, `backend/src/config/env.js` line 8 |
| **Line** | `env.js:8` |
| **Category** | Housekeeping |
| **Description** | `CHATFLOW_PRO_URL=http://localhost:8080` is defined in `.env` and validated in `env.js` Zod schema, but `env.CHATFLOW_PRO_URL` is never referenced anywhere in the codebase. Dead configuration. |
| **Impact** | None functional, but adds confusion and an unnecessary required env var |
| **Fix** | Remove from `.env` and `env.js` schema, or document what it's intended for. |

---

## 🟣 FUNCTIONAL / UX BUGS (Reported from Live Usage)

> These are bugs observed when actually using the app — broken features, missing UI data, wrong behavior.

---

### BUG-056 · Campaign date not shown anywhere on the campaign list/detail UI

| Field | Detail |
|-------|--------|
| **Feature** | Campaigns |
| **Affects** | Frontend — campaign list page, campaign detail view |
| **Category** | UI / Missing Feature |
| **Description** | The `Campaign` model has four date fields: `scheduledAt`, `launchedAt`, `completedAt`, `createdAt`. The `launchCampaign` service correctly sets `scheduledAt` and `launchedAt`. However, the frontend campaign list and detail views never render these dates to the user. There is no "Scheduled For", "Launched At", or "Completed At" column or label visible anywhere in the campaign UI. |
| **Impact** | Users cannot see when a campaign is scheduled, when it ran, or when it completed. Impossible to audit campaigns by date. |
| **Fix** | In the campaign list table, add a "Date" column that shows: `scheduledAt` for DRAFT/scheduled campaigns, `launchedAt` for RUNNING campaigns, `completedAt` for COMPLETED campaigns. Use `createdAt` as the fallback. Format dates as `DD MMM YYYY, HH:MM`. |

---

### BUG-057 · Campaign does not actually run after clicking "Launch"

| Field | Detail |
|-------|--------|
| **Feature** | Campaign execution |
| **Affects** | `backend/src/workers/campaign.worker.js` + `backend/src/queues/campaign.queue.js` |
| **Category** | Critical Functional Bug |
| **Root Cause (1)** | **Shared Redis connection breaks BullMQ**: The campaign queue and worker both use `connection: redis` — the shared IORedis singleton. BullMQ requires each Queue and Worker to own its own connection. On a cloud Redis (e.g. Upstash with TLS), a shared connection that already handles pub/sub blocks job processing. Jobs are enqueued but the worker never picks them up. |
| **Root Cause (2)** | **`launchCampaign` sets `status: 'RUNNING'` BEFORE the job runs** (`campaigns.service.js` line 78): `prisma.campaign.update({ data: { status: 'RUNNING', launchedAt: new Date() } })`. The campaign shows as RUNNING in the UI even if no messages are ever sent. |
| **Root Cause (3)** | **No `SCHEDULED` status in the DB enum**: Campaigns scheduled for the future stay as `DRAFT` in the DB — there's no way to distinguish "queued for future" from "truly draft". |
| **Root Cause (4)** | **No Redis health check at startup**: If Redis is unavailable, workers silently fail to connect. No error surfaces. |
| **Impact** | Campaigns appear stuck in DRAFT or RUNNING but no messages are ever sent. Users think the feature is broken. |
| **Fix** | (a) Use separate Redis connection objects per BullMQ instance. (b) Add `SCHEDULED` to `CampaignStatus` enum. (c) Only set `RUNNING` in the worker once it actually starts processing. (d) Add a Redis connectivity health check at startup. |

---

### BUG-058 · Meta Embedded Signup (WhatsApp onboarding) is broken

| Field | Detail |
|-------|--------|
| **Feature** | WhatsApp number connection via Meta Embedded Signup |
| **Affects** | `backend/src/routes/auth.routes.js` lines 28–74 |
| **Category** | Critical Functional Bug |
| **Root Cause (1)** | **Uses platform's own WABA, not the user's**: `getWabaPhoneNumbers(env.META_WABA_ID)` always fetches phone numbers from the **platform owner's** hardcoded WABA ID. Embedded Signup creates a new WABA for each user. The callback must use the `waba_id` returned in the code exchange response — not `META_WABA_ID`. |
| **Root Cause (2)** | **No `redirect_uri` in code exchange** (`meta.js` lines 92–101): Meta OAuth requires the exact `redirect_uri` used in the initial auth request. `exchangeCodeForToken` omits it entirely. Meta returns `Invalid OAuth redirect_uri` and the exchange fails. |
| **Root Cause (3)** | **`workspaceId` is a trusting query param** (line 29): Anyone can call the callback URL with any `workspaceId` and inject a phone number into another workspace. No auth check exists. |
| **Root Cause (4)** | **Errors return JSON, not redirect** (line 72): Frontend launched an OAuth redirect expecting a redirect back. Getting a JSON 500 response means the UI never resolves — popup hangs or user is stuck. |
| **Impact** | Meta Embedded Signup completely non-functional. Users cannot connect their own WhatsApp Business accounts. |
| **Fix** | (a) Extract `waba_id` from code exchange response for `getWabaPhoneNumbers`. (b) Pass `redirect_uri` to `exchangeCodeForToken`. (c) Add `authenticate` middleware. (d) Always redirect on error instead of returning JSON. |

---

### BUG-059 · Admin vs CLIENT role access conflicts

| Field | Detail |
|-------|--------|
| **Feature** | Role-based access control |
| **Affects** | `backend/src/middleware/authorize.js`, all route files |
| **Category** | Logic Bug / Access Control |
| **Root Cause (1)** | **`authorize('ADMIN', 'CLIENT')` logic is confusing**: `Math.min(ROLE_HIERARCHY['ADMIN'], ROLE_HIERARCHY['CLIENT'])` = `Math.min(1, 0)` = `0` — so any CLIENT-level user passes. Several routes use this pattern when they should use `authorize('ADMIN')` only. |
| **Root Cause (2)** | **Redundant `authorize('CLIENT')` on contacts routes**: Any authenticated workspace member is already CLIENT level. The `authorize('CLIENT')` call adds a useless extra DB query per request with zero security gain. |
| **Root Cause (3)** | **CLIENT users can delete workflows**: `workflow.routes.js` uses `authorize('ADMIN', 'CLIENT')` on DELETE — meaning CLIENT role can delete any workflow in the workspace, which is likely unintended. |
| **Root Cause (4)** | **Only two roles, no granular permissions**: No read-only `VIEWER` or `MEMBER` role exists. There is no way to add a team member who can only view conversations without making changes. |
| **Root Cause (5)** | **`requireAdmin` reads stale JWT role**: `req.user.role` from JWT payload. If role is changed after login, the old ADMIN role persists for up to 15 minutes until token refresh. |
| **Impact** | CLIENT users can delete workflows and import contacts. ADMIN role changes don't take effect immediately. No read-only access is possible. |
| **Fix** | (a) Audit every `authorize()` call and align with intended permission matrix. (b) Remove redundant `authorize('CLIENT')`. (c) Replace `requireAdmin` with `authorize('ADMIN')`. (d) Consider adding a `VIEWER` role. |

---

### BUG-060 · Scheduled campaigns do not run at the scheduled time

| Field | Detail |
|-------|--------|
| **Feature** | Campaign scheduling |
| **Affects** | `backend/src/services/campaigns.service.js` lines 60–83, BullMQ queue + worker |
| **Category** | Critical Functional Bug |
| **Root Cause (1)** | **No `SCHEDULED` status in DB**: When a campaign is scheduled, the service does NOT update the campaign status from `DRAFT`. The campaign stays as `DRAFT` even though a delayed BullMQ job is queued. On a server restart, there is no way to tell which `DRAFT` campaigns have queued jobs and which don't. On restart, orphaned scheduled campaigns will never run. |
| **Root Cause (2)** | **No past-date validation**: `const delay = new Date(scheduledAt).getTime() - Date.now()` with `Math.max(0, delay)` — if `scheduledAt` is in the past, `delay` becomes 0 and the campaign fires immediately with no error or warning. |
| **Root Cause (3)** | **No job recovery on server restart**: `server.js` starts the worker but never re-queues orphaned scheduled campaigns. BullMQ delayed jobs survive in Redis, but ephemeral Redis (Upstash free tier) loses all jobs on restart. |
| **Root Cause (4)** | **Cancel race condition**: `cancelCampaign` fetches jobs with `getJobs(['delayed', 'waiting'])`. If a job transitions from `delayed` → `waiting` between the cancel and the fetch, it won't be found or removed. The campaign is set to `CANCELLED` in DB but the worker still runs it, resetting status to `RUNNING`. |
| **Root Cause (5)** | **`scheduledAt` only set on delayed path**: For instant launches, `scheduledAt` is never written to the DB. The `createdAt` field is the only timestamp for immediate campaigns, with no `launchedAt` set until the worker runs. |
| **Impact** | Scheduled campaigns: don't run after Redis restart, fire immediately on past dates, stay DRAFT forever after server restart, and can run even after cancellation. |
| **Fix** | (a) Add `SCHEDULED` to `CampaignStatus` enum and set it when `scheduledAt` is in the future. (b) Validate `scheduledAt > new Date()` — return 400 for past dates. (c) On startup, re-queue all `SCHEDULED` campaigns whose `scheduledAt` is still in the future. (d) Store BullMQ job ID on the Campaign model for reliable lookup and cancellation. |

---

## Summary Table

| Severity | Count | Bug IDs |
|----------|-------|---------|
| 🔴 CRITICAL | 7 | BUG-001 to BUG-007 |
| 🟠 HIGH | 16 | BUG-008 to BUG-023 |
| 🟡 MEDIUM | 19 | BUG-024 to BUG-042 |
| 🔵 LOW | 9 | BUG-043 to BUG-051 |
| ⚪ MINOR | 4 | BUG-052 to BUG-055 |
| 🟣 FUNCTIONAL / UX | 5 | BUG-056 to BUG-060 |
| **TOTAL** | **60** | |

---

## Quick Fix Priority (Ordered by Impact + Effort)

| Priority | Bug ID | Title | Est. Time |
|----------|--------|-------|-----------|
| 1 | BUG-001 | Rotate ALL exposed secrets, untrack `.env` from Git | 30 min |
| 2 | BUG-002 | Fix CORS wildcard `*` → `env.CLIENT_URL` | 1 min |
| 3 | BUG-056 | Show campaign dates (scheduledAt / launchedAt / completedAt) in UI | 30 min |
| 4 | BUG-057 | Fix campaign not running — separate Redis connections per BullMQ instance | 2–4 hrs |
| 5 | BUG-060 | Fix scheduled campaigns — add SCHEDULED status + startup recovery | 3–5 hrs |
| 6 | BUG-058 | Fix Meta Embedded Signup — use user's WABA, pass redirect_uri, add auth | 2–3 hrs |
| 7 | BUG-059 | Fix role conflicts — audit authorize() calls, remove redundant guards | 1–2 hrs |
| 8 | BUG-010 | Fix cancelled campaign → COMPLETED fallthrough in worker | 5 min |
| 9 | BUG-009 | Fix campaign send rate: 60ms → 250ms minimum | 1 min |
| 10 | BUG-018 | Fix CSV import — skip Content-Type header for FormData | 5 min |
| 11 | BUG-052 | Import Google Fonts (Plus Jakarta Sans + Syne) in index.css | 2 min |
| 12 | BUG-019 | Add `directUrl` to Prisma schema for Supabase migrations | 2 min |
| 13 | BUG-024 | Remove duplicate `import './config/env.js'` in server.js | 1 min |
| 14 | BUG-055 | Remove unused `CHATFLOW_PRO_URL` from env schema | 2 min |
| 15 | BUG-038 | Lazy-init Gemini client — prevent startup crash | 10 min |
| 16 | BUG-005 / BUG-012 | Stop auto-approving AI templates — set status PENDING | 15 min |
| 17 | BUG-004 / BUG-011 | Remove fake hardcoded campaign stats from AI controller | 20 min |
| 18 | BUG-017 | Add `authenticate` middleware to /onboarding/chat route | 5 min |
| 19 | BUG-031 / BUG-032 / BUG-033 | Add missing `authorize('ADMIN')` to 3 unguarded routes | 10 min |
| 20 | BUG-030 | Fix BullMQ shared Redis connection — use separate connection options | 1 hr |
| 21 | BUG-003 | Fix webhook status tracking — store campaignRecipientId on Message | 2–3 hrs |
| 22 | BUG-020 | Fix segment list — replace `include: contacts` with `_count` | 30 min |
| 23 | BUG-021 | Optimize delivery stats — replace 14 sequential queries with GROUP BY | 1 hr |
| 24 | BUG-006 | Secure Meta OAuth callback with HMAC state param | 2 hrs |
| 25 | BUG-007 | Fix OAuth tokens in redirect URL — use one-time Redis code | 2 hrs |
| 26 | BUG-025 | Add Zod input validation to all routes | 1 day |
