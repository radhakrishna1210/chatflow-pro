# ChatFlow Pro — Stabilization Sprint Report

All 60 issues from BUGS.md were addressed, plus additional defects found during independent audit and live end-to-end testing (86/86 automated E2E checks passing against a real Postgres + Redis + BullMQ stack).

## Critical actions still required by you (cannot be done from code)

1. **ROTATE ALL CREDENTIALS in `backend/.env` immediately** (BUG-001). The file was never committed to git (verified), but it contains live secrets: Meta System User Token, Twilio SID/Auth, Google OAuth secret, Gmail app password, Supabase Postgres password, Redis password, JWT secrets. Rotate every one of them and inject via your host's environment variables.
2. **Meta App dashboard**: add `META_REDIRECT_URI` (default `<backend>/api/v1/auth/meta/callback`) to the app's Valid OAuth Redirect URIs, or Embedded Signup will fail at token exchange.
3. Run `prisma migrate dev` (or `db push`) — the schema gained: `SCHEDULED` campaign status, `Campaign.queueJobId`, `Message.campaignRecipientId` + index, unique `(campaignId, contactId)` on recipients, unique `(workspaceId, phoneNumber)` on contacts, and `directUrl`.

## What changed (by area)

### Security
- CORS: wildcard `*` → strict origin whitelist from `CLIENT_URL` (+ `CORS_EXTRA_ORIGINS`).
- Google OAuth: tokens no longer travel in redirect URLs — a one-time Redis code is issued and exchanged via `POST /auth/exchange`; HMAC-signed `state` blocks OAuth CSRF.
- Meta Embedded Signup: new authenticated `GET /auth/meta/start` issues a signed state binding workspace + admin; callback verifies state, passes `redirect_uri` to the token exchange, uses the **customer's** WABA (from token response or `/me/businesses`), and always redirects (with error codes) instead of hanging the popup with JSON 500s.
- Onboarding AI chat now requires authentication + verified workspace membership; rate limited.
- Login/refresh/register endpoints are rate limited (in-memory fixed-window limiter).
- `sync-from-meta`, `connect-own`, `onboard`, and number `disconnect` now require workspace ADMIN; workflow DELETE requires ADMIN; redundant `authorize('CLIENT')` removed.
- `authorize()` fixed (`Math.min` → `Math.max`, so `authorize('ADMIN','CLIENT')` no longer grants CLIENT), reuses the live role loaded by `workspaceContext` (no duplicate DB query), and `requireSuperAdmin` re-verifies against the DB email instead of a stale JWT claim.
- Mass assignment closed on segments, contacts-in-segments, and contact updates (strict Zod whitelists).
- Encryption: supports 32-char ASCII or 64-char hex keys; `decrypt` guards malformed ciphertext.
- Refresh tokens: unique `jti` (fixes same-second token collision), expiry honours `JWT_REFRESH_EXPIRES_IN`, expired rows deleted on detection + opportunistic cleanup; refresh tokens are single-use (rotation verified by test).

### Campaign engine (BUG-057/060/010/009/048/008/030)
- Every BullMQ Queue/Worker owns its own Redis connection (shared-connection deadlock fixed).
- `SCHEDULED` status added; future launches store the BullMQ job ID; past dates rejected with 400.
- `RUNNING` is set only by the worker via an atomic claim (`updateMany` guarded by status) — no more phantom RUNNING.
- Cancelled campaigns can never be flipped to COMPLETED; completion is an atomic `RUNNING → COMPLETED` transition; cancel removes the delayed job by stored ID (race-proof) and the worker re-checks status per recipient.
- Startup recovery (`recoverScheduledCampaigns`) re-queues SCHEDULED campaigns whose Redis jobs were lost.
- Send rate: 60ms → configurable `CAMPAIGN_RATE_DELAY_MS`, floored at 250ms (~240 msgs/min, inside Meta Tier-1).
- Graceful shutdown: SIGTERM/SIGINT closes HTTP server → workers → queues → Redis → Prisma with a hard timeout.
- Redis health check at startup fails fast with a clear message.
- Launch requires ≥1 recipient; recipients only addable to drafts; accurate `added / duplicates / invalidIds` counts (unique constraint makes `skipDuplicates` actually work).

### Webhook tracking (BUG-003/016)
- The worker stores `campaignRecipientId` on each outbound message; `handleStatusUpdate` now updates the **exact** recipient (deliveredAt/readAt/failedAt + status) and increments only the owning campaign — idempotently (verified: duplicate webhooks don't double-count, decoy campaigns untouched). `read` backfills a missed `delivered`.
- Inbound messages match contacts across phone formatting differences (no duplicate contact rows).
- Dead code (empty `updateMany`, unused fetch) removed.

### Data integrity (BUG-004/005/011/012)
- All AI paths (guided + one-shot, onboarding + `/ai/*`) create templates as `PENDING` and campaigns as honest `DRAFT` with zero stats. No fabricated 250/245/190 numbers anywhere; verified by test.
- `/ai/*` mutations verify DB membership and scope updates with `updateMany({ id, workspaceId })`; status changes whitelisted to DRAFT/CANCELLED.

### Contacts / CSV / Segments
- Frontend `authedFetch` no longer forces `Content-Type` on `FormData` (CSV import works end-to-end; verified via real multipart upload).
- Phones normalized to `+digits`; E.164-length validation rejects junk rows; import returns accurate `{ imported, duplicates, invalid, totalRows }` from the real insert count.
- `listSegments` caps contact payloads (200/segment) and returns `contactCount` via `_count`.

### Performance / stability
- `getDeliveryStats`: 14 sequential COUNTs → 1 query + in-memory bucketing.
- Gemini client lazily initialised (no startup crash when `GEMINI_API_KEY` unset); Ollama URL/model via `OLLAMA_URL`/`OLLAMA_MODEL` env.
- `queueMemberInvitedEmail` looks up settings by workspace **ID**, not (non-unique) name.
- Zod validation on auth, campaigns, contacts, segments, templates, workflows, members; consistent error JSON.
- Prisma `directUrl` wired (defaults to `DATABASE_URL`); duplicate env import removed; unused `CHATFLOW_PRO_URL` dropped; workflow controller's dead JSON.parse removed; `connectOwnNumber` validates inputs and strips the encrypted token cleanly.

### Frontend
- **Real routing** (history API): `/`, `/login`, `/register`, `/auth/callback`, `/dashboard/<section>`, `/dashboard/campaigns/create`. Back/forward, refresh, and deep links all work; route guards redirect unauthenticated users.
- Register page implemented (the "Create one free" link was dead); OAuth errors surface on the login page.
- Campaigns: Date column uses the best available timestamp; **View** opens a live detail modal with created/scheduled/launched/completed times, live counters, per-recipient statuses + fail reasons, and a **Cancel Campaign** action; list auto-polls while campaigns are RUNNING/SCHEDULED; badges for Scheduled/Running/Cancelled/Failed.
- Templates: **Edit** (pre-filled modal → PUT), **Preview** (WhatsApp-style bubble), and **Delete** are all wired.
- Number Setup: **Connect with Meta** actually starts Embedded Signup via `/auth/meta/start`; success/error callback params render as banners.
- Header: search box is a real input (Enter → Contacts with query prefilled); notification bell shows live pending templates + running/scheduled campaigns instead of a fake dot.
- "Upgrade Plan" navigates to Payments. Login-required modal navigates to `/login`.
- CreateCampaign: "Send Immediately" no longer leaks a stale schedule time; Save Draft actually saves (with recipients) and reports errors; API error messages surfaced instead of raw response text.
- `wFetch` never throws synchronously; 403 responses pass through so real error messages reach the UI.
- Orphaned prototypes removed: root `app.jsx`, `ChatFlow Pro.html`, `components/` (superseded by `frontend/src`).

### Stale BUGS.md items (already fixed before this sprint)
- BUG-052 (fonts) — Google Fonts are imported in `frontend/index.html`.
- BUG-053 — `React.StrictMode` already present in `main.jsx`.

## Testing
`/home/claude/work/e2e.mjs` (86 checks) ran against a live local stack (PostgreSQL 16, Redis 7, both BullMQ workers): auth/session/rotation, RBAC + workspace isolation, contacts + real multipart CSV import, segments, numbers/templates, AI-agent auth + data integrity, immediate + scheduled + cancelled campaign lifecycles, scheduled-job recovery after Redis wipe, signed webhook delivery/read tracking with idempotency, workflows, analytics, API keys, rate limiting, and CORS. **Result: 86 passed, 0 failed.**

Meta Graph API is unreachable from the test sandbox, so live sends/template review/Embedded Signup were validated at the implementation + error-path level; final live verification needs real Meta credentials.

## Note on the optional `PRISMA_PG_ADAPTER`
`src/lib/prisma.js` supports `PRISMA_PG_ADAPTER=1` (uses `@prisma/adapter-pg` + WASM engine) for environments where Prisma's native engines can't be downloaded. Default behaviour is unchanged; you can ignore or remove it.
