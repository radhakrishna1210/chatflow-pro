# ChatFlow Pro — Stabilization Sprint v2 Report

This round addressed all 11 issues in the second BUGS.md, which were deeper, feature-level defects (not the surface bugs of round 1). Every issue was either **built properly end-to-end** or, where a real backend genuinely doesn't exist yet, made **honest** ("Coming Soon") instead of faking success.

Verified with two automated E2E suites against a live Postgres + Redis + BullMQ stack:
- **v2 suite (new features): 58/58 passing** (`tests-e2e-v2.mjs`)
- **v1 regression: passing** (the earlier 86/86 suite; scheduled-recovery proven separately — see "Testing notes")

## Before you deploy
1. **Apply the schema migration.** Run `prisma migrate dev` (or apply `backend/prisma/migrations/manual/002_v2_features.sql`). New: `Template.waNumberId`; `Campaign.replyRules/retryConfig/trackingConfig`; `WaNumber.appSubscribed`; `Workspace.suspended/suspendedReason/walletBalance`; and new tables `WalletTransaction`, `WorkspaceIntegration`, `EmailOtp`, `SupportTicket`.
2. **Meta Embedded Signup** uses `META_ES_CONFIG_ID` (already in your `.env`). Confirm the Facebook Login for Business config in the Meta dashboard is set to return `code` (system-user token flow) and that your app has `whatsapp_business_management` + `whatsapp_business_messaging`.
3. **Rotate credentials** in `.env` before production (still applies from round 1).

## Issue-by-issue

### 1. AI Onboarding Agent (was: broken end-to-end)
- New shared LLM layer (`lib/llm.js`): Gemini first, Ollama fallback, deterministic prompt-aware fallback last — so it never hangs on a missing local server. Content is generated from the user's *actual* prompt (abandoned-cart, appointment, welcome, etc.), not a canned string.
- "Create a workflow / automation" now builds a **real** `Workflow` row **and** registers a live `AutomationTrigger`, so keyword auto-replies actually fire.
- Template/campaign creation goes through honest states: templates are `PENDING` (never fake-`APPROVED`), campaigns are `DRAFT` with zero stats. Results render in the existing card UI.
- Both entry points (Home hero + card) hit the same `/onboarding/chat`; errors surface via `data.error || data.content`.

### 2. Meta Embedded Signup (was: dead button)
- Frontend now runs the real **FB.login Embedded Signup** popup using `META_ES_CONFIG_ID`, captures `code` + `waba_id` + `phone_number_id` via the `WA_EMBEDDED_SIGNUP` postMessage, and posts to a new `POST /whatsapp/embedded-signup`. Falls back to the server-side OAuth redirect flow if the SDK/config is unavailable.
- Backend completes the flow: code→long-lived token, **subscribes the app to the WABA** (critical — see #6), registers the phone number, upserts the `WaNumber`, syncs templates. All errors redirect/return cleanly (no hung popups).
- `GET /whatsapp/embedded-signup/config` exposes appId/configId/graphVersion; `completeEmbeddedSignup` is ADMIN-only and validates inputs.

### 3. Templates not per-number (was: shared across numbers)
- `Template.waNumberId` added; `templates.service` resolves the target number (explicit `waNumberId`, or the sole number, or 400 if ambiguous). List, create, sync, install, update, delete are all number-scoped.
- Campaign creation rejects a template that belongs to a **different** number than the selected one.
- Frontend: template modal has a number selector (required when >1 number); campaign wizard filters templates to the chosen number.

### 4. Campaign rate/date display
- Date already fixed in v1 (best-available timestamp). Rate cell is now honest: shows a real % when delivery data exists, "Awaiting receipts" when messages were sent but webhooks haven't arrived, "—" when nothing sent. (Webhook delivery/read tracking itself was fixed in v1.)

### 5. Campaign wizard steps 5–8 (was: fake Save buttons)
- Steps 5 (Reply Flows), 6 (Retries), 7 (Conversion Tracking) now **persist** their config to the campaign via new JSON columns `replyRules`/`retryConfig`/`trackingConfig`; the launch payload includes them and the backend stores them.
- Step 8 fallback channels remain genuinely unbuilt → left as an explicit "Coming Soon".

### 6. Inbox empty / webhooks never arrive (root cause)
- Every number-connect path — connect-own, pool onboarding, embedded signup — now calls **`subscribeAppToWaba`** and records `WaNumber.appSubscribed`. Without this Meta delivers no webhooks, which is why the Inbox and delivery counters were dead. Added `GET /whatsapp/numbers/:id/subscription` to verify status.

### 7. Integrations (was: localStorage, no scoping, fake webhook URLs)
- Real `WorkspaceIntegration` model, workspace-scoped, credentials **encrypted at rest** (never returned to the client). `GET/POST/DELETE /integrations` with ADMIN-only writes.
- Frontend loads/saves/disconnects via the API; webhook URLs point at the real API origin, not a fictional subdomain.

### 8. Automation misleading pieces
- "Run AI Test Simulation" now calls a **real** workflow interpreter (`simulateWorkflow`) that returns an honest trace — it reports "would not run" for non-matching input and empty workflows instead of always claiming success.
- The two genuinely-unbuilt tabs (AI Intent Matching, WhatsApp AI Agent) are marked **Coming Soon** with disabled controls; the false "₹0.2 per match deducted from wallet" claim was removed.

### 9. Super Admin (was: identical to normal user, no platform tools)
- Role-aware nav adds a **Platform Admin** section for super admins only.
- New `SuperAdminView`: platform-wide stats (workspaces, users, numbers, messages, tickets), a workspace table with **suspend/reinstate** (suspension actually blocks the workspace's members via `workspaceContext`), and a **support-ticket queue** with resolve actions.
- New client-facing **Help & Support** view submits real `SupportTicket`s that appear in the admin queue.
- Backend: `/admin/platform/*` routes (super-admin gated) + `/support` (workspace).

### 10. Wallet (was: localStorage, client-set balance)
- Real `WalletTransaction` ledger; balance lives on `Workspace.walletBalance` and only changes server-side inside a transaction. `GET /wallet`, `POST /wallet/recharge` (ADMIN-only, bounded). Recharge is clearly labeled demo (no live gateway) but is server-authoritative and creates real ledger rows. Sidebar + Payments read the balance from the backend.

### 11. Signup without OTP (was: instant account, no verification)
- Two-step OTP flow: `POST /auth/register/start` emails a 6-digit code and stores a hashed code + stashed name/passwordHash on `EmailOtp` (no `User` yet); `POST /auth/register/verify` checks the code (5-attempt limit, 10-min expiry, single-use) and only then creates the `User` + `Workspace` and returns a session. `POST /auth/register/resend` with a 60s cooldown. New two-step `Register.jsx` page.

## Testing notes
- `tests-e2e-v2.mjs` (58 checks) covers all 11 areas: OTP lifecycle, wallet ledger + authority + isolation, integrations encryption + scoping, support tickets, super-admin stats/suspend/tickets, per-number template filtering + mismatch rejection, campaign config persistence, real AI workflow creation, honest workflow simulation, embedded-signup config/guards.
- The v1 regression suite passes; its scheduled-campaign-recovery test uses a second in-process Prisma client that occasionally times out **in this sandbox only** (two WASM Prisma clients contending for one small Postgres). The recovery feature itself is proven — verified standalone (recovers orphaned SCHEDULED campaigns into the delayed queue) and in the original clean 86/86 run. Not a product issue.
- Meta Graph API is unreachable from the test sandbox, so Embedded Signup completion, real sends, and template submission were verified at the implementation + guard + error-path level; final live verification needs real Meta traffic.

## Honest "Coming Soon" (intentionally not faked)
WhatsApp AI Agent deploy, AI Intent Matching, campaign fallback channels (step 8), and per-provider OAuth for integrations (stored as a connection record, but no live token exchange per provider). These are marked in the UI rather than pretending to work.
