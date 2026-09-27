# ChatFlow Pro (Spandan) — Deep audit report

Audit of `radhakrishna1210/chatflow-pro` at `master` b4e8fb4, performed on branch `audit/full-deep-audit`. No application code, schema, migration or config was changed. Companion deliverables in this folder:

- `BUG_SHEET.md` and `BUG_SHEET.csv` hold one row per distinct root cause, with the same data in both.
- `FEATURE_MATRIX.md` is the coverage proof, with one row per feature, tab, public API and worker.
- `SECRETS_AND_CONFIG.md` covers credential locations, env variables and deploy config.
- `ROUTE_INVENTORY.md` is the full backend route table with its middleware chains. `FRONTEND_API_CALLS.txt` lists every frontend call site. `route-inventory.mjs` regenerates the route table.

## 1. Executive summary

**Overall health.** The core product is real and mostly well built. Inbound WhatsApp routing follows its documented priority order, per-record tenant isolation holds across all 903 single-record database calls, campaign sends are claim-guarded and idempotent, and inbound webhooks are signature-verified and fail closed. The serious problems cluster in four places:

- **Money.** Several paid send paths are unmetered. Any workspace admin can mint wallet balance through a demo endpoint. The plan quota is never applied to campaign pricing. There is no Razorpay server-to-server webhook.
- **Authorization edges.** API keys, AI drafting routes, CRM customization and the onboarding chat skip role checks. VIEWER and AGENT users can therefore obtain send-capable keys or rewrite workspace configuration.
- **Reliability of campaigns and workflows.** Resuming a paused campaign never sends. Campaigns that were running at a restart are never recovered. Workflow delays live only in Redis.
- **Deployment.** The migration history cannot build a fresh database. Two production stacks share one database. The rate limiter collapses to a single global bucket behind the proxy.

The old audit documents claim "75/75 resolved". Most of the old items are indeed fixed, but several are regressed or still open (see section 4).

### Top 10 most urgent issues

| # | ID | Issue | Why it is urgent |
|---|---|---|---|
| 1 | CF-001 | The demo `POST /wallet/recharge` credits real, spendable balance, up to 100,000 per call, with no environment gate. | Anyone who creates a workspace is its ADMIN and can mint unlimited credit to send paid messages. |
| 2 | CF-002 | The public API `/messages`, the OTP API and the API-key test send are unmetered and leave no Message row. | Paid Meta conversations are sent at the platform's cost. Combined with #4 below, anyone holding a key sends for free. |
| 3 | CF-023 | The `reopen-window` and `inbound-simulate` debug endpoints are live in production and wired into the CRM Sales Inbox buttons. | They forge the WhatsApp 24h window and fabricate inbound messages, which breaks Meta policy and pollutes data. |
| 4 | CF-025 | OAuth consent and `GET /api-keys/authentication` mint send-capable API keys for any member, including VIEWER, AGENT and just-removed members. | This bypasses every dashboard role gate, and the keys keep working after suspension (CF-101). |
| 5 | CF-022 | An inbox free-form send outside the window stamps `lastInboundAt = now`, fabricating a new 24h window. | It systematically breaks Meta's customer-service-window rule and risks the WABA's quality rating or a ban. |
| 6 | CF-005 | The `/api/v1/ai/*` routes skip `workspaceContext`, so VIEWER, AGENT, suspended and EXPIRED workspaces can create templates and campaigns. The onboarding chat also lets any member delete templates and campaigns (CF-021). | Privilege escalation inside a tenant and destructive actions by read-only users. |
| 7 | CF-019 | No migration creates the core tables, because the baseline lives only on another branch. Separately, two production stacks share one database (CF-020). | A fresh environment cannot be built, and duplicated workers and sweeps run against the same data. |
| 8 | CF-011 | Resuming a paused regular campaign never sends, and RUNNING campaigns are never recovered after a restart (CF-012). | Core campaign flow is broken, and the prepaid wallet reservation stays held indefinitely. |
| 9 | CF-008 | The plan message quota is never applied to campaign pricing, so the wallet pays for every campaign message. Automated replies, workflows and sequences are unmetered (CF-007). | Paying customers are overcharged on campaigns while other paths go uncharged. |
| 10 | CF-027 | `TRUST_PROXY_HOPS` is unset in every deploy artefact, so behind the proxy every client shares one rate-limit bucket. | A handful of wrong passwords or signups can lock the whole platform out of login, signup and reset. |

The following are also Critical or High and should be scheduled with the list above:

- **Campaign reply attribution never works.** A temporal-dead-zone (TDZ) `ReferenceError` is thrown and swallowed (CF-024).
- **Sequences fake success.** The worker records Meta failures as DELIVERED (CF-028).
- **OTP campaigns send the wrong content.** They ignore the campaign's own template and number (CF-013).
- **Record visibility leaks.** OWN/TEAM visibility is dropped whenever a filter is applied (CF-015).
- **The contact limit is not enforced.** Every CRM path that creates contacts skips it (CF-016).
- **Test runs can hit a real database.** `npm test` writes to whatever database `.env` points at (CF-029).

### Counts

| Severity | Count |
|---|---|
| Critical | 2 |
| High | 27 |
| Medium | 92 |
| Low | 95 |
| Info | 11 |
| **Total distinct issues** | **227** |

| Category (status) | Count |
|---|---|
| SECURITY | 41 |
| RELIABILITY | 36 |
| PARTIAL | 31 |
| BROKEN | 22 |
| TECH-DEBT | 17 |
| DOCS | 16 |
| DATA | 15 |
| UX | 13 |
| PERF | 12 |
| FAKE/STUB | 11 |
| BILLING | 8 |
| MISSING | 5 |

## 2. Methodology and limits

**What was done**

1. **Inventory.** A script parsed every router file mounted from `routes/index.js`. It found 492 routes and recorded each one's middleware chain in `ROUTE_INVENTORY.md`. A grep catalogued 380 frontend call sites (`FRONTEND_API_CALLS.txt`), which were then diffed against the routes after normalising path parameters.
2. **Area audits.** Nine areas were audited in parallel by sub-auditors: auth and secrets, tenant isolation and injection, billing, messaging and workers, CRM, AI/automation/connect, core modules, frontend, and data/config/tests/docs. Each area read the routes, controllers, services, schema and matching views in full and traced UI actions to the endpoint and on to the database. I own the deduplicated result.
3. **Tenant-isolation sweep.** All 903 `findUnique`/`findFirst`/`update`/`delete`/`upsert`/`updateMany`/`deleteMany` calls were extracted and triaged by script. The 393 with no workspace key were traced by hand where they sit in priority models.
4. **Core flow traces.** The inbound message chain, status webhooks, every send path (see the send-path matrix), campaigns, billing, auth and workflows were traced line by line.
5. **Independent re-verification.** I re-verified the headline claims myself: the attribution TDZ, the ungated demo recharge, the production debug endpoints and their UI callers, the missing baseline migration, the token denylist's Redis behaviour and whether the onboarding chat is reachable.
6. **Tests.** The unit tests were run with a throwaway env file outside the repo, pointing at unreachable localhost DB and Redis instances.
7. **Old audits.** Every item in the eight older audit documents was re-checked against the code.

**Test results.** The results below are from Node v24 with dummy env values.

| Suite | Result |
|---|---|
| `src/**/*.test.js` (unit) | 365 tests: 183 pass, 4 fail, 178 skipped because they need a database |
| The 4 failures | All in `aiAgents.service.test.js`, which has no database guard ("Can't reach database server") |
| `tests/otp-scope.test.mjs` | 3 / 3 pass |
| `tests/prisma-schema-canonical.test.mjs` | 10 / 11 pass (the main checkout's generated Prisma client is stale) |
| `frontend/src/pages/stepChange.test.mjs` | 6 / 6 pass, but against a hand-copied function that has drifted (CF-134) |

**Limits**

- **No runtime verification.** No local Postgres, Redis or Docker was available, so the backend was never booted. IDOR, role and race findings come from static traces. Findings are marked Confirmed when the full code path was traced, and Likely otherwise.
- **No external calls.** Nothing called production, Meta, Razorpay, Twilio, SMTP or Gemini, and no `prisma migrate` or `db push` was run.
- **Dependency audit inconclusive.** `npm audit` could only run offline and returned "0 vulnerabilities" without an advisory database. Dependency findings come from lockfile versions compared with public advisories.
- **Live settings unseen.** The live Render and VPS environment settings could not be inspected. CF-027 and CF-020 are therefore Likely.
- **Playwright not run.** The Playwright suite targets production and was deliberately not run.

## 3. Findings by area

Each section summarises its area and names the most important findings. `BUG_SHEET.md` holds the full evidence, reproduction steps and fixes.

### A. Security

**Authentication and sessions.** The core is well built:

- Email-OTP signup uses a CSPRNG and sha256 with timing-safe compares, single-use atomic consumption and a 5-attempt lockout.
- Login and reset are protected by failure-only per-email and per-IP limiters.
- The Google OAuth state is HMAC-signed.
- The one-time `/auth/exchange` code and the access-token jti denylist both work.

The weaknesses:

- **Refresh tokens.** They are stored in plaintext, have no reuse detection, and every refresh re-scopes the session to the earliest-joined workspace (CF-042).
- **Impersonation.** Impersonated sessions look like real ones and last 7 days (CF-032). On the frontend, impersonation leaks into the admin's other tabs (CF-108).
- **Google OAuth.** The state is not bound to the browser that started sign-in (CF-128).
- **Account enumeration.** Accounts can be enumerated through the forgot-password cooldown and login timing (CF-129).
- **Redis outage.** Access-token revocation fails open when Redis is unavailable (CF-133). Separately, enqueues hang during an outage (CF-098).

**Authorization and tenant isolation.** Per-record isolation holds. The only exploitable unscoped lookup is a carousel `_assetId` in user-supplied template JSON (CF-110). The problems are role checks:

- **Role floor.** `roleCapabilities` applies a prefix-based floor, which makes `authorize('AGENT')` dead and lets AGENT trigger paid sends (CF-041).
- **Missing admin checks.** 104 of 221 workspace write routes have no `authorize()`. Security-relevant settings, API keys and WhatsApp connect are CLIENT-writable (CF-131, CF-150).
- **Specific routes.**
  - The `/ai/*` routes bypass `workspaceContext` entirely (CF-005).
  - The Customize Your Business PUT and reset endpoints are open to VIEWER (CF-014).
  - The AI Agents studio routes are open to VIEWER (CF-037).
- **CRM permission matrix.** It is never enforced; `requireCrmPermission` has no callers (CF-078).
- **Record visibility.** Scope is applied inconsistently: it is dropped when filters are applied (CF-015) and missing on sibling surfaces, tasks, the overview and convert (CF-079, CF-071).
- **Owner references.** Owner and team ids are never checked for membership (CF-072).
- **Super-admin audit.** 14 of 22 super-admin writes are unaudited, including platform credentials and the Meta webhook callback (CF-107).

**API keys and public API.**

- Keys are hashed and scoped.
- Issuance is not role-gated (CF-025, CF-006).
- Key authentication ignores workspace suspension and subscription state (CF-101).
- There is no rate limit on the public API or the OTP API, and OTP has no per-recipient cooldown (CF-102).
- `POST /public/webhooks` bypasses Zod (CF-103).
- CORS reflects any origin on `/api/v1/public`, which is acceptable because no credentials are involved.

**OAuth provider.** Redirect_uri matching is exact, the code claim is atomic and the client secret compare is timing-safe. Two notes: there is no PKCE, and revoke is not scoped to the calling client (CF-225).

**Webhooks.** Meta and Instagram use HMAC over the raw body with a timing-safe compare and fail closed. Twilio uses `validateRequest` and fails closed. Two issues:

- The verify handshake echoes the challenge as text/html (CF-213).
- Processing after the 200 is fire-and-forget, so a failure loses the event (CF-116).

**Injection and XSS.** No issues. Raw SQL uses tagged `$queryRaw` only. CSV exports neutralise formulas. The widget script only interpolates `JSON.stringify(origin)` and renders with `textContent`. The only frontend HTML sinks are static or escaped.

**SSRF.** Outbound requests are the main weakness:

- The outgoing webhook dispatcher and "Send test" have no guard, and the test acts as a port-scan oracle (CF-105).
- Webhook retries are in-memory, unbounded, and signed with an empty default key (CF-106).
- Template media recovery fetches any URL from template JSON (CF-111).
- The knowledge indexer uses a hostname-only guard (CF-117).
- The crawler has a DNS-rebinding window (CF-214).

**Uploads.** Up to 100 MB is buffered in memory, there is no docx decompression cap, and CRM import bypasses the upload guard (CF-115). Multer is on the deprecated 1.x line (CF-085).

**Secrets and crypto.**

- No live credential was found in the tree or history (CF-227).
- AES-CBC has no MAC and no rotation path (CF-104).
- Request logs persist tokens and codes (CF-100).
- The Razorpay compare uses `===` (CF-136).

**Prompt injection.** Contained. Copilot writes need an explicit confirm routed through the ordinary services. The WhatsApp and campaign AI have no tools. The autonomous agent runs a fixed action set. Copilot does send the user's email to Gemini (CF-123).

**Frontend.** There are no open redirects. Tokens live in localStorage, and the `user` object carries a `superAdmin` flag that the server re-verifies (CF-223).

### B. Payments, billing, quota and wallet

**Sound.** The campaign reservation, the per-recipient claim and settlement, the wallet ledger's idempotency keys, the Razorpay amount (computed server-side from order notes, with correct paise conversion) and the billing renewal worker all check out.

**Broken.**

- **Demo recharge.** It mints real balance (CF-001).
- **Unmetered sends.**
  - The public API, OTP API and API-key test send (CF-002).
  - Automated replies, workflows and sequences (CF-007).
  - SMS fallback, which also ignores opt-out (CF-056).
- **Plan quota ignored.** Campaigns never use the plan's message quota (CF-008).
- **Razorpay.** There is no server-to-server webhook, and checkout verification is non-transactional with no unique invoice reference (CF-009).
- **Plans.**
  - Boot seeding overwrites admin plan edits (CF-010).
  - There is no plan change, cancel or downgrade API (CF-049).
  - Plan feature flags are almost entirely unenforced; `requireFeature` is mounted on only 3 routers (CF-051).
  - The contact limit is bypassed by every CRM path that creates contacts (CF-016).
- **Add-ons.** They do not stack, never renew and silently expire (CF-030).
- **Renewals.** There is no customer-facing renew action (CF-050).
- **Revenue reporting.** Admin revenue double-counts wallet top-ups (CF-031).
- **Billing details.** GST details are stored only in localStorage (CF-052).

**Send-path metering matrix**

Legend: metered = quota/wallet via `consumeMessageCredit`; opt-out = `OptOut` table (`isOptedOut`/`assertNotOptedOut`) vs `Contact.optedOut`.

| Path | file:line | Metered? | Released on failure? | Idempotent under retry? | 24h window checked? | Opt-out checked | Message row stored? | Notes |
|---|---|---|---|---|---|---|---|---|
| Inbox text reply | `backend/src/services/conversations.service.js:197-293` (credit :233, release :252) | quota→wallet (flat `overageRatePerMsg`) | Yes | No (double POST = 2 sends; acceptable) | Local state read only; Meta authoritative (131047 → 409) | OptOut table (:223) | Yes (:255) | Syncs `lastInboundAt` when Meta accepts a free-form send (:277) |
| Inbox media | `conversations.service.js:296-390` (credit :328, release :350) | quota→wallet | Yes | No | Same as text | OptOut (:323) | Yes | 2 Meta calls (upload+send); credit released if either fails |
| Inbox template | `conversations.service.js:392-480` (credit :428, release :463) | quota→wallet by template category | Yes | No | N/A (templates allowed outside window) | OptOut (:414) | Yes | Also the workflow "send template" action (`workflowEngine.service.js:210`) |
| Campaign launch (reservation) | `services/campaigns.service.js:603-810` (debit :709) | Wallet only: `valid × category rate` prepaid; **plan quota not applied to price** | Refund via `settleCampaignRefund` (:1096) on cancel/fail/complete | Yes: `chargedAt:null` claim (:698) + `campaign_charge_<id>` idempotency key (:714) | N/A (templates) | Both (`analyseAudience` → `Contact.optedOut` + OptOut set, :409/:453) | Per recipient (worker) | Estimate `/campaigns/estimate` uses same `priceAudience` (:506) → consistent |
| Campaign per-recipient send | `workers/campaign.worker.js:430-600` (credit :451, release :606, claim :560) | quota (`prepaid:true` → never wallet) | Yes | Yes: PENDING→SENDING claim (:423), `claimRecipientCharge` billedAt guard (`campaignBilling.service.js:239`) | N/A | OptOut per recipient (:438) | Yes (:583) | Well designed |
| Campaign retry | `campaign.worker.js:140-345` (credit :194, release :338) | quota (prepaid) | Yes | Yes: RETRYING→IN_PROGRESS claim (:177), deterministic jobId (`retry.service.js:263`) | N/A | OptOut (:165) | Yes (:315) | Auth campaigns route via `sendAuthenticationOtp` |
| CRM segment bulk launch | `services/crmSalesInbox.service.js:133-165` | via `launchCampaign` (wallet) | via campaign settlement | via campaign claim | N/A | `Contact.optedOut` at audience review (:82) + campaign launch checks | Yes (worker) | OK |
| Fallback SMS (Twilio) | `services/fallback.service.js:46-60` | **None** | N/A | No (runs once per permanent failure) | N/A | **None** (WhatsApp STOP does not stop SMS) | **No** | Platform pays Twilio; customer pays nothing |
| Fallback email | `fallback.service.js:62-76`, `workers/email.worker.js` | None (fine — transactional email) | N/A | BullMQ retries | N/A | None | No | Low concern |
| Sequences | `workers/sequence.worker.js:15-84` | **None** | N/A | Engine step cursor | **None** | `Contact.optedOut` only (:21) — not OptOut table | Yes, but `status: 'DELIVERED'` when Meta send failed/skipped (:73) | Fake success rows |
| Workflow "message"/"buttons"/reminder | `services/workflowEngine.service.js:262,307,651` → `outbound.service.js:35` | **None** | N/A | N/A | Local `lastInboundAt` (`outbound.service.js:64`) | OptOut (:53) | Yes (:107) | |
| Workflow "template" | `workflowEngine.service.js:210` → inbox template | quota→wallet | Yes | No | N/A | OptOut | Yes | Unattended wallet spend by workflows |
| Keyword/welcome/OOO auto-replies, AI agent, forms, campaign AI | `webhook.service.js:597,818`, `campaignAi.service.js:491`, `whatsappForms.service.js:218`, `workers/workflow.worker.js:52` → `sendAutomatedReply` | **None** | N/A | N/A | Local window | OptOut | Yes | Free-form replies inside window; Meta bills these conversations |
| Public API `POST /api/v1/messages` | `routes/public.routes.js:36` → `services/whatsapp.service.js:565-632` | **None** | N/A | No | No (Meta rejects) | OptOut (:579) | **No** (no Conversation/Message) | No suspension/subscription check in `authenticateApiKey.js`; raw client `template` object forwarded to Meta (:623) |
| OTP API `POST .../authentication/otp` | `authentication/authentication.service.js:230-330` | **None** | N/A | N/A | N/A | OptOut (:256) | No (AuthenticationTransaction only) | Paid AUTHENTICATION template sends, unmetered |
| API-key playground test send | `services/apikeys.service.js:380-530` | **None** | N/A | No | No | OptOut (:398) | **No** | Any CLIENT can send free templates to any number |
| Instagram DM / comment reply | `services/instagram.service.js:205-225` | None (not WhatsApp) | N/A | N/A | N/A | None | No | Info |
| Voice | `services/voice.service.js` | No outbound messaging | — | — | — | — | — | N/A |
| Widget | `services/widgetPublic.service.js:381` | Inbound only | — | — | — | — | Inbound row | N/A |
| Agent/copilot tools | `services/agent.tools.js` | No send tool found (only reads `optedOut` :59) | — | — | — | — | — | N/A |

### C. Features that exist but don't work

`FEATURE_MATRIX.md` gives a verdict for every module. The notable functional failures:

- **Home.**
  - The onboarding chat is live and dangerous. It creates templates and campaigns with raw Prisma calls, bypassing validation and limits (CF-090).
  - The upgrade banner is hard-coded (CF-194).
- **Inbox.**
  - The list is capped at 20 conversations with client-side filters (CF-091).
  - There are no loading or error states (CF-199).
  - The note-delete and bot-toggle endpoints have no UI (CF-198).
- **Campaigns.**
  - Wizard steps 6 (Reply Flows) and 8 (Conversion Tracking) are saved but never executed (CF-054).
  - The segment tab is disabled (CF-143).
  - There is no report export (CF-144).
  - Pause and resume are broken (CF-011).
- **Templates.** Editing an approved template never reaches Meta (CF-112).
- **API keys.** The "Send test message" button returns 404 (CF-040).
- **OTP product.** The KPIs are all-time, and the filters only apply to the last 20 transactions (CF-043).
- **CRM.**
  - Bulk "create task" always fails (CF-017).
  - Saving a view always returns 400 (CF-018).
  - Most custom-field types cannot be created (CF-063).
  - Structured engagement fields are stripped (CF-066).
  - The deal stage filter drops deals that have custom fields (CF-065).
  - The forecast weights custom stages at 10% (CF-068).
  - Ticket SLA is not computed (CF-081).
  - Quotes have no send, PDF or expiry (CF-160).
  - Lead scores are never refreshed (CF-075).
  - The Integration Health modal shows fabricated values (CF-077).
- **AI.**
  - The AI Agents studio's `qualify_lead` always fails (CF-003).
  - The studio's test lab returns hard-coded investment-fund replies with a fake model name (CF-035).
  - Studio channels are configuration-only (CF-036), and the UI falls back to fabricated "Connected & Active" channels (CF-039).
  - The WhatsApp AI Agent deploy control is reachable only by a deep link (CF-038).
- **Automation.**
  - The workflow `missed` trigger has no emitter (CF-045).
  - `nodes: z.any()`, silent truncation at 20 steps and unused `edges` (CF-044).
- **Connect.**
  - 6 of 9 integration cards report CONNECTED but never sync (CF-060).
  - The lead-capture toggle is a no-op (CF-061).
  - The rate-limit monitor shows a fabricated limit (CF-151).

**Route inventory summary**

| Measure | Count |
|---|---|
| Routes mounted | 492 |
| Workspace-scoped (`/workspaces/:workspaceId/*`) | 357 |
| Workspace-scoped writes | 221 |
| Writes with no `authorize()` (they rely on the `roleCapabilities` prefix floor) | 104 |
| Writes with no `validate()` | 144 |
| Non-workspace routes (public, webhook, auth, admin, OAuth, widget, forms, assistant) | 135 |
| Routes with a rate limiter | 36 |
| Routes behind `requireFeature` (3 routers) | 24 |

**Workspace-context gaps.** Workspace-scoped routes without `workspaceContext` are the integration OAuth callback (state-verified) and the invitation-token routes, which are public by design. Separately, the `/api/v1/ai/*` routes are mounted outside the workspace router and skip it entirely (CF-005).

**Frontend↔backend contract mismatches**

- **Frontend calls with no backend route.** There is one: `POST /workspaces/:id/api-keys/test-message`, used by the API Keys playground (CF-040). All other flagged calls were false positives from template-literal paths.
- **Method mismatches.** None.
- **Backend routes nothing in the UI calls.** There are 169, including the public API, webhooks and OAuth. The notable ones:
  - `/wallet/recharge` and `/members/invite`
  - `/ai/template|campaign/*` and `/workflows/compile`
  - `/notifications/unread-count`
  - cluster update/delete and `/blocked-numbers` create/delete
  - conversation note delete and the bot toggle
  - `/templates/:id/duplicate` and `/contacts/export`
  - `/pipeline-stages/reorder` and `/widgets/:id/rotate-key`
  - the `/custom/*` duplicate mount

**Payload contract mismatches** (the frontend sends a shape the validator rejects or strips):

| Finding | Mismatch |
|---|---|
| CF-018 | Saved views send a lowercase plural entity where the validator expects an uppercase singular enum |
| CF-063 | Custom-field type enum |
| CF-066 | Engagement fields are stripped by Zod |
| CF-017 | Bulk tasks send a `priority` column that does not exist |
| CF-061 | `autoLeadFromReply` is stripped |

### D. Messaging correctness (WhatsApp / Meta)

**Core inbound flow trace**
Request → `POST /api/v1/webhooks/meta` → `controllers/webhook.controller.js:16 receive` (HMAC check :25-38; **responds 200 at :41, then** `processWebhook(...).catch(log)` :43) → `services/webhook.service.js:22 processWebhook` (loops entries/changes; template status :30, category :38, `value.messages` → `handleInboundMessage` :45, `value.statuses` → `handleStatusUpdate` :51).

`handleInboundMessage(value, msg)` — `webhook.service.js:228`:

| # | Step | Function / file:line |
|---|---|---|
| 1 | Parse Meta shape → `{type, body, media, location, buttonPayload}` | `inboundMessage.js:82 parseInboundMessage` (called :237) |
| 2 | Resolve `WaNumber` by `metaPhoneNumberId`; drop if none | :252-256 |
| 3 | Contact lookup: exact 3 forms :262-271; fuzzy `contains: tail` + exact-digit filter :272-280; create-or-recover on P2002 :296-306 | |
| 4 | Conversation find / create-or-recover (`ensureConversation`) | :311-340 |
| 5 | Campaign attribution lookup (**references `workspaceId` before its `const` at :410 → TDZ, caught :365**) | :354-369 |
| 6 | Persist INBOUND `Message` (P2002 on `metaMessageId` → duplicate → return) | :370-396 |
| 7 | `conversation.update` unread+1, `lastMessageAt`, `lastInboundAt=sentAt` (status NOT changed) | :398-408 |
| 8 | Exit `exitOnReply` sequence enrollments | :413-428 |
| 9 | `emitWebhook('message.received')` (fire-and-forget) | :432 |
| 10 | **Opt-out**: `matchOptOutKeyword` only if `carriesCustomerText` :455-456; `cancel/quit/end` deferred when form/run open :464-473; `recordOptOut` + notify; `return` | :475-502 |
| 11 | **Lead capture** `captureReplyAsLead` (fire-and-forget) | :508 → `campaignLeads.service.js:113` |
| 12 | Load workspace automation flags | :510-528 |
| 13 | **Human handoff**: `conversation.humanHandoffAt` → `return` (no reply at all) | :545-549 |
| 14 | **Control commands** (`detectControlCommand`, `interruptsFlow` — `conversationControl.service.js:93`): `human` → cancel form/runs, `escalateToHuman`, return; other commands only when a form/run is open → cancel runs, reply `CONTROL_REPLIES` unless the form owns it | :563-608 |
| 15 | **Campaign AI session** `handleCampaignAiInbound` → consumed → return | :610-623 |
| 16 | **WhatsApp Form** `handleFormInbound` → consumed → return | :627-639 |
| 17 | **Workflow**: `resumeAwaitingRun` (`workflowEngine.service.js:742`) else `runWorkflowsForInbound` (:682, first match only); `workflowWillReply = runs.some(runWillSendMessage)` | :645-660 |
| 18 | **Escalation rules** (`escalationReason`, only if customerText && !workflowWillReply) → `escalateToHuman`, return | :671-683 → `intentRouting.service.js:120,:160` |
| 19 | **Exact keyword trigger** `findMatchingTrigger` → `autoReplyText` | :686-688 |
| 20 | **Intent routing** `routeByIntent` (`intentRouting.service.js:27`): handled → return; replyText / intentHint | :696-709 |
| 21 | **Legacy fuzzy intent** `matchIntent` (skipped if intentHint) | :719-722 |
| 22 | **Welcome / OOO** (`alreadyWelcomed` :832, `isWithinBusinessHours` `businessHours.service.js:131`, `wasClosed`) | :728-748 |
| 23 | **Built-in general intents** `detectGeneralIntent` → `generalIntentReply` :855 | :759-767 |
| 24 | **AI agent** `generateAgentReply`; none → `escalateToHuman` only if `aiAgentEnabled`; return | :777-815 |
| 25 | `sendAutomatedReply` (`outbound.service.js:35`: OptOut table :53, window :64, decrypt+send in try :76-96, mark number unreachable on 190/100-33 :92, store OUTBOUND SENT :107, `lastMessageAt` :120) | :817-824 |
| 26 | `scheduleDelayedResponse` → `enqueueDelayedResponseCheck` (`workflow.queue.js:403`, jobId `delayed__<conv>`) → `workflow.worker.js:272 processDelayedResponse` | :826, :888-898 |

Verdict on the documented order: **Confirmed** — the code runs opt-out → lead capture → human handoff → control commands → campaign AI → form → workflow resume/run → escalation → exact keyword → intent rules → legacy fuzzy → welcome/OOO → general intents → AI agent → sendAutomatedReply. Short-circuits: steps 10, 13, 14, 15, 16, 18, 20 (handled), 24 (no answer) all `return` before 25 (26 still runs on most). Swallowed errors: steps 5, 8, 11, 15, 16, 17, 20, 21, 24 all catch-and-continue. Double-reply guards: `workflowWillReply` suppresses 18-24; a workflow that ran but sent nothing (tag/CRM-only) still lets keyword/AI answer (by design). Note `resumeAwaitingRun` (step 17) is fed `messageBody` even for media placeholders such as `[photo]`, so a photo answers a `wait_reply` question with the literal placeholder.

**Status webhook trace**
`handleStatusUpdate(status)` — `webhook.service.js:900`:
1. `metaMessageId` required :901-902; `newStatus` lower-cased :904; `eventTime` from Meta ts :905-908.
2. `delivered|read` → `AuthenticationTransaction.deliveredAt` set once (`deliveredAt: null` guard) :914-932.
3. `Message.findUnique({metaMessageId})` (unique — `prisma/schema.prisma:634`) :934-940; no row → return. Campaign-worker rows carry it (`campaign.worker.js:593`, :322); `sendPublicMessage` and sequence-worker failures persist no/`null` id → status events dropped.
4. Message status: RANK PENDING<SENT<DELIVERED<READ; regressions ignored; **FAILED always wins, even over READ** :949-973; error code/title stored on FAILED.
5. `emitWebhook('message.status')` :976-984.
6. Campaign bookkeeping only when `campaignRecipientId` :988-994:
   - `delivered`: `updateMany` guarded by `deliveredAt: null` → `status: DELIVERED`, `campaign.delivered++` :996-1006 (idempotent; overwrites RETRYING/FAILED unconditionally — CF-146/CF-057).
   - `read`: guarded by `readAt: null` → `status: READ`, back-fills `deliveredAt`, increments read (+delivered) :1007-1026.
   - `failed` and `!recipient.failedAt` → `handleRecipientFailure` (`retry.service.js:212`): non-retryable/max/expired → FAILED, `markRecipientNotCharged`, SMS/email fallback (`fallback.service.js:402`), `checkAndCompleteCampaign`; retryable → RETRYING + `campaignQueue.add('retry-recipient', {jobId: retry:<id>:<n>})`. A repeated `failed` for a RETRYING recipient re-enters (failedAt still null) and re-adds the same jobId → BullMQ dedupes → idempotent. The jobId contains two colons; BullMQ 5.76.6 only rejects ids whose `split(':').length !== 3` (`node_modules/bullmq/dist/cjs/classes/job.js:1036-1040`), so this id is accepted.
   - `sent`: message row only; recipient untouched (set SENT by the worker at send time).
7. Counters are reconciled from recipient rows only at completion (`reconcileCampaignCounters`, `retry.service.js:20`).

**Findings.**

- Campaign attribution TDZ (CF-024).
- Fabricated 24h window (CF-022) and the production debug endpoints (CF-023).
- The public API crashes on a missing template (CF-026).
- Sequences fake DELIVERED (CF-028).
- Closed conversations never reopen on inbound (CF-092).
- A decrypt failure leaks a credit (CF-093).
- Events are lost after the ACK (CF-116).
- Parallel automation for one conversation (CF-094).
- `Contact.optedOut` and the `OptOut` table are consulted by disjoint paths (CF-205).
- FAILED overrides READ, and a late delivered/read overrides RETRYING (CF-146).
- National-format numbers create duplicate contacts (CF-200).
- Media inbound is never automated (CF-224).

Template parameter building and button limits were verified sound.

### E. Background jobs, reliability and concurrency

**Campaigns.**

- Resume never sends (CF-011).
- RUNNING campaigns are not recovered (CF-012).
- A throw after the retry claim leaves the recipient IN_PROGRESS (CF-057).
- Pause does not stop retries (CF-058).
- OTP campaigns ignore their own template and number (CF-013).
- A throw after Meta accepted the message causes a duplicate send (CF-055).
- Retry recovery is boot-only and excludes PAUSED campaigns (CF-147).

**Workflows.**

- Delays live only in Redis (CF-120).
- `advanceRun` has no claim or lock (CF-121).
- There is no CANCELLED status (CF-216).

**Infrastructure.**

- A pool of 3 connections serves about 19 worker slots plus HTTP (CF-097).
- A Redis outage hangs requests (CF-098).
- `NODE_ENV` defaults to development (CF-095).
- A failed boot migration only logs (CF-096).
- Shutdown misses the agent worker (CF-099).
- The agent sweep takes the first 500 workspaces unordered and includes suspended ones (CF-047).
- Invite acceptance races on seat and use counts (CF-109).
- Swallowed promises hide money and data loss (CF-082).
- Job-id builders and their test have drifted (CF-208).
- Workers run inside the HTTP process (CF-119).

**Sound.** The billing renewal worker is idempotent (ledger key plus a re-read inside the transaction). Campaign cancel and refund work. Email retries are sane.

### F. Data model, migrations and data integrity

- **No baseline migration.** The migrations cannot build a fresh database: 59 of 82 models and 20 enums are never created, and migration 20260907 depends on the hand-run `manual/004` SQL (CF-019).
- **Missing indexes.** Campaign has no index at all. Invoice, Conversation `(workspaceId, lastMessageAt)` and `RefreshToken.userId` also lack them (CF-084). The suspected `Message(conversationId, createdAt)` gap is refuted: `(conversationId, sentAt)` exists and matches the queries.
- **Cascades.** Required foreign keys with no `onDelete` block user, template and workspace deletion (CF-083).
- **Invoice money type.** `Invoice.amount` is a Float defaulting to USD, while all other money is Decimal INR (CF-139).
- **`SavedView` as a key-value store.** It holds 7 unrelated config families with no typing (CF-062).
- **Root schema copies.** The root `schema_*.prisma`, `merge_prisma.py`, `val_*.js` and `cfs_*.js` files are merge scratch copies. `backend/prisma/schema.prisma` is canonical (CF-164).
- **Dead model.** `WhatsAppAuthOtp` is unused (CF-180).

### G. Performance and scalability

- **Unbounded queries.** 176 of 231 `findMany` calls have no `take`, including the deal board, tasks and analytics (CF-048).
- **Campaign worker.** It loads every pending recipient at once and re-reads the campaign row before each send (CF-053).
- **N+1 loops** on import and similar user-triggered paths (CF-153).
- **Workers.** All six run in the HTTP process with about 19 Redis connections per instance (CF-119).
- **Frontend.**
  - Polling never pauses in hidden tabs, and the wallet is polled twice (CF-189).
  - The inbox polls full lists every 4–5 s (CF-197).
  - Code splitting is minimal (CF-183).

### H. Frontend quality, UX and accessibility

- **Role gating.**
  - The same nav is shown to every role (CF-089), and the role badge says "Member" (CF-178).
- **Components.**
  - Invalid `Btn` variants and sizes render unstyled (CF-184), and `Btn` drops pass-through props (CF-187).
  - 13 icon usages reference names that do not exist (CF-185).
- **API layer.**
  - Raw `fetch` calls bypass token refresh (CF-088).
  - `/resources` is missing from `PROTECTED_PREFIXES` (CF-182).
- **React correctness.**
  - `navigate()` is called during render (CF-192).
  - The notifications bell reads a stale `unread` value (CF-191).
- **Reliability.**
  - There is no error boundary, so a stale lazy chunk after a deploy gives a white screen (CF-086).
  - Ten Avatar copies crash on a null name (CF-186).
- **Dead and duplicate code.**
  - The commented-out old router (CF-179).
  - Duplicate `renderView` branches (CF-193).
  - Orphan modules (CF-180).
  - Two `fmtDate` functions (CF-181).
  - A drifted test copy (CF-134).
  - Three AI-agent UIs (CF-038).
- **Accessibility and UX.**
  - Modal has no Escape handling, focus trap or dialog role (CF-087).
  - 44 icon-only buttons have no accessible name (CF-122).
  - The CRM views are desktop-only (CF-190).
  - Several writes fail silently (CF-201).
  - 24 native `alert()`/`confirm()` calls (CF-161).
- **Dependencies.** `react-is@19` sits alongside React 18 (CF-140).

### I. Configuration, deployment and ops

See `SECRETS_AND_CONFIG.md`. In short:

- Two production stacks share one database (CF-020).
- `TRUST_PROXY_HOPS` is unset (CF-027).
- Env variables that are required but unused, and one that is used but missing from the schema (CF-059).
- Dangerous defaults (CF-148).
- Per-process settings overrides (CF-149).
- A liveness-only health check (CF-203).
- No `.env.example` and Node-version drift (CF-171).
- Stray tracked files (CF-209).

### J. Tests and documentation drift

**Tests.**

- They can write to a real database (CF-029).
- There is no coverage for billing, Razorpay, auth refresh, the campaign worker or webhook dispatch (CF-113).
- The e2e scripts call a removed register endpoint, and Playwright defaults to production (CF-114).
- The CRM tests assert mocked or fabricated behaviour (CF-163).

**Documentation.**

- The README describes an older product: 2 workers where there are 6, billing "not implemented", Instagram and Voice "stubs", no CRM or OTP sections, and Node 20 (CF-175).
- `backend/README.md` (CF-169).
- `PUBLIC_API.md` covers 9 of about 20 endpoints (CF-173).
- Copilot tool counts: the docs say 11 read tools, while the code has 9 read and 5 write (CF-167).
- The QA guide (CF-174, CF-166).
- `DEPLOY.md` covers Render only (CF-172).
- The historical audit docs claim everything is resolved (CF-168).
- `TEST_EVIDENCE.md` overclaims (CF-170).
- The CRM docs (CF-156).
- The licence is inconsistent (CF-220).

## 4. Old-audit cross-check

Verdicts per old item. Correction applied: the docs auditor marked the onboarding chat "unreachable". That is wrong: the Home view calls `/onboarding/chat` directly (`frontend/src/pages/Dashboard.jsx:782`), and only the separate `AIOnboardingCard` component is dead. The affected rows below were corrected.

| Doc | Items | Fixed | Regressed / still open | Partial | Not applicable / not re-verified |
|---|---|---|---|---|---|
| BUGS.md (= issue_sheet Part 3 = STABILIZATION_REPORT) | 60 | 53 | 3 regressed (BUG-031 sync-from-meta, BUG-032 connect-own, BUG-059 template/workflow delete: no ADMIN check) | 3 (BUG-008 agent worker not closed, BUG-025 validation, BUG-054 error format) | 1 (BUG-033) |
| BUGS-v2.md (= issue_sheet V2 = STABILIZATION_REPORT_V2) | 11 | 8 | 0 | 3 (wizard steps 6/8 not executed, integrations never sync, automation sub-features) | 0 |
| issue_sheet.md V3 | 4 | 3 | 0 | 1 | 0 |
| OPEN_ISSUES.md | 9 | 3 (OPEN-005, 007, 009) | 4 (OPEN-001 baseline migration not in this branch, 004, 006, 008) | 0 | 2 (OPEN-002 likely resolved, OPEN-003 not re-verified) |
| MIGRATION_AUDIT.md | 14 actionable | 7 | 1 ("250/250 calls resolve" no longer true) | 0 | 6 stale or not re-verified |
| STABILIZATION extra claims | 9 | 3 | 0 | 0 | 6 stale or not re-verified |
| docs/QA-2-FIXES.md | 10 | 7 | 0 | 0 | 3 |

Six issue_sheet "resolution" texts describe code that was never written: React Router, Redis-backed OAuth state and `$queryRaw` analytics.

**Item-level verdicts**

#### A. BUGS.md (issue_sheet.md Part 3 and STABILIZATION_REPORT.md restate the same ids — verdict applies to all three)

| Doc | Item | Claimed status | Verdict now | Evidence |
|---|---|---|---|---|
| BUGS.md / issue_sheet | BUG-001 `.env` with live secrets not excluded | issue_sheet: Fixed (not committed; rotate manually) | Fixed (code side); rotation not verifiable | `.gitignore:7-18` ignores `.env`, `backend/.env`, `.env.bak`, `backend/.env.*`; `git ls-files` returns no `.env*` file |
| BUGS.md / issue_sheet | BUG-002 CORS `*` | Fixed (whitelist) | Fixed (with deliberate exception) | `backend/src/app.js:74` echoes origin only if in `env.CORS_ORIGINS`; `app.js:60-65` reflects any origin for the public API path by design |
| BUGS.md / issue_sheet | BUG-003 webhook status tracking broken | Fixed (`campaignRecipientId` on Message) | Fixed | `backend/prisma/schema.prisma:600,617`; `backend/src/services/webhook.service.js:383,938,988-991` status update keyed by `message.campaignRecipientId` |
| BUGS.md / issue_sheet | BUG-004 onboarding fakes campaign stats | Fixed (DRAFT, zero counters) | Fixed (but see CF-090: raw prisma bypasses plan limits) | `backend/src/controllers/onboarding.controller.js:301,393` `status: 'DRAFT'`, no sent/delivered counters |
| BUGS.md / issue_sheet | BUG-005 AI auto-approves templates | Fixed (PENDING) | Fixed | `onboarding.controller.js:276,353` `status: 'PENDING'` |
| BUGS.md / issue_sheet | BUG-006 Meta OAuth callback unauthenticated | Fixed (HMAC state) | Fixed | `backend/src/routes/auth.routes.js:281` `signState(...)`, `:361` `verifyState(...)` in `/meta/callback` (`:325`); `backend/src/lib/oauthState.js:9-19` HMAC + `timingSafeEqual` |
| BUGS.md / issue_sheet | BUG-007 tokens in redirect URL | Fixed (one-time code + `/auth/exchange`) | Fixed | `backend/src/controllers/auth.controller.js:70` redirects with `?code=` only; `auth.routes.js:132-134` `POST /exchange` |
| BUGS.md / issue_sheet | BUG-008 no graceful shutdown | Fixed | Partially regressed | `backend/src/server.js:396-403` closes 5 workers/queues but not `agentWorker` (started `:313`) nor the agent queue; agent jobs can be cut mid-run on SIGTERM (`:415`) |
| BUGS.md / issue_sheet | BUG-009 60 ms campaign rate | Fixed (250 ms) | Fixed | `backend/src/workers/campaign.worker.js:20` 250 ms per send (~240/min) |
| BUGS.md / issue_sheet | BUG-010 cancelled campaign marked COMPLETED | Fixed | Fixed | `campaign.worker.js:412` re-reads status each loop, `:619-621` keeps CANCELLED |
| BUGS.md / issue_sheet | BUG-011 `totalContacts: 100` hardcoded | Fixed | Fixed | `backend/src/controllers/ai.controller.js:55-62` DRAFT with zero stats |
| BUGS.md / issue_sheet | BUG-012 ai.controller createTemplate APPROVED | Fixed | Fixed | `ai.controller.js:34,102` `status: 'PENDING'` |
| BUGS.md / issue_sheet | BUG-013 `requireAdmin` trusts JWT role | Fixed (deleted) | Fixed | no `requireAdmin` in `backend/src` (grep empty); `backend/src/middleware/authorize.js:44-58` live DB role; `requireSuperAdmin` `:64+` DB-verified |
| BUGS.md / issue_sheet | BUG-014 double WorkspaceMember query | Fixed | Fixed | `authorize.js:47` reuses `req.user.workspaceRoleVerified` set by `backend/src/middleware/workspaceContext.js:8` |
| BUGS.md / issue_sheet | BUG-015 invite email looks up workspace by name | Fixed | Fixed | `backend/src/services/email.service.js:421-425` `where: { id: workspaceId }` |
| BUGS.md / issue_sheet | BUG-016 dead code in handleStatusUpdate | Fixed | Fixed | `webhook.service.js:925-995` — only live updateMany is on `authenticationTransaction`; recipient update is by id |
| BUGS.md / issue_sheet | BUG-017 `/onboarding/chat` unauthenticated | Fixed | Fixed (route authenticated + rate limited; called by the Home onboarding chat, Dashboard.jsx:782) | `backend/src/routes/onboarding.routes.js:10` `authenticate` + rateLimit |
| BUGS.md / issue_sheet | BUG-018 CSV import Content-Type | Fixed | Fixed in `authedFetch`; CSV import itself bypasses it (CF-088) | `frontend/src/lib/api.js:101-105` omits JSON header for FormData |
| BUGS.md / issue_sheet | BUG-019 Prisma `directUrl` missing | Fixed | Fixed | `backend/prisma/schema.prisma:9` |
| BUGS.md / issue_sheet | BUG-020 listSegments returns all contacts | Fixed (`_count`) | Fixed | `backend/src/services/segments.service.js:10-16` `take: SEGMENT_CONTACT_PREVIEW_LIMIT` + `_count` |
| BUGS.md / issue_sheet | BUG-021 getDeliveryStats 14 sequential queries | Fixed (issue_sheet says `$queryRaw`) | Fixed (implementation is one `findMany` bucketed in memory, not `$queryRaw` — claim text inaccurate) | `backend/src/services/analytics.service.js:94-113` |
| BUGS.md / issue_sheet | BUG-022 encryption key utf8 vs hex | Fixed | Fixed | `backend/src/lib/encryption.js:7-13` |
| BUGS.md / issue_sheet | BUG-023 connectOwnNumber returns `encryptedAccessToken` key | Fixed | Fixed | `backend/src/services/whatsapp.service.js:133,201,216,281` destructure it out |
| BUGS.md / issue_sheet | BUG-024 duplicate env import | Fixed | Fixed | `backend/src/server.js:22` single import |
| BUGS.md / issue_sheet | BUG-025 no input validation | Fixed (Zod) | Partially fixed | `backend/src/validators/index.js` exists; but many routes still unvalidated: `backend/src/routes/segments.routes.js:20,22`, AI Agents studio (CF-037), lead bulk (CF-158), `/public/webhooks` (CF-103), workflow `nodes: z.any()` (CF-044), campaign `z.any()` (CF-142) |
| BUGS.md / issue_sheet | BUG-026 refresh expiry hardcoded 7d | Fixed | Fixed | `backend/src/services/auth.service.js:37-41` from `JWT_REFRESH_EXPIRES_IN` |
| BUGS.md / issue_sheet | BUG-027 Google user with no membership crashes | Fixed ("auto-generate workspace") | Fixed (behaviour differs from claim: user gets `workspaceId: null` and is routed to create/accept, no auto-workspace) | `auth.service.js:239-248` null-safe `member?.role`, `member?.workspaceId` |
| BUGS.md / issue_sheet | BUG-028 ai.controller updates lack workspace check | Fixed | Fixed for scoping; role check still missing (CF-005) | `ai.controller.js:7-16` `assertMembership`, `:83-84,100-101` `updateMany where {id, workspaceId}` |
| BUGS.md / issue_sheet | BUG-029 Google OAuth no CSRF state | Fixed (issue_sheet: "validated via Redis") | Fixed (HMAC-signed stateless state, not Redis) | `backend/src/routes/auth.routes.js:152` `signState`, `:170` `verifyState` |
| BUGS.md / issue_sheet | BUG-030 queues share one Redis connection | Fixed | Fixed | `backend/src/queues/{agent,billing,campaign,email,sequence,workflow}.queue.js` each `createBullConnection(...)`; `backend/src/lib/redis.js:85` new client per call |
| BUGS.md / issue_sheet | BUG-031 `sync-from-meta` no `authorize` | Fixed ("authorize('ADMIN')") | Regressed / claim false — no `authorize`; VIEWER/AGENT blocked only by `roleCapabilities`, CLIENT == ADMIN | `backend/src/routes/templates.routes.js:10,29`; `backend/src/middleware/roleCapabilities.js:63-77`; matches CF-131 |
| BUGS.md / issue_sheet | BUG-032 `connect-own-number` no `authorize` | Fixed ("authorize('ADMIN')") | Regressed / claim false — comment at `whatsapp.routes.js:33-37` says "stay admin-only" but no guard exists | `backend/src/routes/whatsapp.routes.js:9,13,15,17`; = CF-150 |
| BUGS.md / issue_sheet | BUG-033 WhatsApp `disconnect` no `authorize` | Fixed (admin only) | Not applicable — deliberately reopened to all members (comment says detaching is safe); claim of admin-only is false | `whatsapp.routes.js:33-38` |
| BUGS.md / issue_sheet | BUG-034 updateSegment mass assignment | Fixed (whitelist) | Fixed (controller still passes raw `req.body`, but route validator is `.strict()`) | `backend/src/routes/segments.routes.js:16`; `backend/src/validators/index.js:176-180`; `backend/src/controllers/segments.controller.js:31` |
| BUGS.md / issue_sheet | BUG-035 updateContactInSegment mass assignment | Fixed (Zod) | Fixed for PATCH; sibling `POST /:id/contacts` is unvalidated but service copies explicit fields only (no mass assignment) | `segments.routes.js:20-21`; `backend/src/services/segments.service.js:67-83` |
| BUGS.md / issue_sheet | BUG-036 wFetch throws synchronously | Fixed | Fixed | `frontend/src/lib/api.js:135` `return Promise.reject(...)` |
| BUGS.md / issue_sheet | BUG-037 App.jsx no routing | Fixed (issue_sheet: "React Router `<BrowserRouter>`") | Fixed via hand-rolled History-API router; React Router claim false | `frontend/src/App.jsx:36-39,154-157` `pushState` + `popstate` |
| BUGS.md / issue_sheet | BUG-038 Gemini client at module load | Fixed (lazy) | Fixed | `backend/src/services/automation.service.js:15` created inside getter |
| BUGS.md / issue_sheet | BUG-039 Ollama URL hardcoded | Fixed (`OLLAMA_URL`) | Fixed | `backend/src/config/env.js:140`; `backend/src/lib/llm.js:194-198` |
| BUGS.md / issue_sheet | BUG-040 expired refresh tokens never cleaned | Fixed | Fixed (opportunistic delete on each token store) | `backend/src/services/auth.service.js:43` |
| BUGS.md / issue_sheet | BUG-041 addRecipients wrong skipped count | Fixed | Fixed | `backend/src/services/campaigns.service.js:455` `skipped: invalidIds.length + duplicates` |
| BUGS.md / issue_sheet | BUG-042 redundant JSON.parse in workflow.controller | Fixed | Fixed | no `JSON.parse` in `backend/src/controllers/workflow.controller.js` (grep empty) |
| BUGS.md / issue_sheet | BUG-043 CSV accepts invalid phones | Fixed | Fixed | `backend/src/services/contacts.service.js:14-17` `isValidPhone`, used `:194` |
| BUGS.md / issue_sheet | BUG-044 phones not normalized | Fixed (E.164) | Fixed for `+digits`; national-format numbers without country code still duplicate (CF-200) | `contacts.service.js:6-11` |
| BUGS.md / issue_sheet | BUG-045 import count misleading | Fixed | Fixed | `contacts.service.js:232-238` returns `imported/duplicates/invalid/totalRows` |
| BUGS.md / issue_sheet | BUG-046 decrypt split(':') fragile | Fixed | Fixed | `backend/src/lib/encryption.js:26-33` structure checks |
| BUGS.md / issue_sheet | BUG-047 login/refresh no rate limit | Fixed ("memory-based") | Fixed (Redis-backed `rateLimit` middleware); public/OTP API still unlimited (CF-102) | `backend/src/routes/auth.routes.js:32-51,70-94` |
| BUGS.md / issue_sheet | BUG-048 cancel can't stop in-progress worker | Fixed | Fixed | `campaign.worker.js:412` per-batch status re-check |
| BUGS.md / issue_sheet | BUG-049 root `app.jsx` dead prototype | Fixed (removed) | Fixed | `app.jsx`, `components/` absent at repo root |
| BUGS.md / issue_sheet | BUG-050 `ChatFlow Pro.html` orphan | Fixed (removed) | Fixed | file absent at repo root |
| BUGS.md / issue_sheet | BUG-051 mailer transporter never re-inits | Fixed | Fixed (rebuilt when config cache key changes) | `backend/src/lib/mailer.js:4-14` |
| BUGS.md / issue_sheet | BUG-052 fonts not imported | Fixed (issue_sheet: "Plus Jakarta Sans and Syne") | Fixed — but fonts are now Space Grotesk/Manrope/JetBrains Mono; claim text stale | `frontend/index.html:10`; `frontend/src/index.css:75,92` |
| BUGS.md / issue_sheet | BUG-053 no StrictMode | Fixed | Fixed | `frontend/src/main.jsx:7-9` |
| BUGS.md / issue_sheet | BUG-054 inconsistent error format | Fixed ("delegated to central errorHandler") | Still open (partial) — 10 controller files still build their own `res.status(...).json({ error })` in catch blocks | e.g. `backend/src/controllers/segments.controller.js:35-36`; grep count 10 files in `backend/src/controllers` |
| BUGS.md / issue_sheet | BUG-055 `CHATFLOW_PRO_URL` unused | Fixed (removed) | Fixed | no occurrence in `backend/src` (grep empty) |
| BUGS.md / issue_sheet | BUG-056 campaign date not shown | Fixed | Fixed | `frontend/src/pages/Dashboard.jsx:1404` `completedAt||launchedAt||scheduledAt||createdAt`; `:1226` |
| BUGS.md / issue_sheet | BUG-057 campaign doesn't run after Launch | Fixed | Fixed (enqueue path present; runtime not re-run here) | `backend/src/services/campaigns.service.js:762-771` `campaignQueue.add`; worker `backend/src/server.js:303` |
| BUGS.md / issue_sheet | BUG-058 Meta Embedded Signup broken | Fixed | Fixed in code (live Meta flow not exercised — no network) | `frontend/src/pages/NumberSetupView.jsx` (FB.login / embedded-signup); `backend/src/routes/whatsapp.routes.js:16-17` |
| BUGS.md / issue_sheet | BUG-059 ADMIN vs CLIENT role conflicts | Fixed ("admin restriction on template/workflow deletes") | Regressed / claim false — `DELETE /templates/:id` and `DELETE /workflows/:id` have no `authorize`; CLIENT can delete | `backend/src/routes/templates.routes.js:34`; `backend/src/routes/workflow.routes.js:17`; see CF-131, CF-089 |
| BUGS.md / issue_sheet | BUG-060 scheduled campaigns don't run | Fixed (`recoverScheduledCampaigns`) | Fixed | `backend/src/services/campaigns.service.js:762-763` delayed job; `backend/src/server.js:31,333` boot recovery |

#### B. BUGS-v2.md #1-11 (= issue_sheet ISSUE-V2-01..11 = STABILIZATION_REPORT_V2 section 1-11)

| Doc | Item | Claimed status | Verdict now | Evidence |
|---|---|---|---|---|
| BUGS-v2 / V2-01 / STAB-V2 s1 | Onboarding AI does not build real workflows | Open in BUGS-v2; Fixed in STAB-V2/issue_sheet | Fixed (corrected by lead auditor) — backend builds DRAFT/PENDING artefacts and the Home onboarding chat (Dashboard.jsx:782) calls it; only the separate `AIOnboardingCard` is dead code (CF-180) | `backend/src/controllers/onboarding.controller.js:276-396`; CF-180, CF-021, CF-090 |
| BUGS-v2 / V2-02 / STAB-V2 s2 | Meta Embedded Signup button dead | Fixed | Fixed in code (not live-tested); routes lack admin guard | `frontend/src/pages/NumberSetupView.jsx`; `backend/src/routes/whatsapp.routes.js:16-17`; CF-150 |
| BUGS-v2 / V2-03 / STAB-V2 s3 | Templates shared across numbers | Fixed (`waNumberId`) | Fixed | `backend/prisma/schema.prisma:324` `Template.waNumberId`; `backend/src/services/templates.service.js:14-32` per-number scoping |
| BUGS-v2 / V2-04 / STAB-V2 s4 | Campaign list: no success rate / date | Fixed | Fixed | `frontend/src/pages/Dashboard.jsx:1404` best date; rate `delivered/sent` computed ~`:1403` |
| BUGS-v2 / V2-05 / STAB-V2 s5 | Wizard steps 5-8 non-functional | Fixed (persisted) | Partially fixed - retry and fallback execute; Reply Flows and Conversion Tracking are persisted but never executed | `backend/src/services/campaigns.service.js:273-277`; `backend/src/workers/campaign.worker.js:12` fallback import; CF-054, CF-142 |
| BUGS-v2 / V2-06 / STAB-V2 s6 | Inbox never gets webhooks (no WABA subscribe) | Fixed | Fixed (subscription best-effort: failure only logged) | `backend/src/lib/meta.js:331`; `backend/src/services/whatsapp.service.js:21-28,347` |
| BUGS-v2 / V2-07 / STAB-V2 s7 | Integrations fake, secrets in localStorage | Fixed (DB + encryption) | Partially fixed - storage server-side/encrypted, but 6 of 9 OAuth cards save a `pending` row reported as CONNECTED and nothing ever syncs | CF-060 |
| BUGS-v2 #8 / V2-08 / STAB-V2 s8 | Automation tab: 7 of 9 sub-tabs fake | Fixed / "Coming Soon" | Mostly fixed - Workflows execute (workflow worker), Intent Matching (`backend/src/services/intent.service.js:66`), WhatsApp AI Agent (`backend/src/services/aiAgent.service.js:376`), Voice/Instagram/Forms real (verified, no issue). Still partial: Smart Lists static only (CF-218), `missed_call` trigger never emitted (CF-045), AI Agents studio test lab fake (CF-035). STAB-V2 s8 "Coming Soon" wording for Intent/AI Agent is stale | as listed |
| BUGS-v2 / V2-09 / STAB-V2 s9 | No Super Admin dashboard | Fixed | Fixed (no issues in audited tabs) | verified, no issue |
| BUGS-v2 / V2-10 / STAB-V2 s10 | Wallet client-side and spoofable | Fixed (server ledger; demo recharge ADMIN-only) | Fixed for client spoofing, but demo `/wallet/recharge` still mints real spendable balance for any workspace ADMIN in production | `backend/src/routes/wallet.routes.js:12`; CF-001 (Critical) |
| BUGS-v2 / V2-11 / STAB-V2 s11 | No email signup / OTP | Fixed | Fixed | `backend/src/routes/auth.routes.js:57-69` `/register/start` + `/register/verify`; old `/register` removed |

#### C. issue_sheet.md Part 1 (Sprint 3 / V3) and headline claims

| Doc | Item | Claimed status | Verdict now | Evidence |
|---|---|---|---|---|
| issue_sheet | ISSUE-V3-01 WhatsApp AI Agent was a mockup | Resolved | Fixed (runtime exists); readiness counts URL sources it never reads, `escalationThreshold` unused | `backend/src/services/aiAgent.service.js`; CF-118 |
| issue_sheet | ISSUE-V3-02 AI Intent Matching mockup | Resolved (`matchIntent`) | Fixed | `backend/src/services/aiAgent.service.js:376`; `backend/src/services/intent.service.js:66` |
| issue_sheet | ISSUE-V3-03 Campaign Fallback Channels | Resolved (SMS/Email) | Fixed, but fallback SMS ignores opt-out and is unmetered | `backend/src/services/fallback.service.js:9`; `backend/src/workers/campaign.worker.js:12`; CF-056 |
| issue_sheet | ISSUE-V3-04 Per-provider integration OAuth | Resolved | Partially fixed - see V2-07 | CF-060 |
| issue_sheet | "All 75 issues resolved"; "86/86, 58/58, 33/33 tests passing" | Resolved | Not accurate - BUG-031/032/059 regressed, BUG-025/054 partial, V2-01 unreachable, V2-05/07 partial. The three suites are root-level scripts (`tests-e2e.mjs`, `tests-e2e-v2.mjs`, `tests-e2e-v3.mjs`) not wired into any npm script; `docs/QA-2-FIXES.md:375` itself records 2 v2 failures | `backend/package.json:14-26`; `docs/QA-2-FIXES.md:375` |
| issue_sheet | Manual step 3 "run `npx prisma migrate dev`" | Instruction | Stale/unsafe - boot runs migrations itself; `migrate dev` against a shared/hosted DB can prompt a reset | `issue_sheet.md:148-153`; `backend/src/server.js` boot |

#### D. STABILIZATION_REPORT.md / _V2 extra claims (not tied to a BUG id)

| Doc | Item | Claimed status | Verdict now | Evidence |
|---|---|---|---|---|
| STAB | "Real routing" + Register page | Fixed | Fixed (hand-rolled History router) | `frontend/src/App.jsx:36-39,154-157` |
| STAB | Templates Edit/Preview/Delete wired | Fixed | Fixed in UI, but editing an APPROVED/PENDING template only updates the local row; Meta never sees it | CF-112 |
| STAB | Header notification bell live | Fixed | Fixed, with stale-closure bug on "mark all read" | CF-191 |
| STAB | "both BullMQ workers"; test path `/home/claude/work/e2e.mjs` | Fact | Stale - 6 workers now (`backend/src/server.js:303-313`); test path is a sandbox path, repo copy is root `tests-e2e.mjs` | `backend/src/server.js:303-313` |
| STAB | Manual: rotate `backend/.env` credentials; add Meta redirect URI | Manual | Not re-verified (external consoles) | - |
| STAB | Manual: `prisma migrate dev` (or `db push`) | Manual | Stale - same as issue_sheet manual step 3 | `STABILIZATION_REPORT.md:9` |
| STAB | Optional `PRISMA_PG_ADAPTER` | Info | Not re-verified | `backend/src/lib/prisma.js` |
| STAB-V2 | "Honest Coming Soon": AI Agent deploy, Intent Matching, fallback channels, per-provider OAuth | Coming Soon | Stale - first three are now built (V3-01..03); OAuth partial | section C |
| STAB-V2 | Testing notes: `tests-e2e-v2.mjs` 58 checks | Passing | Not re-verified (needs live DB); QA-2 doc reports 2 failures | `docs/QA-2-FIXES.md:375` |

#### E. docs/QA-2-FIXES.md

| Doc | Item | Claimed status | Verdict now | Evidence |
|---|---|---|---|---|
| QA-2 | BUG-01 Working hours reset after disable/enable | Fixed | Fixed | `backend/src/services/businessHours.service.js:87` `isBusinessHoursEnabled`, `:94` `mergeBusinessHours`, `:131` |
| QA-2 | BUG-02 Active flow cannot be interrupted | Fixed | Fixed | `backend/src/services/conversationControl.service.js:93` `detectControlCommand`; `backend/src/services/webhook.service.js:574,587` `cancelActiveRuns` |
| QA-2 | BUG-03 General messages inconsistently routed | Fixed | Fixed (static trace) | `conversationControl.service.js:168` `detectGeneralIntent`; `webhook.service.js:18` |
| QA-2 | BUG-04 Synonyms/typos | Fixed | Fixed | `conversationControl.service.js:31` `editDistance`, `:220` `matchOption` |
| QA-2 | BUG-05 Overlapping triggers conflict | Fixed (ordered contract) | Fixed for sequential messages; concurrent inbound webhooks for one conversation still run the chain in parallel, so two layers can both answer | `webhook.service.js:205-224`; CF-094 |
| QA-2 | BUG-06 Smart Lists `phoneNumber` missing | Fixed | Fixed | `backend/src/services/segments.service.js:73-74,110` |
| QA-2 | BUG-07 Welcome repeated/inconsistent | Fixed | Fixed (history-based 24h gap), same concurrency caveat as BUG-05 | `webhook.service.js:20,725-730`; CF-094 |
| QA-2 | BUG-08 Voice AI needs Twilio | Not a code defect | Not applicable (voice service exists; live Twilio not exercisable here) | `backend/src/services/voice.service.js`; verified, no issue |
| QA-2 | "Also fixed": unanswered message switched automation off | Fixed | Not re-verified (prose only, no file cited) | `docs/QA-2-FIXES.md:244` |
| QA-2 | Suite `backend/tests-qa2-automation.mjs` | Exists/passing | Exists; needs `.env` + live DB; not part of `npm test`; pass status not re-verified | `backend/package.json:14` |

#### F. OPEN_ISSUES.md

| Doc | Item | Claimed status | Verdict now | Evidence |
|---|---|---|---|---|
| OPEN_ISSUES | OPEN-001 Migration history cannot be replayed from scratch | RESOLVED 2026-08-17 (squashed into `00000000000000_baseline`, 32 old migrations moved to `prisma/migrations_archive/`) | Still open on this branch - the fix lives only in commit `cc183d8` on `origin/aditya-advanced-crm`, which is NOT an ancestor of HEAD. `backend/prisma/migrations/` has 20 migrations starting at `20260810000000_site_knowledge_index`, no baseline, no `migrations_archive/`, and no migration creates `"Workspace"`; production boot runs `migrate deploy` | `backend/prisma/migrations/` listing; `backend/src/server.js:222`; `git merge-base --is-ancestor cc183d8 HEAD` -> false. See CF-019 |
| OPEN_ISSUES | OPEN-002 Live DB drifted from `schema.prisma` (Widget, IntentRule, KnowledgeSource, AdminAuditLog, ConversationNote, Workspace AI columns...) | Open | Likely resolved in schema (all listed models/columns now in `schema.prisma`); live DB not re-verified (no DB access by rule) | `backend/prisma/schema.prisma:115,122,131,1422,1464,1506,1561,1588,1640,1661` |
| OPEN_ISSUES | OPEN-003 Browser UI verification | Mostly resolved | Not re-verified (no browser run in this pass); frontend defects found statically by other auditors | CF-184..012 |
| OPEN_ISSUES | OPEN-004 Accessibility (no focus trap in Modal, no contrast audit) | Partially resolved | Still open - shared `Modal` has no Escape, focus trap, `role="dialog"` or focus restore | CF-087 |
| OPEN_ISSUES | OPEN-005 `prefers-reduced-motion` | Withdrawn | Not applicable (withdrawal correct) | `frontend/src/index.css:282` |
| OPEN_ISSUES | OPEN-006 No frontend test runner | Open | Still open - `frontend/package.json` has no `test` script or framework. Its note "backend coverage is 22 tests" is stale (about 50 `*.test.js` files now tracked) | `frontend/package.json`; `backend/package.json:14` |
| OPEN_ISSUES | OPEN-007 Uncommitted work and stray files (`backend/query.js`, `query2.js`, `migration.sql`, `open-chrome-profile.mjs`, `.env.bak`) | Open | Fixed / Not applicable - none of the listed files exist in the worktree; CRM work is committed | `ls` of each path -> not found |
| OPEN_ISSUES | OPEN-008 Frontend bundle size | Partially resolved | Still partial - more views are lazy now (`frontend/src/pages/Dashboard.jsx:17,29-34`), but the ones the doc named (`AnalyticsView`, `SuperAdminView`, `AutomationView`) are still eager imports | `frontend/src/pages/Dashboard.jsx:40,41,49` |
| OPEN_ISSUES | OPEN-009 Stale production credential in `backend/.env.bak` | Open | Fixed / Not applicable in this worktree - file absent here (and, per another auditor, absent from the main checkout and from every commit); `.gitignore` now covers it. Rotation of the credential cannot be verified from code | `.gitignore:14-18`; `ls backend/.env.bak` -> not found |

#### G. MIGRATION_AUDIT.md (UI-migration log; actionable items extracted from rounds 1-12)

| Doc | Item | Claimed status | Verdict now | Evidence |
|---|---|---|---|---|
| MIGRATION_AUDIT | Phase 3: "4 workers up", "23 migrations current" | Fact at the time | Stale - 6 workers (`backend/src/server.js:303-313`); 20 migrations in `backend/prisma/migrations/` | as cited |
| MIGRATION_AUDIT | Round 2 "Needs your attention": legal text needs legal review; placeholder contact `legal@chatflowpro.app` | Open | Placeholder contact no longer present (no `legal@`/`mailto:` in `frontend/src/components/LegalCenter.jsx`, `frontend/src/lib/legalContent.js`); legal review of commercial terms (Bengaluru jurisdiction etc.) Not re-verified (business action) | `frontend/src/lib/legalContent.js:45,92` |
| MIGRATION_AUDIT | Round 5: 250/250 frontend calls resolve to a backend route | Verified | Regressed - at least `POST /api-keys/test-message` (API Keys "Send test message") now has no route | CF-040, CF-040 |
| MIGRATION_AUDIT | Round 5: 5 backend routes with no caller "none a defect" | Info | Stale - many more uncalled routes now (e.g. `/workflows/compile`, `/vocabulary`, inbox note delete, bot toggle) | CF-135, CF-198 |
| MIGRATION_AUDIT | Round 6 bug 1: no global link reset | Fixed | Fixed | `frontend/src/index.css:99` |
| MIGRATION_AUDIT | Round 6 bug 2: favicon 404 | Fixed | Fixed | `frontend/index.html:7` |
| MIGRATION_AUDIT | Round 6 bug 3: login legal links `href="#"` | Fixed | Fixed | `frontend/src/App.jsx:233-234` |
| MIGRATION_AUDIT | Round 7: AnalyticsView NaN bar height | Fixed | Fixed | `frontend/src/pages/AnalyticsView.jsx:81` |
| MIGRATION_AUDIT | Round 6/7 "Still unverified": campaign send, wallet recharge, Twilio, OAuth round-trips | Unverified | Not re-verified (external services forbidden in this audit); billing statically covered by F-B-* | - |
| MIGRATION_AUDIT | Round 8: primary button hover `#22d468` | Fixed | Fixed (only a comment remains) | `frontend/src/components/Btn.jsx:15`; note `Btn` still drops variants/props (CF-184, CF-187) |
| MIGRATION_AUDIT | Round 10 "Needs your decision: the domain" (`spandan.pro/bot` crawler UA; `legal@spandan.app`) | Open | Fixed - UA now derived from `env.APP_URL`/`API_PUBLIC_URL`; legal placeholder gone | `backend/src/lib/siteCrawler.js:26` |
| MIGRATION_AUDIT | Round 11/12: Intent Matching / AI Agent showed Automation panel; query-string-only navigation invisible | Fixed | Fixed - router keeps `search` in state | `frontend/src/App.jsx:132-145` |
| MIGRATION_AUDIT | Round 12 "Known remaining edge": `/dashboard/automation?tab=wa-agent` highlights wrong nav | Open (accepted) | Not re-verified (cosmetic, bookmark-only) | - |
| MIGRATION_AUDIT | "Historical reports left alone on purpose" (BUGS*.md, STABILIZATION*, issue_sheet) | Policy | Not applicable - but these docs sit at repo root with no "historical" banner and are read as current status; see CF-168 | - |


## 5. Leads verification (§4 of the brief)

| Lead | Verdict | Evidence |
|---|---|---|
| 1. `webhook.service.js` uses `workspaceId` before its `const`, so the attribution ReferenceError is swallowed | **Confirmed** | `backend/src/services/webhook.service.js:359,361` reference `workspaceId` inside the try that starts at :356. `const workspaceId` is declared at :410, and the catch at :365 logs and continues, so `campaignRecipientId` is always null (CF-024). |
| 2. The demo `/wallet/recharge` is live, and any workspace ADMIN can mint balance | **Confirmed** | `routes/wallet.routes.js:12` + `controllers/wallet.controller.js:20-48`: `authorize('ADMIN')` only, no environment gate, up to 100,000 per call, unlimited calls. The workspace creator is ADMIN. The UI does not call it (CF-001). |
| 3. Unmetered sends: `sendPublicMessage`, the API-key test send, OTP (and no OTP rate limit), `sendAutomatedReply`, the sequence worker | **Confirmed** | Only `campaign.worker.js:194,451` and `conversations.service.js:233,328,428` call `consumeMessageCredit`. `sendPublicMessage` has no window check, no Message row, and crashes without a `template` (`whatsapp.service.js:565-632`). The OTP routes have no `rateLimit` (CF-002, CF-007, CF-026, CF-102). |
| 4. The sequence worker records a Meta failure as DELIVERED, has no 24h check, and checks only `Contact.optedOut` | **Confirmed** | `workers/sequence.worker.js:73` writes `status: 'DELIVERED'` when the send failed or was skipped. There is no window check, and `:21` checks only `contact.optedOut` (CF-028). |
| 5. OTP campaigns ignore the campaign's template and number; stalled jobs leave campaigns stuck in RUNNING; recovery handles only SCHEDULED | **Confirmed and refined** | `authentication.service.js:232` reads only `to` and `campaignId` (CF-013). Refinement: every resumed non-OTP campaign is stuck, because `campaigns.service.js:1044-1048` omits `resume:true` and `campaign.worker.js:388-391` refuses (CF-011). Recovery at `campaigns.service.js:1137` covers only SCHEDULED (CF-012). |
| 6. An out-of-window inbox send sets `lastInboundAt = now`; `reopen-window` and `inbound-simulate` are exposed to members | **Confirmed and refined** | `conversations.service.js:277,377` stamp `lastInboundAt` after Meta accepts a free-form send (CF-022). The debug routes (`conversations.routes.js:25-26`) have no environment gate and no `authorize`, and they are called by the CRM Sales Inbox "Sync Window" and "+ Inbound 'Hii'" buttons (`CrmSalesInboxView.jsx:451,465`) (CF-023). |
| 7. API keys have no `authorize('ADMIN')`; OAuth consent does not re-check membership; `authenticateApiKey` has no suspension or rate-limit check | **Confirmed** | `apikeys.routes.js:9-40` (CF-131). `oauth.controller.js:131-176` mints a key from the JWT's `workspaceId` (CF-025). `GET /api-keys/authentication` returns a send key to any role (CF-006). `authenticateApiKey.js:17-52` never loads the workspace (CF-101), and there is no limiter (CF-102). |
| 8. `requireCrmPermission` has no callers; `roleCapabilities` contradicts the matrix; crmCustomization PUT and reset have no `authorize` | **Confirmed** | CF-078, CF-041, CF-014. |
| 9. `POST /public/webhooks` builds a mock req that bypasses Zod; no SSRF guard; in-memory retries | **Refined (all parts hold)** | CF-103 (Zod bypass). CF-105: no IP or DNS check in dispatch or test, and the test follows redirects and acts as a port-scan oracle. CF-106: `setTimeout` retries and an empty default signing key. |
| 10. `verifyCheckoutPayment` is non-transactional; `Invoice.reference` is not unique; there is no Razorpay webhook; the compare uses `===`; add-ons overwrite; `PATCH /subscription` is missing | **Confirmed and refined** | Confirmed: CF-009, CF-136, CF-030, CF-049. Refinement: the amount is computed server-side from the order notes and the paise conversion is correct, so no client-trusted amount exists. |
| 11. `aiAgents.service.js`: `updateLead` args swapped; `resolveUserId` falls back to any user; `book_meeting` uses an unscoped `leadId`; hard-coded replies and a fake model | **Confirmed (all parts)** | `:311` swapped args vs `leads.service.js:402` (CF-003). `:153` unfiltered `prisma.user.findFirst()` (CF-033). `:347-359` unverified `leadId`/`contactId` (CF-004). `:571-594` canned fund replies, and `gemini-1.5-flash` / `heuristic-simulator` labels (CF-035). |
| 12. Refresh re-mints for the first-joined workspace; refresh tokens are stored in plaintext | **Confirmed** | `auth.service.js:163-167` derives the workspace with `orderBy joinedAt asc`, and `:41` stores the raw JWT (CF-042). |
| 13. No per-conversation inbound lock; `advanceRun` has no row lock; workflow `nodes: z.any()` | **Confirmed** | CF-094, CF-121, CF-044 (`validators/index.js:228,234`). |
| 14. The `delayed__` prefix contradicts its comment; `jobIds.test.js` tests a different builder | **Refined** | `workflow.queue.js:61` builds `delayed__<id>` against its own comment at :55-59. It works because BullMQ 5.76.6 has no reserved-prefix rule. `jobIds.test.js:15` defines local builders and imports nothing (CF-208). |
| 15. The agent worker and queue are not closed on shutdown; the sweep includes suspended workspaces | **Confirmed** | `server.js:396-403` closes 5 of 6 workers (CF-099). `agent.worker.js:23` runs `findMany({ take: 500 })` with no suspension filter and no ordering (CF-047). |
| 16. `requireFeature` covers only automation, Instagram and workflows | **Confirmed** | `automation.routes.js:16`, `instagram.routes.js:12`, `workflow.routes.js:11`. Integrations are gated in the UI only, and CRM and AI are not gated (CF-051). |
| 17. The lead-distribution round-robin races; Copilot sends the user's email to Gemini | **Confirmed** | `leadDistribution.service.js:67,154,163-171` does a read-modify-write of the counter (CF-073). `copilot.service.js:40,112-118` (CF-123). |
| 18. A live credential sits in `backend/.env.bak`; other secrets are in history | **Refined** | `.env.bak` is in no commit on any ref and is absent from the worktree. The only secret-bearing file ever committed is the test fixture `backend/.env.test` (538214e, deleted in 6583e26), which holds placeholder-pattern values (CF-227). |
| 19. Frontend: nav shown to every role, invalid `Btn` variants, missing icons, raw `fetch`, NotificationsBell stale closure, `navigate()` during render, dead code | **Confirmed; one part refined** | CF-089, CF-184, CF-185, CF-088, CF-192, CF-179, CF-193, CF-180. Refinement: the bell's 30 s interval is correct; the stale value is `unread` read inside `toggle` after `await load()` (CF-191). |

## 6. Recommended fix order

### Now (this week): money, abuse and authorization

1. **Wallet recharge.** Gate or delete `/wallet/recharge` (CF-001).
2. **Debug endpoints.** Remove or env-gate `reopen-window` and `inbound-simulate`, delete the Sales Inbox buttons, and stop stamping `lastInboundAt` on sends (CF-023, CF-022).
3. **Metering.** Meter and record the public API, OTP API and test sends, and validate the public template payload (CF-002, CF-026).
4. **API-key issuance and use.** Require ADMIN for API-key CRUD and for `GET /api-keys/authentication`. Re-check membership and role at OAuth consent. Check suspension and subscription in `authenticateApiKey`, and rate-limit the public and OTP APIs (CF-025, CF-006, CF-101, CF-102, CF-131).
5. **Missing role checks.**
   - Put `/ai/*` behind `workspaceContext` and `authorize` (CF-005).
   - Role-gate the onboarding chat's destructive actions (CF-021).
   - Add `authorize` to the Customize Your Business and AI Agents studio writes (CF-014, CF-037).
6. **Proxy trust.** Set `TRUST_PROXY_HOPS` on every deployment (CF-027).
7. **Database and deployment.** Decide on one production stack per database (CF-020). Land the baseline migration from cc183d8 (CF-019). Make `npm test` and the check scripts refuse non-local databases (CF-029).
8. **Outgoing webhooks.** Add the SSRF guard to dispatch, test, the public route and template media recovery (CF-105, CF-103, CF-111).

### Next (the next 2–4 weeks): core-flow correctness and reliability

1. **Campaigns.** Fix resume (CF-011). Recover RUNNING campaigns (CF-012). Honour the OTP campaign's template and number (CF-013). Prevent duplicate sends and stuck retries (CF-055, CF-057, CF-058).
2. **Billing.**
   - Apply the plan quota to campaign pricing (CF-008) and meter automated sends (CF-007).
   - Add the Razorpay webhook plus a transactional verify with a unique invoice reference (CF-009).
   - Stop seeding over admin plan edits (CF-010).
   - Build plan change and cancel (CF-049), fix add-ons (CF-030) and enforce plan features and the contact limit (CF-051, CF-016).
3. **Messaging.**
   - Fix the attribution TDZ (CF-024) and the sequence worker's fake DELIVERED status (CF-028).
   - Move webhook processing onto a durable queue with a per-conversation lock (CF-116, CF-094).
   - Unify the opt-out source (CF-205).
4. **Workflows.** Persist delays and add a DB sweep (CF-120). Claim runs in `advanceRun` (CF-121). Validate the workflow schema (CF-044).
5. **CRM access.** Enforce one record-visibility helper everywhere (CF-015, CF-079, CF-071), validate owner and team references (CF-072), and either wire in or delete the permission matrix (CF-078).
6. **Sessions and admin.** Hash refresh tokens, detect reuse and keep the current workspace (CF-042). Make impersonation tab-scoped, server-tracked and audited (CF-108, CF-032, CF-107).
7. **Infrastructure.** Raise the DB pool and move workers out of the HTTP process (CF-097, CF-119). Close the agent worker on shutdown (CF-099). Fail boot on a failed migration (CF-096). Default `NODE_ENV` to production on servers (CF-095).
8. **Uploads and crypto.** Switch uploads to disk or streaming with caps (CF-115), and upgrade multer (CF-085). Move to AES-GCM with a key id (CF-104). Stop logging tokens (CF-100).
9. **Broken CRM features.** Fix bulk tasks, saved views and custom fields (CF-017, CF-018, CF-063).

### Later: quality, UX, performance and docs

1. **Frontend.**
   - Add an error boundary (CF-086) and role-aware navigation (CF-089).
   - Fix `Btn`, the icons and the Avatars (CF-184, CF-185, CF-186).
   - Fix accessibility: the Modal, icon-only buttons and mobile CRM (CF-087, CF-122, CF-190).
   - Remove dead and duplicate code (CF-193, CF-180, CF-179).
2. **Remove fake UI.** Integration Health, AI channels, the rate-limit monitor, the studio test lab and the hard-coded upgrade banner (CF-077, CF-039, CF-151, CF-035, CF-194).
3. **Analytics accuracy.** CF-124 to CF-126.
4. **Performance.** Add pagination and indexes (CF-048, CF-084), batch the campaign worker (CF-053), and make polling visibility-aware (CF-189).
5. **Tests.** Cover billing, auth, webhooks, the campaign worker and tenant isolation (CF-113).
6. **Documentation.** Rewrite the README and `DEPLOY.md`, restore `.env.example`, and archive the old audit docs (CF-175, CF-172, CF-171, CF-168).
