# ChatFlow Pro — Bug sheet

One row per distinct root cause, sorted by severity then module. The same data is in `BUG_SHEET.csv`.

| Severity | Count |
|---|---|
| Critical | 2 |
| High | 27 |
| Medium | 92 |
| Low | 95 |
| Info | 11 |
| **Total** | **227** |

## Index

| ID | Severity | Status | Module | Title | Confidence |
|---|---|---|---|---|---|
| [CF-001](#cf-001) | Critical | SECURITY | Billing | Demo `/wallet/recharge` mints real, spendable balance with no gating | Confirmed |
| [CF-002](#cf-002) | Critical | BILLING | Public API / Billing | Public API `/messages`, OTP API and API-key test send are unmetered and unrecorded | Confirmed |
| [CF-003](#cf-003) | High | BROKEN | AI Agents studio | AI Agents studio `crm.qualify_lead` calls `updateLead` with arguments swapped (always fails) | Confirmed |
| [CF-004](#cf-004) | High | SECURITY | AI Agents studio | `executeAction` writes CRM activities against unscoped `leadId`/`contactId`; route has no validator or role check | Confirmed |
| [CF-005](#cf-005) | High | SECURITY | AI drafting / Templates / Campaigns | `/api/v1/ai/*` routes skip `workspaceContext` — VIEWER/AGENT can create/edit templates and campaigns, and suspended/EXPIRED workspaces keep writing | Confirmed |
| [CF-006](#cf-006) | High | SECURITY | API keys | `GET /api-keys/authentication` provisions and returns a raw `authentication:send` key to any member, including VIEWER/AGENT; no ADMIN gate on key mutations | Confirmed |
| [CF-007](#cf-007) | High | BILLING | Automation / Billing | Automated replies, workflows and sequences are unmetered; sequence rows fake DELIVERED | Confirmed |
| [CF-008](#cf-008) | High | BILLING | Billing | Plan message quota is never applied to campaign pricing — wallet pays for every campaign message | Confirmed |
| [CF-009](#cf-009) | High | RELIABILITY | Billing | No Razorpay server-to-server webhook; plan/add-on checkout verification is non-transactional and non-unique | Confirmed |
| [CF-010](#cf-010) | High | DATA | Billing / Admin | Boot-time plan seeding overwrites super-admin plan edits on every restart | Confirmed |
| [CF-011](#cf-011) | High | BROKEN | Campaigns | Resuming a paused non-authentication campaign never sends; campaign stuck RUNNING forever | Confirmed |
| [CF-012](#cf-012) | High | RELIABILITY | Campaigns | RUNNING campaigns are never recovered — a restart, stalled job, or throw after the claim strands the campaign permanently | Confirmed |
| [CF-013](#cf-013) | High | BROKEN | Campaigns / Authentication | Authentication (OTP) campaigns ignore the campaign's own template and WhatsApp number | Confirmed |
| [CF-014](#cf-014) | High | SECURITY | CRM-Customize | Customize Your Business PUT/reset endpoints have no role check: any member (VIEWER/AGENT) can rewrite workspace CRM configuration and delete pipeline stages | Confirmed |
| [CF-015](#cf-015) | High | SECURITY | CRM-Leads / CRM-Deals | Record-visibility scope is silently discarded when a status/stage filter is applied (OWN/TEAM users see every lead/deal) | Confirmed |
| [CF-016](#cf-016) | High | BILLING | CRM-Leads / Lead forms / Import (plan limits) | Plan contact limit (`contactLimit`) is bypassed by every CRM path that creates contacts: Add lead, public lead form, CRM CSV import | Confirmed |
| [CF-017](#cf-017) | High | BROKEN | CRM-Leads / Tasks | "Create task for selected leads" (BulkTaskModal) always fails: Task model has no `priority` column | Confirmed |
| [CF-018](#cf-018) | High | BROKEN | CRM-Saved views | Saving a view from Leads/Deals always returns 400: validator enum is uppercase singular, service/UI use lowercase plural | Confirmed |
| [CF-019](#cf-019) | High | RELIABILITY | Data model / Migrations | Migration history has no baseline, so `prisma migrate deploy` cannot build a fresh database | Confirmed |
| [CF-020](#cf-020) | High | RELIABILITY | Deploy | Two production deployments (Render and the Hostinger VPS) share one database, and each runs its own workers, sweeps and boot migrations | Likely (both configs were read; which one is live was not verified) |
| [CF-021](#cf-021) | High | SECURITY | Home / Onboarding AI chat | Onboarding chat lets any workspace member (incl. AGENT/VIEWER) delete templates/campaigns by fuzzy name match | Confirmed |
| [CF-022](#cf-022) | High | BROKEN | Inbox | Inbox free-form sends fabricate a new 24h window whenever the local window is closed | Confirmed |
| [CF-023](#cf-023) | High | SECURITY | Inbox | `reopen-window` and `inbound-simulate` debug endpoints are live in production for every member role | Confirmed |
| [CF-024](#cf-024) | High | BROKEN | Inbox / Campaign analytics | Campaign attribution lookup always throws (TDZ) and is silently swallowed | Confirmed |
| [CF-025](#cf-025) | High | SECURITY | OAuth provider / API keys | OAuth-provider consent mints a workspace API key from a stale JWT claim with no membership, role, or suspension check | Confirmed |
| [CF-026](#cf-026) | High | BILLING | Public API | Public API `POST /messages` crashes on a missing `template` object, forwards arbitrary unvalidated template payloads, is unmetered and persists nothing | Confirmed |
| [CF-027](#cf-027) | High | SECURITY | Rate limiting / Infra | `TRUST_PROXY_HOPS` is unset in every deploy artefact, so behind Render / the VPS reverse proxy every client shares one rate-limit bucket (platform-wide lockout of signup, forgot-password, login, refresh) | Likely (code path Confirmed; the live `.env` on the VPS and Render dashboard values could not be inspected) |
| [CF-028](#cf-028) | High | BROKEN | Sequences | Sequence worker records Meta failures as DELIVERED and bypasses window, OptOut table and credits | Confirmed |
| [CF-029](#cf-029) | High | DATA | Tests / Safety | `npm test` and all `scripts/*-check.mjs` write to whatever DATABASE_URL `.env` holds; the local-DB guard exists but nothing calls it | Likely (the static trace is complete; the developer's `.env` host was not inspected) |
| [CF-030](#cf-030) | Medium | PARTIAL | Add-ons | Add-ons do not stack, never renew, and silently expire after 30 days | Confirmed |
| [CF-031](#cf-031) | Medium | DATA | Admin / Billing | Admin "Payments" revenue double-counts Razorpay wallet top-ups and counts wallet-funded renewals as new money | Confirmed |
| [CF-032](#cf-032) | Medium | SECURITY | Admin / Impersonation | Impersonation sessions are indistinguishable from real user sessions, last 7 days, and the audit row drops the workspace | Confirmed |
| [CF-033](#cf-033) | Medium | DATA | AI Agents studio | `resolveUserId` falls back to *any* user in the database (cross-tenant attribution) | Confirmed |
| [CF-034](#cf-034) | Medium | FAKE/STUB | AI Agents studio | `crm.escalate_human` action is a no-op (touches `updatedAt` only) | Confirmed |
| [CF-035](#cf-035) | Medium | FAKE/STUB | AI Agents studio | AI Agents studio test lab: hard-coded investment-fund replies, fake model name, keyword-triggered "actions" never executed, UI hides errors | Confirmed |
| [CF-036](#cf-036) | Medium | FAKE/STUB | AI Agents studio | Channel deployments (Website / Instagram) in AI Agents studio are configuration-only; nothing reads them; "Connected & Active" is synthetic | Confirmed |
| [CF-037](#cf-037) | Medium | SECURITY | AI Agents studio | AI Agents studio routes lack Zod validation and role authorization; VIEWER can rewrite the live WhatsApp agent prompt | Confirmed |
| [CF-038](#cf-038) | Medium | PARTIAL | AI-Agents | Three separate AI-agent UIs on three endpoint families; the WhatsApp AI Agent tab (the only UI that can deploy the agent) is reachable only by deep link | Likely |
| [CF-039](#cf-039) | Medium | FAKE/STUB | AI-Agents | AI Agents "Channels" panel shows fabricated "Connected & Active" channels when the API returns none or fails | Confirmed |
| [CF-040](#cf-040) | Medium | BROKEN | API Management (workspace API keys) | API Keys "Send test message" posts to a route that does not exist | Confirmed |
| [CF-041](#cf-041) | Medium | SECURITY | Auth / Roles | Role floor is prefix-based: `authorize('AGENT')` on activities is dead, and AGENT gains paid sends, inbound simulation, contact import/delete | Confirmed |
| [CF-042](#cf-042) | Medium | SECURITY | Auth / Sessions | Refresh tokens stored in plaintext, no reuse detection, and every refresh re-scopes the session to the earliest-joined workspace | Confirmed |
| [CF-043](#cf-043) | Medium | PARTIAL | Authentication (OTP product) | Authentication dashboard KPIs are all-time and its filters only apply to the last 20 transactions | Confirmed |
| [CF-044](#cf-044) | Medium | PARTIAL | Automation / Workflows | Workflow create/update accepts `nodes: z.any()`; the engine silently truncates at 20 steps and ignores `edges` | Confirmed |
| [CF-045](#cf-045) | Medium | FAKE/STUB | Automation / Workflows | `missed` (Missed Inbound Call) workflow trigger is offered in the builder but no code ever emits `event: 'missed_call'` | Confirmed |
| [CF-046](#cf-046) | Medium | PARTIAL | Autonomous agent | Autonomous agent has no workspace on/off switch, no plan gate, no admin UI for its queue, and sweeps every workspace (first 500 only) | Confirmed |
| [CF-047](#cf-047) | Medium | RELIABILITY | Autonomous agent | Autonomous-agent sweep covers only the first 500 workspaces in arbitrary order and includes suspended workspaces | Confirmed |
| [CF-048](#cf-048) | Medium | PERF | Backend perf (Analytics, CRM, Campaigns, Admin) | Unbounded `findMany` inventory — 176 of 231 call sites have no `take`; the user-facing ones that matter are listed here | Confirmed (per-site read for the rows below; the count comes from a heuristic) |
| [CF-049](#cf-049) | Medium | MISSING | Billing | No plan change/cancel/downgrade API — `pendingPlanId` and `cancelAtPeriodEnd` are never set | Confirmed |
| [CF-050](#cf-050) | Medium | PARTIAL | Billing | Wallet-funded renewals + PAST_DUE/EXPIRED flow has no customer-facing renew action and no Razorpay auto-charge | Confirmed |
| [CF-051](#cf-051) | Medium | PARTIAL | Billing / Feature gating | Plan feature flags are almost entirely unenforced versus what the landing page sells | Confirmed |
| [CF-052](#cf-052) | Medium | BROKEN | Billing / Payments | Billing details (business name, email, address, GSTIN) are saved only in localStorage, never sent to the server, and not cleared on logout | Confirmed |
| [CF-053](#cf-053) | Medium | PERF | Campaign worker | Campaign worker loads all pending recipients at once and re-reads the campaign row before every send | Confirmed |
| [CF-054](#cf-054) | Medium | FAKE/STUB | Campaigns | Campaign wizard "Reply Flows" (step 6) and "Conversion Tracking" (step 8) are persisted but never executed | Confirmed |
| [CF-055](#cf-055) | Medium | RELIABILITY | Campaigns | Main campaign loop: an exception after Meta accepted the message triggers a retry → duplicate send | Confirmed |
| [CF-056](#cf-056) | Medium | BILLING | Campaigns / Fallback | Fallback SMS ignores WhatsApp opt-out and is unmetered | Confirmed |
| [CF-057](#cf-057) | Medium | RELIABILITY | Campaigns / Retry | A throw between the retry claim and the send leaves the recipient IN_PROGRESS; campaign cannot complete until reboot | Confirmed |
| [CF-058](#cf-058) | Medium | BROKEN | Campaigns / Retry | Pausing a non-authentication campaign does not stop its scheduled retries | Confirmed |
| [CF-059](#cf-059) | Medium | BROKEN | Config | env.js defines required variables nobody reads and omits one the code does read | Confirmed |
| [CF-060](#cf-060) | Medium | FAKE/STUB | Connect / Integrations | Integrations: 6 of 9 "OAuth" cards save a `pending` row that is reported as CONNECTED; no integration ever syncs data | Confirmed |
| [CF-061](#cf-061) | Medium | BROKEN | Connect / Settings | Lead-capture toggle (Settings → Team/Workspace `LeadCaptureSetting`) is a silent no-op: `autoLeadFromReply` is stripped by the settings validator | Confirmed |
| [CF-062](#cf-062) | Medium | DATA | CRM (cross-cutting) | `SavedView` is used as an untyped key-value store for 7 unrelated config families, with structural risks | Confirmed |
| [CF-063](#cf-063) | Medium | BROKEN | CRM-Custom fields | Custom fields: choice/URL/email/phone/user types cannot be created (Zod enum mismatch); `SELECT` passes Zod then 500s; service file is two modules concatenated | Confirmed |
| [CF-064](#cf-064) | Medium | DATA | CRM-Customize | Customization sections persist arbitrary JSON; stage deletion bypasses the safe-delete check; custom stage keys unvalidated | Confirmed |
| [CF-065](#cf-065) | Medium | BROKEN | CRM-Deals | Deal stage filter drops deals that have any custom-field values | Confirmed |
| [CF-066](#cf-066) | Medium | BROKEN | CRM-Engagements | Structured engagement fields (engagementType/status/duration/notes/outcome/sentiment) are stripped by Zod, so the Engagements Log modal silently loses data | Confirmed |
| [CF-067](#cf-067) | Medium | PARTIAL | CRM-Engagements | Activities list ignores record-visibility scope and mislabels tabs (Visits == Video Calls == MEETING) | Confirmed |
| [CF-068](#cf-068) | Medium | PARTIAL | CRM-Forecast / Deals | Forecast weights custom pipeline stages as QUALIFICATION (10%); any string is accepted as a stage | Confirmed |
| [CF-069](#cf-069) | Medium | PARTIAL | CRM-Import/Export | CRM CSV import runs synchronously row-by-row with no row cap, unvalidated `ownerUserId`, no distribution/category/events; exports drop custom stages/statuses and are unscoped | Confirmed |
| [CF-070](#cf-070) | Medium | RELIABILITY | CRM-Lead forms (public) | Public lead form: concurrent submissions 500 on unique constraints, leads bypass distribution rules/prospecting checks, unbounded submission rows from honeypot/rejected floods, owner not membership-checked | Confirmed |
| [CF-071](#cf-071) | Medium | PARTIAL | CRM-Leads / Convert | Lead convert-to-deal ignores record-visibility scope, is not idempotent under concurrency, does not validate owner, and loses custom stage/status | Confirmed |
| [CF-072](#cf-072) | Medium | SECURITY | CRM-Leads / Deals / Tickets / Inbox | `ownerUserId`/`teamId` references on leads, deals, tickets, conversations are not verified as workspace members/teams | Confirmed |
| [CF-073](#cf-073) | Medium | RELIABILITY | CRM-Leads / Lead distribution | Round-robin lead distribution counter is a non-atomic read-modify-write (Lead 17) | Confirmed |
| [CF-074](#cf-074) | Medium | SECURITY | CRM-Leads / Lead distribution | Lead distribution rules accept arbitrary JSON; ROUND_ROBIN pool user IDs never checked against workspace membership | Confirmed |
| [CF-075](#cf-075) | Medium | PARTIAL | CRM-Leads / Scoring & segmentation | Lead score and HOT/WARM/COLD category are computed once and never refreshed; time-decaying factors go stale, and segment campaigns target stale categories | Confirmed |
| [CF-076](#cf-076) | Medium | PARTIAL | CRM-Overview / Custom reports | Custom reports: unvalidated filters (500 on bad enum), no visibility scope, any CLIENT can delete any user's saved report, config stored unvalidated | Confirmed |
| [CF-077](#cf-077) | Medium | FAKE/STUB | CRM-Overview / Integration health | Integration Health modal shows fabricated status values | Confirmed |
| [CF-078](#cf-078) | Medium | FAKE/STUB | CRM-Permissions | CRM permission matrix is never enforced server-side and contradicts the real route guards | Confirmed |
| [CF-079](#cf-079) | Medium | PARTIAL | CRM-Permissions | Record-visibility scope applied to leads/deals/tasks/tickets only; sibling read surfaces bypass it | Likely |
| [CF-080](#cf-080) | Medium | PARTIAL | CRM-Sales inbox / Segment campaigns | Sales Inbox segment campaign launch: no Zod, no record-visibility scope, unbounded audience query, custom status 500s, orphan DRAFT campaigns on failure, analytics mislabel "skipped" as opted-out | Confirmed |
| [CF-081](#cf-081) | Medium | PARTIAL | CRM-Tickets | Ticket SLA: category `slaHours` from Customize is ignored, `firstRespondedAt` is never stamped, no breach detection job | Confirmed |
| [CF-082](#cf-082) | Medium | TECH-DEBT | Cross-cutting | Notable swallowed promises (`.catch(() => {})`) that hide money/data loss | Confirmed |
| [CF-083](#cf-083) | Medium | RELIABILITY | Data model / Cascades | Required FKs without onDelete (RESTRICT) block user, template and workspace deletion | Likely |
| [CF-084](#cf-084) | Medium | PERF | Data model / Indexes | Missing indexes on hot tenant-scoped queries | Confirmed |
| [CF-085](#cf-085) | Medium | SECURITY | Dependencies / Uploads | Backend ships `multer@1.4.5-lts.2`, a deprecated line with published DoS advisories fixed only in multer 2.x | Likely (the version is Confirmed from the lockfile; advisory applicability comes from public advisories because the audit DB is unreachable offline) |
| [CF-086](#cf-086) | Medium | RELIABILITY | Frontend-Shell | No error boundary anywhere while 8 views load lazily — any render error or stale chunk after a deploy blanks the app | Confirmed |
| [CF-087](#cf-087) | Medium | UX | Frontend-Shell / Accessibility | Shared `Modal` has no Escape handling, no focus trap, no `role="dialog"`/`aria-modal`, no focus restore — used at 49 sites in 19 files; `useFocusTrap` is used by only 2 bespoke dialogs | Confirmed |
| [CF-088](#cf-088) | Medium | RELIABILITY | Frontend-Shell / API layer | Three authenticated call sites bypass `authedFetch` — no token refresh/retry, so they 401 once the access token expires even though the session is still valid | Confirmed |
| [CF-089](#cf-089) | Medium | UX | Frontend-Shell / Role gating | Sidebar nav is identical for ADMIN/CLIENT/AGENT/VIEWER — no role gating; VIEWER/AGENT see ~20 sections whose primary actions the backend rejects with 403 | Confirmed |
| [CF-090](#cf-090) | Medium | PARTIAL | Home / Onboarding AI chat | Onboarding chat creates templates/campaigns with raw prisma, bypassing service validation and plan limits | Confirmed |
| [CF-091](#cf-091) | Medium | BROKEN | Inbox | Inbox is capped at the 20 most-recent conversations with no pagination; filters are client-side over that page | Confirmed |
| [CF-092](#cf-092) | Medium | PARTIAL | Inbox | Inbound never reopens a CLOSED/RESOLVED conversation; OOO fires on closed threads regardless of hours | Confirmed |
| [CF-093](#cf-093) | Medium | BILLING | Inbox / Billing | Token decryption failure after credit consumption leaks a message credit | Confirmed |
| [CF-094](#cf-094) | Medium | RELIABILITY | Inbox automation | Concurrent inbound webhooks for one conversation run the automation chain in parallel | Likely |
| [CF-095](#cf-095) | Medium | RELIABILITY | Infra / Boot | `NODE_ENV` defaults to `development`, which silently disables migrations and makes Redis give up after the first failure | Confirmed |
| [CF-096](#cf-096) | Medium | RELIABILITY | Infra / Boot | A failed `prisma migrate deploy` at boot only logs; the server serves traffic against an old schema | Confirmed |
| [CF-097](#cf-097) | Medium | PERF | Infra / DB | Prisma pool forced to `connection_limit=3` shared by ~19 concurrent worker slots plus all HTTP traffic | Likely |
| [CF-098](#cf-098) | Medium | RELIABILITY | Infra / Redis | A Redis outage in production makes queue enqueues and the token-revocation check hang instead of failing | Likely |
| [CF-099](#cf-099) | Medium | RELIABILITY | Infra / Workers | Graceful shutdown misses the agent worker/queue and cannot finish a campaign job within its 25 s budget | Confirmed |
| [CF-100](#cf-100) | Medium | SECURITY | Logging / Secrets | The request-log middleware writes the full `req.url`, including query strings and path tokens, to a plaintext file: invite tokens, OAuth `code`/`state`, the Google one-time exchange code and the Meta webhook verify token all land on disk | Confirmed |
| [CF-101](#cf-101) | Medium | SECURITY | Public API / Authentication OTP API | API-key authentication ignores workspace suspension / subscription state (public API and OTP API keep working after suspension) | Confirmed |
| [CF-102](#cf-102) | Medium | SECURITY | Public API / Authentication OTP API | No rate limiting on the public API or the Authentication OTP API; OTP `generate` has no per-recipient cooldown | Confirmed |
| [CF-103](#cf-103) | Medium | SECURITY | Public API / Settings | `POST /public/webhooks` bypasses Zod validation and stores any string as the workspace webhook URL (SSRF) | Confirmed |
| [CF-104](#cf-104) | Medium | SECURITY | Secrets / Crypto | `lib/encryption.js` uses AES-256-CBC with no MAC and a single static key with no key id or rotation path, and 23 of 24 callers do not handle decrypt failure | Confirmed |
| [CF-105](#cf-105) | Medium | SECURITY | Settings / Webhooks | Outgoing webhook dispatcher and "Send test" have no SSRF guard; the test is a status/error-code oracle and follows redirects | Confirmed |
| [CF-106](#cf-106) | Medium | RELIABILITY | Settings / Webhooks | Outgoing webhook retries are in-process `setTimeout` chains with unbounded concurrency; signing secret defaults to empty string | Confirmed |
| [CF-107](#cf-107) | Medium | SECURITY | Super Admin / Audit | Many super-admin writes are not audited (platform settings, Meta app webhook callback, cross-workspace invitations, number pool) | Confirmed |
| [CF-108](#cf-108) | Medium | SECURITY | SuperAdmin / Impersonation | Impersonation writes the customer's tokens to shared localStorage — the admin's other tabs silently become the customer, with no banner and no way back | Confirmed |
| [CF-109](#cf-109) | Medium | RELIABILITY | Team / Invitations | Invitation acceptance: seat-limit and `maxUses` checks are check-then-act without a lock | Likely |
| [CF-110](#cf-110) | Medium | SECURITY | Templates | Carousel card `_assetId` from user template JSON is loaded without a workspace check — another tenant's stored media can be sent | Likely |
| [CF-111](#cf-111) | Medium | SECURITY | Templates | Template media recovery `axios.get`s `example.header_handle` from user-editable template JSON with no SSRF guard | Likely |
| [CF-112](#cf-112) | Medium | BROKEN | Templates | Editing an APPROVED/PENDING template updates only the local row; Meta never sees the change | Confirmed |
| [CF-113](#cf-113) | Medium | MISSING | Tests | Coverage gaps: no tests for billing/wallet, Razorpay, auth/refresh, the campaign worker, or outbound webhook dispatch | Confirmed |
| [CF-114](#cf-114) | Medium | BROKEN | Tests / E2E | E2E scripts call a register endpoint that no longer exists; Playwright's default target is production | Confirmed |
| [CF-115](#cf-115) | Medium | RELIABILITY | Uploads | Uploads buffer up to 100 MB in memory, docx parsing has no decompression cap, and CRM import bypasses uploadGuard | Likely |
| [CF-116](#cf-116) | Medium | RELIABILITY | Webhooks | Webhook is ACKed before processing; any processing failure permanently loses the event | Confirmed |
| [CF-117](#cf-117) | Medium | SECURITY | Website widget knowledge / WhatsApp AI Agent sources | Workspace knowledge URL indexer uses a hostname-only SSRF guard while the platform already has a DNS-resolving one | Confirmed |
| [CF-118](#cf-118) | Medium | PARTIAL | WhatsApp AI Agent | WhatsApp AI Agent readiness counts URL knowledge sources the agent never reads; `escalationThreshold` stored but unused | Confirmed |
| [CF-119](#cf-119) | Medium | RELIABILITY | Workers / Ops | Six BullMQ workers run inside the HTTP process; ~19 Redis connections per instance; the agent worker is never closed on shutdown | Confirmed |
| [CF-120](#cf-120) | Medium | RELIABILITY | Workflow | Workflow runs parked on a delay (and reply reminders) live only in Redis — no DB sweep, stranded WAITING forever after a Redis loss | Confirmed |
| [CF-121](#cf-121) | Medium | RELIABILITY | Workflow | `advanceRun` has no claim/lock — concurrent replies, BullMQ retries and cancellations race and re-execute steps | Confirmed |
| [CF-122](#cf-122) | Low | UX | Accessibility | 44 of 102 icon-only buttons have no accessible name | Confirmed |
| [CF-123](#cf-123) | Low | SECURITY | AI Copilot | Copilot puts the user's email and user id in every Gemini system prompt | Confirmed |
| [CF-124](#cf-124) | Low | DATA | Analytics | Analytics overview opt-out rate uses the wrong denominator | Confirmed |
| [CF-125](#cf-125) | Low | DATA | Analytics | Analytics date bucketing uses server-local time in one place and hard-coded IST in another | Confirmed |
| [CF-126](#cf-126) | Low | DATA | Analytics (Agents) / User Analytics | "Agent stats" count outbound messages, not chats handled | Confirmed |
| [CF-127](#cf-127) | Low | DATA | Analytics (Performance tab) | Performance funnel and resolution split are computed from mismatched populations | Confirmed |
| [CF-128](#cf-128) | Low | SECURITY | Auth / Google OAuth | Google OAuth `state` is signed but not bound to the initiating browser (login CSRF), is signed with `JWT_ACCESS_SECRET`, and exposes the invite token in cleartext | Confirmed |
| [CF-129](#cf-129) | Low | SECURITY | Auth / Login, Signup, Password reset | Account enumeration through the forgot-password cooldown (429 only for real accounts) and through bcrypt timing on login and signup | Confirmed |
| [CF-130](#cf-130) | Low | SECURITY | Auth / Rate limiting | Rate-limiter memory fallback and OAuth code exchange — minor races | Confirmed |
| [CF-131](#cf-131) | Low | SECURITY | Auth / Roles | Security-relevant workspace configuration writes have no role check beyond membership (CLIENT == ADMIN) | Confirmed |
| [CF-132](#cf-132) | Low | RELIABILITY | Auth / Sessions | `/auth/exchange` and `/auth/refresh` consume their single-use secret with a non-atomic read-then-delete | Confirmed |
| [CF-133](#cf-133) | Low | SECURITY | Auth / Sessions | Access-token revocation fails open when Redis is unavailable, and there is no user-level disable | Confirmed |
| [CF-134](#cf-134) | Low | TECH-DEBT | Automation | `pages/stepChange.test.mjs` tests a hand-copied `applyStepChange` that has drifted from the real one; no frontend test script | Confirmed |
| [CF-135](#cf-135) | Low | TECH-DEBT | Automation / Workflows | Two parallel AI workflow generators; `/workflows/compile` (+ `/vocabulary`) has no frontend caller | Confirmed |
| [CF-136](#cf-136) | Low | SECURITY | Billing | `verifyPaymentSignature` uses `===` instead of `crypto.timingSafeEqual` | Confirmed |
| [CF-137](#cf-137) | Low | TECH-DEBT | Billing | PAST_DUE workspaces keep sending on wallet overage; EXPIRED block exempts wallet/subscription only by baseUrl suffix | Confirmed |
| [CF-138](#cf-138) | Low | PERF | Billing | `consumeMessageCredit` opens an interactive transaction per message with a 30s timeout | Likely |
| [CF-139](#cf-139) | Low | DATA | Billing / Data model | `Invoice.amount` is Float with default currency "USD"; all other money is Decimal and INR | Confirmed |
| [CF-140](#cf-140) | Low | TECH-DEBT | Build / Dependencies | `react-is@^19.2.7` alongside React 18.3.1; esbuild in dev-server advisory range; dependency audit inconclusive offline | Likely |
| [CF-141](#cf-141) | Low | RELIABILITY | Campaign billing | Campaign settlement can refund before late retries finish (refundedAt is one-shot) | Likely |
| [CF-142](#cf-142) | Low | DATA | Campaigns | Campaign advanced-config blobs accepted as `z.any()` with `.passthrough()` | Confirmed |
| [CF-143](#cf-143) | Low | PARTIAL | Campaigns | Wizard "Select Segment" audience tab is hard-disabled; pause/resume hidden for non-OTP campaigns | Confirmed |
| [CF-144](#cf-144) | Low | MISSING | Campaigns | No campaign report export / recipients export endpoint | Confirmed |
| [CF-145](#cf-145) | Low | PARTIAL | Campaigns / Authentication | OTP campaigns cannot be created from the campaign wizard although the campaign list has an "Authentication" type | Confirmed |
| [CF-146](#cf-146) | Low | DATA | Campaigns / Inbox | FAILED status overrides READ; late `delivered`/`read` overrides a RETRYING/FAILED recipient | Confirmed |
| [CF-147](#cf-147) | Low | RELIABILITY | Campaigns / Retry | Retry recovery gaps — boot-only, excludes PAUSED campaigns | Confirmed |
| [CF-148](#cf-148) | Low | RELIABILITY | Config | Dangerous or misleading defaults in env.js | Confirmed |
| [CF-149](#cf-149) | Low | RELIABILITY | Config / Platform settings | DB-backed platform-credential overrides are per-process and loaded once, so instances silently disagree | Likely |
| [CF-150](#cf-150) | Low | SECURITY | Connect / Number setup | WhatsApp `connect-own`, `onboard` and `embedded-signup` are documented as admin-only but have no `authorize` | Confirmed |
| [CF-151](#cf-151) | Low | FAKE/STUB | Connect / Settings | Settings → Security "Rate Limit Monitor" shows a fabricated 10,000/day limit | Confirmed |
| [CF-152](#cf-152) | Low | MISSING | Contacts / Blocked numbers | Cluster edit/delete and manual "block a number" have no UI | Confirmed |
| [CF-153](#cf-153) | Low | PERF | CRM import / misc | N+1 loops on user-triggered paths | Confirmed |
| [CF-154](#cf-154) | Low | PARTIAL | CRM-Customize (tabs not covered by CF-014/011) | Customize Your Business sections are only partly enforced: Document Categories is dead config, Lead Tags is UI-only, lifecycle/sources/prospecting apply only to manually created leads, outcome matching is fuzzy | Confirmed |
| [CF-155](#cf-155) | Low | PARTIAL | CRM-Deals / Line items / Products | Deal line items: no record-visibility scope, deleting the last line leaves a stale deal value, Decimal overflow 500s, inactive products and foreign-currency products accepted | Confirmed |
| [CF-156](#cf-156) | Low | DOCS | CRM-Docs | CRM docs contradict the code in both directions (features listed "Not built" exist; features listed "Built/DONE" are broken or unenforced) | Confirmed |
| [CF-157](#cf-157) | Low | PARTIAL | CRM-Gamification | Gamification: XP is farmable despite the "reward outcomes" claim; four achievements can never unlock; leaderboard has no opt-in switch | Confirmed |
| [CF-158](#cf-158) | Low | PARTIAL | CRM-Leads | Lead bulk endpoints unvalidated; custom lifecycle statuses cannot be bulk-applied (500) | Confirmed |
| [CF-159](#cf-159) | Low | PERF | CRM-Leads | LeadsView search fetches on every keystroke with no debounce or cancellation — results can arrive out of order | Likely |
| [CF-160](#cf-160) | Low | PARTIAL | CRM-Quotes | Quotes: concurrent creation collides on the number (500), no send/PDF/expiry automation despite SENT/EXPIRED states | Confirmed |
| [CF-161](#cf-161) | Low | UX | CRM-SalesInbox / AI-Agents / Engagements / Campaigns / Numbers / SuperAdmin | 24 native `alert()`/`confirm()` calls for success, error and destructive confirmations | Confirmed |
| [CF-162](#cf-162) | Low | PARTIAL | CRM-Sequences | Sequence enrolment: concurrent enrol 500s mid-loop, segment enrol of >1000 leads fails, out-of-scope/foreign lead ids silently dropped, unenroll ignores the sequence id in the URL | Confirmed |
| [CF-163](#cf-163) | Low | TECH-DEBT | CRM-Tests | CRM tests call services directly or assert fabricated values, so they pass while the HTTP feature is broken | Confirmed |
| [CF-164](#cf-164) | Low | TECH-DEBT | Data model / Repo hygiene | Root-level schema, validator and service copies are merge scratch artefacts; backend/prisma/schema.prisma is canonical | Confirmed |
| [CF-165](#cf-165) | Low | RELIABILITY | Deploy / Logging | Build and runtime quirks in render-build.js, ensure-prisma-client.js, logger and uploads | Confirmed |
| [CF-166](#cf-166) | Low | DOCS | Docs | QA guide instructs testers to pause a regular campaign from the UI, which is impossible | Confirmed |
| [CF-167](#cf-167) | Low | DOCS | Docs / AI agent and Copilot | AGENT_ROADMAP.md and ADVANCED_CRM_GAP_ANALYSIS.md give the Copilot "11 read tools"; the code has 9 read + 5 write | Confirmed |
| [CF-168](#cf-168) | Low | DOCS | Docs / Audit history | Historical audit docs at the repo root (issue_sheet, STABILIZATION_REPORT*, BUGS*) claim "all 75 issues resolved" while several are regressed or were never fixed as described | Confirmed |
| [CF-169](#cf-169) | Low | DOCS | Docs / Backend README | backend/README.md points at a missing `.env.example`, a non-existent `JWT_SECRET`, `migrate dev` on a history that cannot replay, and a one-worker architecture | Confirmed |
| [CF-170](#cf-170) | Low | DOCS | Docs / CRM evidence | TEST_EVIDENCE.md claims record-visibility is "enforced on the server, at every path" and that ticket SLA works; other auditors show bypasses | Confirmed |
| [CF-171](#cf-171) | Low | DOCS | Docs / Deploy | No `.env.example`, stale README/Node-version docs, and engines pin vs local Node | Confirmed |
| [CF-172](#cf-172) | Low | DOCS | Docs / Deploy | DEPLOY.md documents only Render, with service names and queue/worker lists that do not match render.yaml or the real production VPS | Confirmed |
| [CF-173](#cf-173) | Low | DOCS | Docs / Public API | backend/docs/PUBLIC_API.md documents 9 of about 20 public endpoints, omits scopes, and claims text messages that the handler cannot send | Confirmed |
| [CF-174](#cf-174) | Low | DOCS | Docs / QA | QA-TESTING-GUIDE.md setup step "`prisma migrate deploy` - 11 are pending on a fresh database" cannot work, and it tells testers to pause regular campaigns | Confirmed |
| [CF-175](#cf-175) | Low | DOCS | Docs / README | Root README describes a much older product (2 workers, billing "not implemented", Instagram/Voice stubs, no CRM or OTP product, Node 20+) | Confirmed |
| [CF-176](#cf-176) | Low | RELIABILITY | Email | Email worker reports success when SMTP is not configured | Confirmed |
| [CF-177](#cf-177) | Low | SECURITY | Error handling | The error handler's `detail: err.message` is gated only on `NODE_ENV`, which defaults to `development`; the VPS deploy path never sets it | Likely (render.yaml sets production; the VPS `.env` could not be inspected) |
| [CF-178](#cf-178) | Low | UX | Frontend-Shell | Sidebar role badge labels VIEWER and AGENT as "Member" | Confirmed |
| [CF-179](#cf-179) | Low | TECH-DEBT | Frontend-Shell | App.jsx carries a fully commented-out copy of the previous router (186 lines) | Confirmed |
| [CF-180](#cf-180) | Low | TECH-DEBT | Frontend-Shell | Dead modules: `CrmDashboardWidgets`, `TemplateModuleTabs`, `lib/motion.js` never imported; `AIOnboardingCard` imported but never rendered | Confirmed |
| [CF-181](#cf-181) | Low | TECH-DEBT | Frontend-Shell | `lib/format.js` and `lib/formatters.js` export conflicting `fmtDate` functions | Confirmed |
| [CF-182](#cf-182) | Low | UX | Frontend-Shell / API layer | `PROTECTED_PREFIXES` in api.js omits `/resources` — an expired session on the Resource Center lands on the marketing page instead of `/login` | Confirmed |
| [CF-183](#cf-183) | Low | PERF | Frontend-Shell / Build | Minimal code splitting — App imports every page eagerly and the Recharts chunk loads for every visitor | Likely |
| [CF-184](#cf-184) | Low | UX | Frontend-Shell / Components | `Btn` silently drops `variant="sec"`, `variant="danger"`, `size="xs"` and the `outline` boolean — buttons render unstyled | Confirmed |
| [CF-185](#cf-185) | Low | BROKEN | Frontend-Shell / Components | 13 icon usages reference names that `Icons.jsx` does not define — they render as empty SVGs | Confirmed |
| [CF-186](#cf-186) | Low | RELIABILITY | Frontend-Shell / Components | Ten Avatar implementations; the nine local copies crash on a `null` name | Likely |
| [CF-187](#cf-187) | Low | UX | Frontend-Shell / Components / Accessibility | `Btn` drops `title`, `aria-*`, `className`, `id` and every other pass-through prop | Confirmed |
| [CF-188](#cf-188) | Low | UX | Frontend-Shell / CRM | Sidebar CRM badge is fetched once, runs for super admin, counts a page length, and flips between workspace-wide and "mine" | Confirmed |
| [CF-189](#cf-189) | Low | PERF | Frontend-Shell / Inbox / Campaigns / Templates / Billing | Polling never pauses in hidden tabs, has no overlap guard, and the wallet is polled twice | Confirmed |
| [CF-190](#cf-190) | Low | UX | Frontend-Shell / Mobile | CRM views ignore mobile, and the bottom tab bar has no "More" entry — from a CRM page on a phone the nav drawer cannot be opened | Confirmed |
| [CF-191](#cf-191) | Low | BROKEN | Frontend-Shell / Notifications | NotificationsBell `toggle` checks a stale `unread` after `await load()`, so newly arrived notifications are never marked read | Confirmed |
| [CF-192](#cf-192) | Low | TECH-DEBT | Frontend-Shell / Router | `navigate()` (history push + synthetic popstate + setState) is called during render in `renderPage`; `isAuthed()` mutates localStorage during render | Confirmed |
| [CF-193](#cf-193) | Low | TECH-DEBT | Frontend-Shell / Router | `Dashboard.renderView` has unreachable duplicate branches for `contacts` and `automation` | Confirmed |
| [CF-194](#cf-194) | Low | UX | Home | Home "Upgrade to Growth plan" banner is hard-coded and shown to every plan | Confirmed |
| [CF-195](#cf-195) | Low | FAKE/STUB | Home | Home Instagram card is a permanent "Coming Soon" placeholder while Instagram routes exist | Confirmed |
| [CF-196](#cf-196) | Low | PERF | Home | Home stats come from three unpaginated list calls, not a stats endpoint | Confirmed |
| [CF-197](#cf-197) | Low | PERF | Inbox | Inbox "realtime" is 5 s / 4 s polling of full lists | Confirmed |
| [CF-198](#cf-198) | Low | MISSING | Inbox | Inbox note deletion and bot toggle exist on the backend but have no UI | Confirmed |
| [CF-199](#cf-199) | Low | UX | Inbox | InboxView has no loading or error state — it shows "No conversations yet" during the first fetch and forever on error | Confirmed |
| [CF-200](#cf-200) | Low | DATA | Inbox / Contacts | Phone matching — fuzzy path is safe; national-format contacts silently duplicate | Confirmed |
| [CF-201](#cf-201) | Low | UX | Multiple (Settings / Payments / SuperAdmin) | Writes that fail silently: Settings prefs save, invite resend, invoices list, revoke invitation | Confirmed |
| [CF-202](#cf-202) | Low | RELIABILITY | Ops / Boot | Long boot path before `listen()` delays the health check | Confirmed |
| [CF-203](#cf-203) | Low | RELIABILITY | Ops / Health | Health check is liveness-only and answers "ok" with the DB or Redis down | Confirmed |
| [CF-204](#cf-204) | Low | PERF | Ops / Seeding | Boot backfill reads every Workspace row in full, then runs 2 sequential queries per missing subscription | Confirmed |
| [CF-205](#cf-205) | Low | PARTIAL | Opt-out | `Contact.optedOut` and the `OptOut` table are consulted by disjoint send paths | Confirmed |
| [CF-206](#cf-206) | Low | BILLING | Pricing | Per-message price fallbacks disagree between campaign, inbox and wallet-status paths | Confirmed |
| [CF-207](#cf-207) | Low | DOCS | Pricing / Marketing | Landing/site pricing copy makes claims the plan catalog cannot honour | Confirmed |
| [CF-208](#cf-208) | Low | TECH-DEBT | Queues | Job-id builders: `delayed__` prefix contradicts its own comment; `jobIds.test.js` tests local copies, not the real builders | Confirmed |
| [CF-209](#cf-209) | Low | TECH-DEBT | Repo hygiene | Stray tracked files: Redis dump, QA PDF, screenshots, a prompt doc, an API-key minting script, and ad-hoc DB scripts | Confirmed |
| [CF-210](#cf-210) | Low | RELIABILITY | Sequences | Sequence worker: short-wait re-enqueue collides with its own job id; at-least-once sends on crash | Confirmed |
| [CF-211](#cf-211) | Low | BROKEN | Tests | Unit test results: DB tests skip without a database; 4 AI Agents tests fail because they are not gated | Confirmed |
| [CF-212](#cf-212) | Low | DATA | Wallet | `getWalletSummary.campaignSpend` subtracts all REFUND credits, including message-overage refunds | Confirmed |
| [CF-213](#cf-213) | Low | SECURITY | Webhooks | Meta/Instagram verify handshake echoes `hub.challenge` as text/html with no CSP; token compare not constant-time | Confirmed |
| [CF-214](#cf-214) | Low | SECURITY | Website analysis | Website crawler checks DNS, then `fetch` re-resolves (DNS-rebinding window) | Likely |
| [CF-215](#cf-215) | Low | TECH-DEBT | Workers | Agent and sequence workers have no `error` listener and no drainDelay/stalledInterval tuning | Confirmed |
| [CF-216](#cf-216) | Low | TECH-DEBT | Workflow / Data model | WorkflowRunStatus has no CANCELLED, and nothing bulk-cancels runs | Likely |
| [CF-217](#cf-217) | Info | PARTIAL | Analytics (Chat analytics / Insights) | Conversation "insights" sentiment/topics are keyword heuristics presented as AI analysis | Confirmed |
| [CF-218](#cf-218) | Info | PARTIAL | Contacts / Segments | Segments are static membership lists; no rule evaluation exists (docs already say so) | Confirmed |
| [CF-219](#cf-219) | Info | DOCS | Docs / AI features | AI_FEATURES_REPORT.md: wrong migration path, stale reply order, `migrate dev` instruction, UI location moved | Confirmed |
| [CF-220](#cf-220) | Info | DOCS | Docs / Licensing | ATTRIBUTION.md is accurate; project licence is inconsistent elsewhere | Confirmed |
| [CF-221](#cf-221) | Info | DOCS | Docs / Redis | backend/docs/local-redis-setup.md says Redis backs only the campaign and email queues | Confirmed |
| [CF-222](#cf-222) | Info | DOCS | Docs / Testing | TESTING_WALKTHROUGH.md test count (277) disagrees with TEST_EVIDENCE.md (264) and the tree; `npm test` needs a live local DB | Confirmed |
| [CF-223](#cf-223) | Info | TECH-DEBT | Frontend-Shell / Auth | Client decides super-admin from a `superAdmin` flag persisted in the localStorage `user` object — server re-verifies, so no security impact | Confirmed |
| [CF-224](#cf-224) | Info | PARTIAL | Inbox | Media/voice/Instagram inbound: stored, never automated; unsupported types count as unread and reset the window | Confirmed |
| [CF-225](#cf-225) | Info | SECURITY | OAuth provider | The OAuth provider token and revoke endpoints are sound; notes: no PKCE, and `/oauth/revoke` is not scoped to keys the calling client issued | Confirmed |
| [CF-226](#cf-226) | Info | RELIABILITY | Ops / Prisma client | prisma-schema-canonical test fails because the main checkout's generated client is stale | Confirmed (for the environment used) |
| [CF-227](#cf-227) | Info | SECURITY | Secrets | Secrets in the tree and in history: no live credentials found; test-fixture `backend/.env.test` recoverable from history; `.env.bak` (OPEN-009) not found; `dump.rdb` empty | Confirmed |

## Details

### CF-001

**Demo `/wallet/recharge` mints real, spendable balance with no gating**

| Field | Value |
|---|---|
| Module | Billing |
| Area | Backend |
| Status | SECURITY |
| Severity | Critical |
| Confidence | Confirmed |
| Location | backend/src/routes/wallet.routes.js:12, backend/src/controllers/wallet.controller.js:20-48, backend/src/services/wallet.service.js:139-160 |
| Description | `POST /workspaces/:id/wallet/recharge` is mounted unconditionally (no `NODE_ENV`/feature flag), guarded only by `authorize('ADMIN')` (workspace admin, i.e. every self-signup owner). It calls `walletService.credit()` with `gateway:'manual'` for any amount ≤ 100000, unlimited times. The credited balance is the same `Workspace.walletBalance` that campaign launches (`campaigns.service.js:709`), overage debits (`subscription.service.js:100`) and subscription renewals (`subscription.service.js:438`) spend from. |
| Steps to reproduce / Evidence | `POST /api/v1/workspaces/<ws>/wallet/recharge {"amount":100000}` as workspace owner → 200 `{balance:100000, demo:true}`; repeat N times. Then launch a 90,000-recipient MARKETING campaign — Meta bills the platform's WABA, customer paid nothing. `config/env.js` has no gating variable; frontend no longer calls it (`fe_calls.txt` has no `/wallet/recharge`), so it is a hidden backend-only route. |
| Expected | Route disabled in production (env-gated), or restricted to super admin with an ADJUSTMENT category and audit trail. |
| Actual | Any workspace admin can create unlimited free credit; also counted as `RECHARGE` in `getWalletSummary.totalRecharged`. |
| Impact | Direct money loss (Meta conversation charges) and mass-messaging abuse; renewal charges also self-funded → paid plans for free. |
| Suggested fix | Remove the route, or return 404 when `env.NODE_ENV === 'production'`; keep a super-admin-only `/admin/platform/workspaces/:id/wallet/adjust` with category `ADJUSTMENT`. |
| Effort | S |
| Related IDs | CF-050; Lead 2 |
| Audit working IDs | F-B-001 |

### CF-002

**Public API `/messages`, OTP API and API-key test send are unmetered and unrecorded**

| Field | Value |
|---|---|
| Module | Public API / Billing |
| Area | Backend |
| Status | BILLING |
| Severity | Critical |
| Confidence | Confirmed |
| Location | backend/src/routes/public.routes.js:36-43, backend/src/services/whatsapp.service.js:565-632, backend/src/authentication/authentication.service.js:230-330, backend/src/services/apikeys.service.js:380-530, backend/src/middleware/authenticateApiKey.js:4-59 |
| Description | None of these paths call `consumeMessageCredit`/`debit`. `grep consumeMessageCredit` hits only `campaign.worker.js` and `conversations.service.js`. `sendPublicMessage` also stores no `Conversation`/`Message` row, so sends are invisible in inbox, analytics and paid-messages insights. `authenticateApiKey` never checks `Workspace.suspended` or `Subscription.status`, so an EXPIRED/CANCELLED/suspended workspace can keep sending via API key (the block at `workspaceContext.js:309-324` is bypassed). |
| Steps to reproduce / Evidence | `POST /api/v1/messages` with `x-api-key` and `{type:'template', to:'91…', template:{name:'promo', language:{code:'en'}}}` → `sendWhatsAppMessage` at :623 with the raw client object; no ledger row, `UsageCounter.messagesUsed` unchanged. Same for `POST .../authentication/otp` (:303) and playground `sendTestMessage` (:503/:516). |
| Expected | Every WhatsApp send meters quota → wallet by category, stores a Message row, and API keys respect subscription/suspension state. |
| Actual | Unlimited free template/text sends via API key (scope `messages:send`), OTP API and playground (any CLIENT role). |
| Impact | Unmetered paid sends (money), bulk-messaging abuse vector bypassing campaign rate delay and reporting, analytics blind spot. |
| Suggested fix | Route `sendPublicMessage`/`sendTestMessage`/`sendAuthenticationOtp` through a shared metered send helper (consumeMessageCredit + release-on-failure + Conversation/Message write); add suspension + subscription-status check to `authenticateApiKey`. |
| Effort | M |
| Related IDs | CF-007; Lead 4 |
| Audit working IDs | F-B-002, F-A1-004 |

### CF-003

**AI Agents studio `crm.qualify_lead` calls `updateLead` with arguments swapped (always fails)**

| Field | Value |
|---|---|
| Module | AI Agents studio |
| Area | Backend |
| Status | BROKEN |
| Severity | High |
| Confidence | Confirmed |
| Location | backend/src/services/aiAgents.service.js:311, backend/src/services/leads.service.js:402 |
| Description | `updateLead(leadId, workspaceId, {...})` but the exported signature is `updateLead(workspaceId, id, updates, user)`. The lead is looked up with `workspaceId = leadId` and `id = workspaceId`, so it never resolves. |
| Steps to reproduce / Evidence | `POST /api/v1/workspaces/:ws/ai-agents/actions/execute {"actionId":"crm.qualify_lead","params":{"leadId":"..."}}` -> 400 from controller catch (aiAgents.controller.js:59-66). The follow-up `prisma.crmActivity.create` at :317 uses `updated.contactId` and is never reached. |
| Expected | Lead status set to QUALIFIED, score 85, activity logged. |
| Actual | Error for every invocation; the "Qualify Lead in CRM" action advertised in ACTION_REGISTRY (:78) never works. |
| Impact | Feature dead. |
| Suggested fix | `updateLead(workspaceId, leadId, {...})`; add a test for executeAction. |
| Effort | S |
| Related IDs | Lead 11 |
| Audit working IDs | F-CAI-001 |

### CF-004

**`executeAction` writes CRM activities against unscoped `leadId`/`contactId`; route has no validator or role check**

| Field | Value |
|---|---|
| Module | AI Agents studio |
| Area | Backend |
| Status | SECURITY |
| Severity | High |
| Confidence | Confirmed |
| Location | backend/src/services/aiAgents.service.js:347-359 (book_meeting), :335-345 (create_task passes raw ids), backend/src/routes/aiAgents.routes.js:8-20 (only authenticate+workspaceContext, no Zod) |
| Description | `crm.book_meeting` creates `crmActivity { workspaceId, leadId, contactId }` from caller-supplied ids without verifying the lead/contact belongs to `workspaceId`. `crm.create_task` passes `leadId`/`contactId`/`assignedToUserId` straight to `createTask`. Any VIEWER can call the endpoint. |
| Steps to reproduce / Evidence | `POST .../ai-agents/actions/execute {"actionId":"crm.book_meeting","params":{"leadId":"<other-tenant-lead>","note":"x"}}` -> `prisma.crmActivity.create` succeeds (FK only checks existence). |
| Expected | Verify `lead.workspaceId === workspaceId`; require ADMIN/CLIENT. |
| Actual | Unscoped write into another tenant's lead timeline. |
| Impact | Cross-tenant data pollution / spam vector. |
| Suggested fix | Scoped lookups + `authorize('ADMIN','CLIENT')` + Zod schema. |
| Effort | S |
| Related IDs | CF-003; Lead 11 |
| Audit working IDs | F-CAI-003 |

### CF-005

**`/api/v1/ai/*` routes skip `workspaceContext` — VIEWER/AGENT can create/edit templates and campaigns, and suspended/EXPIRED workspaces keep writing**

| Field | Value |
|---|---|
| Module | AI drafting / Templates / Campaigns |
| Area | Backend |
| Status | SECURITY |
| Severity | High |
| Confidence | Confirmed |
| Location | backend/src/routes/ai.routes.js:7-13, backend/src/controllers/ai.controller.js:7-17,19-109, backend/src/routes/index.js:218, backend/src/middleware/workspaceContext.js:181-209 |
| Description | `ai.routes.js` mounts `router.use(authenticate)` only. Handlers take `workspaceId` from the JWT (`req.user.workspaceId`) and call `assertMembership`, which checks membership but never the role, never `workspace.suspended`, never the CANCELLED/EXPIRED subscription block and never `checkRoleCapability`. All of those live only in `workspaceContext`, which this router never runs. |
| Steps to reproduce / Evidence | As a VIEWER (denied every non-GET by `roleCapabilities.js:148`), `POST /api/v1/ai/template/create {name, body}` → `prisma.template.create` (ai.controller.js:28) succeeds; `POST /api/v1/ai/campaign/create {name, templateId}` creates a DRAFT campaign (line 57); `POST /api/v1/ai/template/update {id, body}` rewrites any template body in the workspace and flips status to PENDING (line 100). A member of a suspended workspace (workspaceContext.js:181) can do the same. `executeWorkflow` (line 111-135) derives the workspace from a caller-supplied `workflowId` then asserts membership — tenancy OK, but skips suspension and `requireFeature('workflows')`. |
| Expected | Every workspace mutation goes through `workspaceContext` (role floor, suspension, subscription gating) and `authorize('CLIENT')`. |
| Actual | Role floor and workspace status gates are bypassed for 5 write endpoints. |
| Impact | In-tenant privilege escalation (read-only roles create/modify templates & campaign drafts; template edits reset a live template to PENDING); billing/suspension controls bypassed. |
| Suggested fix | Mount under `ws` (`/workspaces/:workspaceId/ai/...`) with `authenticate, workspaceContext, authorize('CLIENT')`. |
| Effort | S |
| Related IDs | CF-041 |
| Audit working IDs | F-A2-001 |

### CF-006

**`GET /api-keys/authentication` provisions and returns a raw `authentication:send` key to any member, including VIEWER/AGENT; no ADMIN gate on key mutations**

| Field | Value |
|---|---|
| Module | API keys |
| Area | Backend |
| Status | SECURITY |
| Severity | High |
| Confidence | Confirmed |
| Location | backend/src/routes/apikeys.routes.js:9-40, backend/src/controllers/apikeys.controller.js:15-21, backend/src/services/apikeys.service.js:29-186, backend/src/middleware/roleCapabilities.js:17,65 |
| Description | The api-keys router applies only `authenticate, workspaceContext` — no `authorize()`. `roleCapabilities` allows every `GET` for VIEWER/AGENT (`READ_ONLY_METHODS`). But `GET /authentication` is not read-only: `getOrCreateAuthenticationApiKey` creates an ApiKey with `scopes: ['authentication:send']` on first call and returns `rawKey`. Likewise `POST /`, `POST /:id/rotate`, `DELETE /:id`, `POST /authentication/rotate` are open to CLIENT with no ADMIN gate and no actor recorded. |
| Steps to reproduce / Evidence | Log in as VIEWER of a workspace whose Authentication key has never been provisioned; `GET /api/v1/workspaces/:id/api-keys/authentication` -> 200 `{ ..., rawKey: 'cfp_...' }`. That key authenticates `/api/v1/authentication/generate` (authentication.routes.js:13-17), which sends paid WhatsApp OTP messages to arbitrary numbers. |
| Expected | Key creation/rotation/revocation is a write gated to ADMIN (or at least CLIENT), never side-effected by a GET. |
| Actual | A read-only role can obtain a send-capable API key; any member can list key prefixes/scopes. |
| Impact | In-tenant privilege escalation to paid messaging. |
| Suggested fix | Split into `GET` (read, no create) + `POST /authentication` (create); `authorize('ADMIN')` on all mutating api-key routes; store `createdByUserId` on ApiKey. |
| Effort | S |
| Related IDs | CF-025; Lead 7 |
| Audit working IDs | F-A1-002 |

### CF-007

**Automated replies, workflows and sequences are unmetered; sequence rows fake DELIVERED**

| Field | Value |
|---|---|
| Module | Automation / Billing |
| Area | Backend |
| Status | BILLING |
| Severity | High |
| Confidence | Confirmed |
| Location | backend/src/services/outbound.service.js:35-126, backend/src/workers/sequence.worker.js:15-84, backend/src/services/workflowEngine.service.js:262,307,651, backend/src/services/webhook.service.js:597,818, backend/src/services/campaignAi.service.js:491, backend/src/services/whatsappForms.service.js:218 |
| Description | `sendAutomatedReply` (all keyword/welcome/OOO/AI/form/workflow text+button replies) and the sequence worker send via `lib/meta.js` with no quota or wallet accounting. Sequence worker additionally checks only `Contact.optedOut` (not the `OptOut` table), does no 24h-window check, and writes a `Message` row with `status: metaMsgId ? 'SENT' : 'DELIVERED'` — when the Meta call throws or the number has no token, the row is stored as DELIVERED. |
| Steps to reproduce / Evidence | `sequence.worker.js:52-76` — catch block only logs; :73 sets DELIVERED when `metaMsgId` is null. `outbound.service.js` imports nothing from subscription/wallet services. |
| Expected | All outbound WhatsApp sends meter quota (README §12.2 "usage always debits the workspace's shared quota/wallet"); a failed send is recorded FAILED. |
| Actual | Free-plan workspaces get unlimited automated sends beyond the 100-message quota; sequence analytics show phantom deliveries. |
| Impact | Unmetered sends; false delivery data. |
| Suggested fix | Meter inside `sendAutomatedReply` and `sendSequenceMessage` (prepaid=false, category null); store FAILED with reason when Meta rejects; use `isOptedOut` in sequences. |
| Effort | M |
| Related IDs | CF-002; Lead 4 |
| Audit working IDs | F-B-003 |

### CF-008

**Plan message quota is never applied to campaign pricing — wallet pays for every campaign message**

| Field | Value |
|---|---|
| Module | Billing |
| Area | Backend |
| Status | BILLING |
| Severity | High |
| Confidence | Confirmed |
| Location | backend/src/services/campaigns.service.js:683-714, backend/src/workers/campaign.worker.js:451-455, backend/src/services/subscription.service.js:89-94 |
| Description | Launch charges `valid.length × rateForCategory(...)` from the wallet up-front regardless of remaining plan quota. The worker then calls `consumeMessageCredit(..., {prepaid:true})`, which still increments `messagesUsed`. A Basic subscriber (₹1,500/mo, "10,000 messages per cycle") therefore pays ₹1.09 per marketing campaign message from the first message and simultaneously burns quota. The only thing quota is "free" for is inbox replies/templates. README §12.2 and the landing card (`backend/src/data/siteContent.js:137` "10,000 messages per cycle") promise the opposite; Growth "Unlimited messages" still bills per message. |
| Steps to reproduce / Evidence | Fresh BASIC workspace, quota 10,000 unused, wallet ₹100; launch 100-recipient MARKETING campaign → `totalCost = 109` → 402 INSUFFICIENT_WALLET_BALANCE (`campaigns.service.js:686`). |
| Expected | Campaign cost = max(0, recipients − remainingQuota) × rate, or the included quota is documented as inbox-only. |
| Actual | Subscription fee plus per-message wallet charge. |
| Impact | Money/fairness; misleading pricing; refund risk. |
| Suggested fix | In `launchCampaign` reserve `min(valid, remainingQuota)` from quota (atomic increment) and charge wallet only for the remainder; or fix copy everywhere. |
| Effort | M |
| Related IDs | CF-206, CF-207 |
| Audit working IDs | F-B-004 |

### CF-009

**No Razorpay server-to-server webhook; plan/add-on checkout verification is non-transactional and non-unique**

| Field | Value |
|---|---|
| Module | Billing |
| Area | Backend |
| Status | RELIABILITY |
| Severity | High |
| Confidence | Confirmed |
| Location | backend/src/services/subscription.service.js:264-323, backend/src/services/addons.service.js:72-137, backend/src/services/wallet.service.js:232-273, backend/prisma/schema.prisma:878-888 (Invoice), backend/src/routes/index.js:112-121 |
| Description | (a) No `x-razorpay-signature` webhook route exists (grep for `razorpay/webhook\|payment.captured` → none). If the browser closes after Razorpay captures payment but before `/checkout/verify` is called, the customer is charged and nothing is credited/upgraded — no reconciliation path. (b) `verifyCheckoutPayment` dedupes via `invoice.findFirst({reference: paymentId})` then `invoice.create` then `subscription.update` — three statements, no `$transaction`, and `Invoice.reference` has no unique index, so two concurrent verify calls both pass the check and create two PAID invoices. (c) `verifyAddonPayment` has the same findFirst/create race (:121-134). (d) Wallet top-up is correctly idempotent via the ledger unique key, but its invoice create is `.catch(()=>{})` and duplicates revenue reporting (CF-031). |
| Steps to reproduce / Evidence | `subscription.service.js:286-302`; Invoice model has no `@unique` on `reference`; `wallet.service.js:259-269`. |
| Expected | Webhook handler (`payment.captured`/`order.paid`) with signature check reusing the idempotent credit path; unique `(workspaceId, reference)` on Invoice; verify inside one transaction. |
| Actual | Payment can be lost on client-side interruption; duplicate invoices possible. |
| Impact | Customer charged without service (support load, chargebacks); reporting inflation. |
| Suggested fix | Add `POST /api/v1/webhook/razorpay` (raw-body HMAC with a webhook secret), key on `paymentId`; add `@@unique([workspaceId, reference])`; wrap verify in `$transaction`. |
| Effort | M |
| Related IDs | Lead 10 |
| Audit working IDs | F-B-005 |

### CF-010

**Boot-time plan seeding overwrites super-admin plan edits on every restart**

| Field | Value |
|---|---|
| Module | Billing / Admin |
| Area | Backend |
| Status | DATA |
| Severity | High |
| Confidence | Confirmed |
| Location | backend/src/server.js:52-130 (upsert `update: data` :123-127), backend/scripts/seed-plans.js:373-377, backend/src/services/admin.service.js:804-811, backend/src/routes/admin.routes.js:78-81; backend/src/server.js:52-130, backend/src/routes/admin.routes.js:80 |
| Description | `initializeSubscriptions()` runs on every boot and upserts FREE/BASIC/GROWTH with `update: data` — every field (prices, quotas, limits, overage rates, features, name). The super admin UI (`frontend/src/pages/SuperAdminView.jsx:1353` PATCH `/platform/plans/:id`) persists via `updatePlan`, but the next deploy/restart silently reverts it. Custom plans created via `POST /platform/plans` survive; the three canonical ones do not. |
| Steps to reproduce / Evidence | PATCH BASIC `priceMonthly` to 1800 → restart → `[Init] Upserted plan: BASIC` → 1500 again. Comment at `server.js:71-72` acknowledges the behaviour. |
| Expected | Seed only on create (`update: {}`) or a versioned seed honouring admin edits. |
| Actual | Admin plan management is cosmetic. |
| Impact | Pricing changes lost; renewals charged at the reverted amount after a deploy. |
| Suggested fix | `update: {}` in the boot upsert; keep full re-seed in the explicit script behind `--force`. |
| Effort | S |
| Related IDs | CF-049 |
| Audit working IDs | F-B-006, F-F-003 |

### CF-011

**Resuming a paused non-authentication campaign never sends; campaign stuck RUNNING forever**

| Field | Value |
|---|---|
| Module | Campaigns |
| Area | Backend |
| Status | BROKEN |
| Severity | High |
| Confidence | Confirmed |
| Location | backend/src/services/campaigns.service.js:1044-1050; backend/src/workers/campaign.worker.js:377-396 |
| Description | `resumeCampaign` sets the campaign to `RUNNING` (:1044) *before* enqueueing, and only authentication campaigns get `resume: true` in the job data (:1048). The worker's atomic claim only accepts `DRAFT\|SCHEDULED` (:377-380); on `count === 0` it re-reads the status and, when it is `RUNNING` and `!job.data?.resume`, logs "already being sent by another job — refusing to send it twice" and returns (:388-391). The job completes successfully, nothing is sent, and the campaign stays `RUNNING` with its `PENDING` recipients. |
| Steps to reproduce / Evidence | Launch a MARKETING/UTILITY campaign → `POST .../campaigns/:id/pause` mid-run (worker sees PAUSED at :415 and resets SENDING→PENDING at :629) → `POST .../campaigns/:id/resume` → `{status: 'RUNNING', remaining: N}` returned (:1052) → worker logs `[CampaignWorker] Campaign X is already being sent by another job — refusing to send it twice.` Nothing else ever picks the PENDING rows up: `checkAndCompleteCampaign` only runs from worker/retry/webhook paths and `recoverScheduledCampaigns` only looks at `SCHEDULED` (:1137-1140). Pausing a *SCHEDULED* campaign (:999) and then resuming hits the same path. |
| Expected | Resume continues sending the remaining PENDING recipients. |
| Actual | Silent no-op; campaign shows RUNNING indefinitely; unsent recipients are not refunded because `settleCampaignRefund` only runs at a terminal state — `cancelCampaign` (:1076) is the only way out. |
| Impact | Core flow broken for every non-OTP campaign that is paused; prepaid money locked until the user cancels. |
| Suggested fix | Always pass `resume: true` from `resumeCampaign` (drop the `isAuthentication` condition). Better: leave the status PAUSED in `resumeCampaign` and let the worker claim `PAUSED→RUNNING` atomically for jobs flagged `resume`. |
| Effort | S |
| Related IDs | CF-012; Lead 5 |
| Audit working IDs | F-E-001 |

### CF-012

**RUNNING campaigns are never recovered — a restart, stalled job, or throw after the claim strands the campaign permanently**

| Field | Value |
|---|---|
| Module | Campaigns |
| Area | Backend |
| Status | RELIABILITY |
| Severity | High |
| Confidence | Confirmed |
| Location | backend/src/services/campaigns.service.js:1124-1154, :771-778; backend/src/workers/campaign.worker.js:377-398, :411, :438, :650-660 |
| Description | Once the worker flips a campaign to `RUNNING` (:377-380) there is no way back into the send loop except a job carrying `resume: true`, which non-OTP resumes do not send (CF-011). Consequences: (a) `recoverScheduledCampaigns` releases `SENDING` rows to `PENDING` (:1129-1132) but only re-queues `SCHEDULED` campaigns (:1137-1140), so a campaign that was mid-send at restart stays RUNNING with PENDING rows forever. (b) BullMQ redelivering a stalled `send-campaign` job hits the "refusing to send it twice" return (:388-391) and completes as a success. (c) Any throw after the claim — `decrypt(campaign.waNumber.encryptedAccessToken)` (:398, outside every try) under a rotated `ENCRYPTION_KEY`, or a Prisma/pool-timeout error in the per-recipient status read (:411) or `isOptedOut` (:438), both outside the try — makes BullMQ retry (attempts 3, `backend/src/queues/campaign.queue.js:7`); attempt 2 sees RUNNING without `resume` and *returns normally*, so the `failed` handler's final-attempt branch (:654-660) — the only code that marks FAILED and refunds — never runs. (d) An immediate launch leaves the campaign `DRAFT` with `chargedAt` set until the worker picks it up (:771-778); if the Redis job is lost first (Upstash flush/eviction), recovery ignores DRAFT and nothing re-queues it. |
| Steps to reproduce / Evidence | Launch a 5 000-recipient campaign, kill the process after ~100 sends, restart → `[Recovery] Released 1 recipient(s) stranded mid-send…`; campaign stays RUNNING with ~4 900 PENDING rows and no job in the `campaigns` queue. |
| Expected | DB-driven recovery re-enqueues RUNNING (with resume semantics) and charged-DRAFT campaigns whose job is gone; a throw after the claim ends in FAILED + refund. |
| Actual | Stranded RUNNING campaigns, money held until manual cancel, no alert. |
| Impact | Every deploy/restart during a campaign strands it; prepaid funds withheld. |
| Suggested fix | In recovery also select `status: 'RUNNING'` and `{status: 'DRAFT', chargedAt: {not: null}}` whose job is missing and enqueue with `{resume: true}`; in the worker treat `job.attemptsMade > 0` on the same job as a legitimate resume; guard the decrypt so it marks FAILED. |
| Effort | M |
| Related IDs | CF-011, CF-057; Lead 5 |
| Audit working IDs | F-E-002 |

### CF-013

**Authentication (OTP) campaigns ignore the campaign's own template and WhatsApp number**

| Field | Value |
|---|---|
| Module | Campaigns / Authentication |
| Area | Backend |
| Status | BROKEN |
| Severity | High |
| Confidence | Confirmed |
| Location | backend/src/workers/campaign.worker.js:506-514, :234-242, :573-596; backend/src/authentication/authentication.service.js:230-233, :261-266, :127-167 |
| Description | The worker passes `{ templateId: campaign.template.id, to, waNumberId: campaign.waNumber.id, campaignId }`, but `sendAuthenticationOtp(workspaceId, { to, campaignId = null })` destructures only `to` and `campaignId`; template and number come from `resolveAuthenticationConfiguration(workspaceId)` — the workspace-level OTP product config (:127-167). An AUTHENTICATION campaign built on template A / number X is sent with the configured template B from number Y. If the workspace never configured the Authentication product every recipient throws 409 "Authentication WhatsApp number is not configured." → `handleRecipientFailure`. The worker then files the outbound `Message` under the conversation for `campaign.waNumberId` (:574-596) — a number the message did not come from. |
| Steps to reproduce / Evidence | Code trace above; `templateId`/`waNumberId` are never read inside `sendAuthenticationOtp`. |
| Expected | Campaign-selected template and number are used (or the builder forbids choosing them for OTP campaigns). |
| Actual | Different template/number, or 100% failures; the campaign was charged at the campaign template's category. |
| Impact | Wrong sender identity/message; conversations threaded on the wrong number. |
| Suggested fix | Accept `templateId`/`waNumberId` for internal callers and validate them (APPROVED, COPY_CODE, same workspace) instead of the workspace config. |
| Effort | S |
| Related IDs |  |
| Audit working IDs | F-E-005 |

### CF-014

**Customize Your Business PUT/reset endpoints have no role check: any member (VIEWER/AGENT) can rewrite workspace CRM configuration and delete pipeline stages**

| Field | Value |
|---|---|
| Module | CRM-Customize |
| Area | Backend |
| Status | SECURITY |
| Severity | High |
| Confidence | Confirmed |
| Location | backend/src/routes/crmCustomization.routes.js:8-14 (only `authenticate, workspaceContext`), backend/src/services/crmCustomization.service.js:360-502, :507-538 (`resetSection` deletes non-default `pipelineStage` rows), :462-467 (deletes removed stages) |
| Description | Every other CRM configuration route (`teams`, `pipeline-stages`, `custom-fields`) requires ADMIN or CLIENT; `crm-customization` requires nothing beyond membership. A VIEWER can `PUT /crm-customization/deal_setup {stages:[...]}` to delete every non-terminal pipeline stage, change win probabilities (forecast), rewrite lead lifecycle/sources (breaking lead creation validation at leads.service.js:312-334), or `POST /crm-customization/lead_lifecycle/reset`. |
| Steps to reproduce / Evidence | routes.md rows for `/crm-customization/*` list `authenticate / workspaceContext` only; compare `/pipeline-stages/:key` -> `authorize('ADMIN')`. |
| Expected | `authorize('ADMIN')` on PUT and reset. |
| Actual | Any role. |
| Impact | In-tenant privilege escalation; destructive and irreversible. |
| Suggested fix | Add `authorize('ADMIN')` to PUT/reset. |
| Effort | S |
| Related IDs | CF-064 |
| Audit working IDs | F-CRM-010 |

### CF-015

**Record-visibility scope is silently discarded when a status/stage filter is applied (OWN/TEAM users see every lead/deal)**

| Field | Value |
|---|---|
| Module | CRM-Leads / CRM-Deals |
| Area | Backend |
| Status | SECURITY |
| Severity | High |
| Confidence | Confirmed |
| Location | backend/src/services/leads.service.js:130-133 and :162-168; backend/src/services/deals.service.js:23-28 and :30-35; contrast backend/src/services/search.service.js:51-57 and recordScope.service.js:205-214 |
| Description | `scopeFilter` returns `{ OR: [{ownerUserId: me}, {ownerUserId: null}] }` for OWN/TEAM mode. `listLeads` spreads it into `where` and then, for a built-in status, assigns `where.OR = [...]` (leads.service.js:164), replacing the scope. `listDeals` does the same at deals.service.js:32. search.service.js:51-57 documents this exact hazard ("a sibling OR key simply replaces it, which silently drops the scoping altogether") and ANDs the scope, but the two list endpoints never got the fix. |
| Steps to reproduce / Evidence | Workspace `recordVisibility=OWN`; AGENT `GET /leads` -> own+unowned only; `GET /leads?status=NEW` -> every NEW lead in the workspace. Same for `GET /deals?stage=PROPOSAL`. The LeadsView status dropdown and DealsView column filters hit precisely these calls. |
| Expected | Scope always AND-ed. |
| Actual | Filtered lists leak all records in-tenant. |
| Impact | In-tenant privilege escalation; defeats the Teams/visibility feature. |
| Suggested fix | `where = { workspaceId, AND: [scope, statusClause, ...] }` as search.service.js does. |
| Effort | S |
| Related IDs | CF-079 |
| Audit working IDs | F-CRM-009 |

### CF-016

**Plan contact limit (`contactLimit`) is bypassed by every CRM path that creates contacts: Add lead, public lead form, CRM CSV import**

| Field | Value |
|---|---|
| Module | CRM-Leads / Lead forms / Import (plan limits) |
| Area | Backend |
| Status | BILLING |
| Severity | High |
| Confidence | Confirmed |
| Location | backend/src/services/subscription.service.js:174-199 (`assertWithinLimit(workspaceId,'contact')`); only callers for contacts are backend/src/services/contacts.service.js:167, :224; bypasses at backend/src/services/leads.service.js:282-292 (`prisma.contact.create` in `createLead`), backend/src/services/leadForms.service.js:282-286 (`submitForm`), backend/src/services/crmImport.service.js:176-181 (`importLeads`); plan seed backend/src/server.js:61 (`contactLimit: 100` on the free plan) |
| Description | The contacts module enforces the plan's contact cap, but the three CRM entry points create `Contact` rows directly with `prisma.contact.create` and never call `assertWithinLimit`. A free-plan workspace (100 contacts) can hold an unlimited number of contacts by adding leads instead of contacts, by importing a lead CSV (10 MB file, `crmData.routes.js:9`, no row cap), or by leaving a public form open. The public form is unauthenticated, so the growth is driven by anonymous visitors (10 submissions/min/IP bucket, publicForms.routes.js:23), not by the tenant. |
| Steps to reproduce / Evidence | Free plan, 100 contacts -> `POST /contacts` -> 403 PLAN_LIMIT_REACHED; `POST /leads {phoneNumber:'+919000000001', name:'x'}` -> 201, contact count 101; `POST /crm-data/import/leads` with 5,000 rows -> `contactsCreated: 5000`. |
| Expected | Every contact creation path gated by the same limit (import checks `additional = newContacts` up front, as the comment at subscription.service.js:182-183 intends). |
| Actual | Limit enforced only in contacts.service. |
| Impact | Paid-tier differentiator defeated; unbounded DB growth on free plans; contacts then usable as campaign audiences (sends themselves are still wallet-metered). |
| Suggested fix | Call `assertWithinLimit(workspaceId,'contact')` before each `contact.create` in leads/leadForms, and `assertWithinLimit(..., {additional: newCount})` in `importLeads` after the dedupe pass; for public forms record `outcome='REJECTED', reason='Plan contact limit'` instead of 403. |
| Effort | S |
| Related IDs | CF-070, CF-069 |
| Audit working IDs | F-CRM-024, F-B-010 |

### CF-017

**"Create task for selected leads" (BulkTaskModal) always fails: Task model has no `priority` column**

| Field | Value |
|---|---|
| Module | CRM-Leads / Tasks |
| Area | Both |
| Status | BROKEN |
| Severity | High |
| Confidence | Confirmed |
| Location | backend/src/services/leads.service.js:621-645 (`priority` written into `prisma.task.create` data at :636), backend/prisma/schema.prisma `model Task` (no priority field), frontend/src/components/BulkTaskModal.jsx:19-23 (sends `priority`) |
| Description | `bulkCreateTask` always passes `priority` (default `'NORMAL'`) into `prisma.task.create({ data })`. `Task` has no such column, so Prisma throws `PrismaClientValidationError: Unknown argument priority` on the first lead and the request 500s. No code path succeeds. |
| Steps to reproduce / Evidence | LeadsView -> select leads -> "Create task" -> submit -> 500. Static: Task fields are id/workspaceId/title/description/status/dueDate/assignedToUserId/leadId/dealId/contactId/completedAt/createdAt/updatedAt. |
| Expected | Tasks created for each selected lead. |
| Actual | 500 every time. |
| Impact | Core bulk workflow dead; `deal_mode.autoTaskConfig.defaultPriority` (crmCustomization.service.js:589-595) only survives as text in `description`. |
| Suggested fix | Drop `priority` from the create call (or add the column + Zod enum). |
| Effort | S |
| Related IDs | CF-158 |
| Audit working IDs | F-CRM-008 |

### CF-018

**Saving a view from Leads/Deals always returns 400: validator enum is uppercase singular, service/UI use lowercase plural**

| Field | Value |
|---|---|
| Module | CRM-Saved views |
| Area | Both |
| Status | BROKEN |
| Severity | High |
| Confidence | Confirmed |
| Location | backend/src/validators/index.js:521 (`SAVED_VIEW_ENTITIES = ['CONTACT','LEAD','DEAL','TICKET','TASK']`), :768-782; backend/src/services/savedViews.service.js:3 (`['leads','deals','tasks']`), :44-48; frontend/src/components/SavedViews.jsx:10, :44-52 (posts `entity: 'leads'\|'deals'`); backend/src/routes/savedViews.routes.js:13 |
| Description | The route validates `body.entity` with the uppercase enum, so the UI's `'leads'` is rejected (400 "Invalid enum value"). `'LEAD'` passes Zod and is rejected by the service. No value satisfies both, so `POST /saved-views` can never succeed. `savedViews.service.test.js:38-62` calls the service directly with `'leads'` and passes, masking the break. |
| Steps to reproduce / Evidence | LeadsView -> Saved views -> "Save current" -> 400. |
| Expected | One shared constant. |
| Actual | Feature unusable. |
| Impact | Advertised feature dead; misleading tests. |
| Suggested fix | Import `SAVED_VIEW_ENTITIES` from the service into the validator; add an HTTP-level test. |
| Effort | S |
| Related IDs | CF-062 |
| Audit working IDs | F-CRM-012 |

### CF-019

**Migration history has no baseline, so `prisma migrate deploy` cannot build a fresh database**

| Field | Value |
|---|---|
| Module | Data model / Migrations |
| Area | Infra |
| Status | RELIABILITY |
| Severity | High |
| Confidence | Confirmed |
| Location | backend/prisma/migrations/20260810010000_contact_updated_at/migration.sql:1, backend/prisma/migrations/20260907000000_campaign_authentication_analytics/migration.sql:4, backend/prisma/manual/004_authentication_transactions.sql:1, backend/prisma/schema.prisma (82 models); OPEN_ISSUES.md:6-30, backend/prisma/migrations/ (20 dirs, first `20260810000000_site_knowledge_index`), backend/src/server.js:222-227, backend/package.json:17,19, docs/LOCAL_DEV_DATABASE.md:64-78 |
| Description | `schema.prisma` declares 82 models and 27 enums. The 20 migrations create only 23 tables and 7 enums. The other 59 models exist in no migration: User, WorkspaceMember, Message, CampaignRecipient, Invoice, RefreshToken, WalletTransaction, EmailOtp, WhatsAppAuthOtp, Plan, Subscription, Lead, Deal, Task, Sequence*, Team, and more. The same is true for 20 enums, e.g. WorkflowRunStatus, ConversationStatus, TemplateStatus, LeadStatus. The earliest migrations run `ALTER TABLE "Contact"`, `"Workspace"` and `"Campaign"`, but no migration ever creates those tables. The DB was built with `prisma db push`, and migrations were layered on top later. |
| Steps to reproduce / Evidence | `node C:\Users\thete\.claude\jobs\d1cefbb9\tmp\schemadiff.mjs` statically parses the schema against every migration.sql and manual/*.sql. It prints "MODELS in schema: 82 TABLES in migrations: 23" and lists the 59 models with no CREATE TABLE. - Second break: migration `20260907000000` runs `ALTER TABLE "AuthenticationTransaction" ADD COLUMN "campaignId"` (line 4). That table is created only in `prisma/manual/004_authentication_transactions.sql`. - DEPLOY.md:208 says manual/ "is *not* applied automatically". |
| Expected | A fresh or restored DB can be rebuilt with `migrate deploy`. The `.gitignore` comment says migrations are "needed to recreate tables on a fresh/restored DB". |
| Actual | On an empty database, `migrate deploy` fails at the 2nd migration. Staging, disaster-recovery restores and new developers must run `db push`, which bypasses history, and then baseline by hand. |
| Impact | The schema cannot be reproduced. Disaster recovery to a new DB is blocked. Drift between prod and schema.prisma cannot be detected. |
| Suggested fix | Create a baseline `0_init` with `prisma migrate diff --from-empty --to-schema-datamodel` for the pre-2026-08-10 state. Mark it applied on existing DBs with `migrate resolve --applied 0_init`. Fold manual/003 and manual/004 into real migrations ordered before 20260907. |
| Effort | M |
| Related IDs | CF-096, CF-020 |
| Audit working IDs | F-F-001, F-J-011 |

### CF-020

**Two production deployments (Render and the Hostinger VPS) share one database, and each runs its own workers, sweeps and boot migrations**

| Field | Value |
|---|---|
| Module | Deploy |
| Area | Infra |
| Status | RELIABILITY |
| Severity | High |
| Confidence | Likely (both configs were read; which one is live was not verified) |
| Location | deploy-vps.sh:3-4,63-67; render.yaml:12-16,56-60; backend/src/server.js:221-224,302-367 |
| Description | deploy-vps.sh:64-65 states "this database is shared with the Render deployment". render.yaml provisions its own Redis (`chatflow-redis`), and the VPS uses its own `.env` REDIS_URL. So there are two app instances, each with separate BullMQ state, over one Postgres. On every boot each instance does all of the following against the shared DB: - `recoverScheduledCampaigns()` (server.js:333) re-queues every SCHEDULED campaign in the DB into *its own* Redis. - `recoverPendingRetries()` (:343) does the same for retries. - `scheduleBillingCycleJob()` (:351) sets up a daily 02:00 sweep, and `runBillingCycleSweep()` (:361) runs immediately. - The agent and sequence sweeps are scheduled per instance. - `migrate deploy` runs (CF-096). BullMQ's jobId dedupe works only inside one Redis. The only protection against double sends and double renewal charges is the DB-level claims: `recipient_sending_claim` and the wallet idempotency keys, whose correctness is owned by the billing/messaging audits. |
| Steps to reproduce / Evidence | Static code trace at the cited Location lines; the trace is written out in the Description. |
| Expected |  |
| Actual |  |
| Impact | A duplicate campaign run, duplicate billing-cycle processing and duplicate agent actions are all possible whenever both instances are up. Both instances also send the same scheduled emails. |
| Suggested fix | Run exactly one production stack per database. If two are needed, gate workers and sweeps with `WORKERS_ENABLED=0` on the secondary, and point both at the same Redis. |
| Effort | S (config) / M (flag) |
| Related IDs | CF-096, CF-119 |
| Audit working IDs | F-I-003 |

### CF-021

**Onboarding chat lets any workspace member (incl. AGENT/VIEWER) delete templates/campaigns by fuzzy name match**

| Field | Value |
|---|---|
| Module | Home / Onboarding AI chat |
| Area | Backend |
| Status | SECURITY |
| Severity | High |
| Confidence | Confirmed |
| Location | backend/src/routes/onboarding.routes.js:10, backend/src/controllers/onboarding.controller.js:203-206, :396-407 |
| Description | `/api/v1/onboarding/chat` is mounted outside the `/workspaces/:workspaceId` tree, so neither `workspaceContext` (and its `checkRoleCapability` VIEWER/AGENT write block) nor `authorize()` runs. The handler only checks `workspaceMember.findUnique` (membership, not role). The DELETE_TEMPLATE / DELETE_CAMPAIGN steps then do `prisma.template.findFirst({ name: { contains: text, mode: 'insensitive' } })` and `prisma.template.delete(...)` / `prisma.campaign.delete(...)` with no status check (a RUNNING/SCHEDULED campaign can be deleted, its queue job orphaned) and no Meta-side delete. |
| Steps to reproduce / Evidence | POST /api/v1/onboarding/chat {message:"delete a template", workspaceId} as VIEWER -> state DELETE_GATHER_TEMPLATE_NAME; next message "a" -> first template whose name contains "a" is hard-deleted. Compare templates.routes.js which routes DELETE through workspaceContext + role capability. |
| Expected | Same role gate as REST (`checkRoleCapability`), exact-name confirmation, status guard (no delete of RUNNING/SCHEDULED campaigns), and Meta delete for templates. |
| Actual | Any member can hard-delete arbitrary templates/campaigns; a substring match picks the first record. |
| Impact | In-tenant privilege escalation + data loss (queued campaign row deleted while a BullMQ job still references it). |
| Suggested fix | Move the route under `/workspaces/:workspaceId/onboarding/chat` behind `workspaceContext` + `authorize('CLIENT')`, require an exact name match and a confirmation turn, and reuse templates.service.remove / campaigns.service.cancel instead of raw prisma deletes. |
| Effort | S |
| Related IDs | CF-090 |
| Audit working IDs | F-core-001 |

### CF-022

**Inbox free-form sends fabricate a new 24h window whenever the local window is closed**

| Field | Value |
|---|---|
| Module | Inbox |
| Area | Backend |
| Status | BROKEN |
| Severity | High |
| Confidence | Confirmed |
| Location | backend/src/services/conversations.service.js:231, :277, :326, :377 |
| Description | `sendMessage` and `sendMediaMessage` compute `windowState` but never enforce it; if `!windowState.open` and Meta returns 200 they write `lastInboundAt: new Date()`. Meta's Cloud API accepts a free-form message synchronously (returns a `wamid`) and reports 131047 "outside the customer service window" asynchronously through the `statuses` webhook, so synchronous acceptance is not evidence that the window is open. The write therefore opens a fake 24h window on the conversation. |
| Steps to reproduce / Evidence | :231 `const windowState = await getWindowState(conversationId)`; :277 `...(!windowState.open ? { lastInboundAt: new Date() } : {})`; same at :326/:377. Contrast `sendTemplateMessage` :486-489, which explicitly refuses to touch `lastInboundAt`, and `outbound.service.js:64-73`, which gates every automated reply on `getWindowState`. After one out-of-window agent reply: window reported open for 24h → keyword triggers, workflow `message` steps, delayed-response, forms and campaign-AI replies pass the local gate and are posted to Meta, each recorded SENT (`outbound.service.js:107`) then flipped FAILED by the status webhook. The human reply's credit (`consumeMessageCredit` :233) is not refunded on the asynchronous failure. |
| Expected | Free-form sends refused locally with `OUTSIDE_24H_WINDOW` (409) when closed — the helper `outsideWindowError` (`messagingWindow.js:350`) exists and is unused by these paths — and `lastInboundAt` never written by an outbound send. |
| Actual | Window faked; UI shows "Nh left to reply freely"; downstream automation sends into a closed window; credits burned. |
| Impact | Data integrity of the window, wasted credits, silent automation failures. |
| Suggested fix | `if (!windowState.open) throw outsideWindowError(windowState)` in both functions; delete the `lastInboundAt` writes. |
| Effort | S |
| Related IDs | CF-023; Lead 6 |
| Audit working IDs | F-D-002 |

### CF-023

**`reopen-window` and `inbound-simulate` debug endpoints are live in production for every member role**

| Field | Value |
|---|---|
| Module | Inbox |
| Area | Backend |
| Status | SECURITY |
| Severity | High |
| Confidence | Confirmed |
| Location | backend/src/routes/conversations.routes.js:9, :25-26; backend/src/controllers/conversations.controller.js:119-125; backend/src/services/conversations.service.js:752-803; frontend/src/pages/CrmSalesInboxView.jsx:448-483, :1022-1027; backend/src/routes/conversations.routes.js:25-26 (no `authorize`, no NODE_ENV guard); backend/src/services/conversations.service.js:752-767 (`reopenWindow` sets `lastInboundAt = now`), :772-803 (`simulateInboundMessage` inserts an INBOUND DELIVERED message, bumps `unreadCount`) |
| Description | `POST /:id/reopen-window` sets `lastInboundAt = now`; `POST /:id/inbound-simulate` creates a fake `INBOUND` `Message` (`status: DELIVERED`, no `metaMessageId`) and bumps `lastInboundAt`/`unreadCount`. The router applies only `authenticate, workspaceContext` (:9) — no `authorize`/`roleCapabilities` and no `NODE_ENV` guard anywhere (grep for `simulateInbound\|reopenWindow\|inbound-simulate` finds no gating). |
| Steps to reproduce / Evidence | As any member (VIEWER included): `POST /api/v1/workspaces/{ws}/conversations/{id}/inbound-simulate {"body":"yes"}` → 200 and a customer message appears; `POST .../reopen-window` → window open 24h. |
| Expected | Absent in production, or ADMIN-only behind `NODE_ENV !== 'production'`. |
| Actual | Any member can forge customer messages (poisons `computeLeadScore`, `findExitReason` "Contact replied", delayed-response checks, "First message from the customer" timeline, exit-on-reply) and defeat the 24h gate every automated path relies on. |
| Impact | Conversation data integrity; policy bypass leading to Meta-side rejections. |
| Suggested fix | Remove both routes or wrap in an env guard + `authorize('ADMIN')`. |
| Effort | S |
| Related IDs | CF-022; Lead 6 |
| Audit working IDs | F-D-003, F-B-008, F-core-012, F-CRM-014 |

### CF-024

**Campaign attribution lookup always throws (TDZ) and is silently swallowed**

| Field | Value |
|---|---|
| Module | Inbox / Campaign analytics |
| Area | Backend |
| Status | BROKEN |
| Severity | High |
| Confidence | Confirmed |
| Location | backend/src/services/webhook.service.js:228, :359, :361, :365-369, :410 |
| Description | `handleInboundMessage(value, msg)` has no `workspaceId` parameter and no earlier binding; the only declaration is `const workspaceId = waNumber.workspaceId;` at :410. Lines 359/361 read `workspaceId` inside the `where` literal built before that line. A `const` is in the temporal dead zone until its declaration executes, so evaluating either branch throws `ReferenceError: Cannot access 'workspaceId' before initialization`. The ternary evaluates only the selected branch, so the error fires exactly when attribution is possible (CTA payload present, or a `msg.context.id` quoted reply) and never for plain messages (the third branch :362 has no reference — and still runs a pointless DB query with a sentinel id on every message). |
| Steps to reproduce / Evidence | Signature :228; no other `workspaceId` binding between :228 and :410 (grep). Tap any campaign quick-reply or quote a campaign message → log `[Inbound] Campaign attribution lookup failed: Cannot access 'workspaceId' before initialization`; `campaignRecipient` stays `null`; the message is stored with `campaignRecipientId: null` (:383). |
| Expected | CTA taps / quoted replies link the inbound `Message` to the `CampaignRecipient`. |
| Actual | No inbound message has ever been attributed; anything reading `Message.campaignRecipientId` for INBOUND rows is empty. |
| Impact | Campaign reply attribution silently wrong for every workspace; masked by the catch. |
| Suggested fix | Move `const workspaceId = waNumber.workspaceId;` above :354 (or use `waNumber.workspaceId`); skip the query when neither payload nor context exists. |
| Effort | S |
| Related IDs | Lead 1 |
| Audit working IDs | F-D-001 |

### CF-025

**OAuth-provider consent mints a workspace API key from a stale JWT claim with no membership, role, or suspension check**

| Field | Value |
|---|---|
| Module | OAuth provider / API keys |
| Area | Backend |
| Status | SECURITY |
| Severity | High |
| Confidence | Confirmed |
| Location | backend/src/routes/oauth.routes.js:37-38, backend/src/controllers/oauth.controller.js:95-97, backend/src/controllers/oauth.controller.js:154-176, backend/src/services/oauth.service.js:161-175, backend/src/services/oauth.service.js:249-253, backend/src/middleware/roleCapabilities.js:56-81 |
| Description | `/oauth/consent-info` and `/oauth/consent/decide` are guarded only by `authenticate`. `decide()` takes `workspaceId = req.user.workspaceId` straight from the access-token claim and calls `issueAuthorizationCode` -> `exchangeAuthorizationCode` -> `createApiKey(row.workspaceId, {scopes})`. Nothing re-reads `WorkspaceMember`, nothing checks `workspace.suspended` / subscription status, and `roleCapabilities` (what keeps VIEWER/AGENT from writing) only runs inside `workspaceContext` on `/workspaces/:id/*` routes — it never runs here. |
| Steps to reproduce / Evidence | (1) As a VIEWER (JWT role 'VIEWER') open `/api/v1/oauth/authorize?client_id=spandan&redirect_uri=<registered>&response_type=code&scope=messages:send webhooks:write`, approve on the consent page -> code -> client exchanges -> API key with `messages:send`,`webhooks:write` for the workspace (oauth.service.js:249). (2) Remove a member; their existing access token (15 min) still carries `workspaceId`; they can approve consent and obtain a permanent key. (3) Suspend a workspace; a member with a live token can still connect an app and the key works (see CF-101). |
| Expected | Consent re-verifies live membership (like `workspaceContext`), requires at least CLIENT (ideally ADMIN), and refuses suspended/inactive workspaces. |
| Actual | Any authenticated JWT with a `workspaceId` claim can mint a non-expiring, role-less API key for that workspace. |
| Impact | In-tenant privilege escalation — read-only roles get a credential that sends WhatsApp messages (spends wallet) and rewrites the webhook URL, permanently, bypassing every dashboard role gate; removed members retain a path to a persistent credential. |
| Suggested fix | In `consentInfo`/`decide` load `WorkspaceMember` for `(req.user.id, req.user.workspaceId)`, apply the `checkRoleCapability` rule (deny VIEWER/AGENT), reject suspended/CANCELLED/EXPIRED workspaces; record the granting user on the ApiKey. |
| Effort | S |
| Related IDs | CF-006, CF-101; Lead 7 |
| Audit working IDs | F-A1-001 |

### CF-026

**Public API `POST /messages` crashes on a missing `template` object, forwards arbitrary unvalidated template payloads, is unmetered and persists nothing**

| Field | Value |
|---|---|
| Module | Public API |
| Area | Backend |
| Status | BILLING |
| Severity | High |
| Confidence | Confirmed |
| Location | backend/src/services/whatsapp.service.js:565-631; backend/src/routes/public.routes.js:36-43 |
| Description | (a) `type:'template'` without a `template` object → `template.variables` at :599 throws `TypeError` → 500. (b) When `template.variables` is absent, the raw caller object is posted to Meta verbatim (:623) — no check that the template exists in the workspace, is APPROVED, or that the components are sane. (c) With variables, the lookup uses `language: template.language?.code \|\| 'en'` and no `status: 'APPROVED'` filter (:600-606), and `resolve` returns `''` for missing indexes (:617) which Meta rejects with 132000. (d) No `consumeMessageCredit`, no `getWindowState` for `type:'text'`, and no `Conversation`/`Message` row is written, so status webhooks are dropped at `webhook.service.js:940` and the inbox never shows the send. The route (:38) calls the service with no validator. |
| Steps to reproduce / Evidence | `POST /api/v1/public/messages {"to":"+91…","type":"template"}` → 500 `Cannot read properties of undefined (reading 'variables')`. `{"type":"text","to":"…","body":"hi"}` → sent to Meta with no credit consumed (compare `conversations.service.js:233`). |
| Expected | Validated body; APPROVED-template check via `buildTemplateSendPayload`; credit metering; window check for text; message persisted. |
| Actual | As described. |
| Impact | Unmetered paid sends (billing loss), 500s on malformed input, invisible sends and lost delivery statuses. |
| Suggested fix | Zod-validate the body; require an APPROVED stored template; `consumeMessageCredit` / `getWindowState`; persist via `getOrCreateConversation` + `message.create`. |
| Effort | M |
| Related IDs | Lead 3 |
| Audit working IDs | F-D-004, F-B-025 |

### CF-027

**`TRUST_PROXY_HOPS` is unset in every deploy artefact, so behind Render / the VPS reverse proxy every client shares one rate-limit bucket (platform-wide lockout of signup, forgot-password, login, refresh)**

| Field | Value |
|---|---|
| Module | Rate limiting / Infra |
| Area | Infra |
| Status | SECURITY |
| Severity | High |
| Confidence | Likely (code path Confirmed; the live `.env` on the VPS and Render dashboard values could not be inspected) |
| Location | backend/src/config/env.js:17, backend/src/app.js:27, backend/src/middleware/rateLimit.js:113-114, backend/src/routes/auth.routes.js:32-55,133, render.yaml:40-142 (no `TRUST_PROXY_HOPS` key), deploy-vps.sh:27 (health URL `http://127.0.0.1:4400`, i.e. the app sits behind a local reverse proxy), DEPLOY.md (no mention), README.md:121 (env table has no `TRUST_PROXY_HOPS` row) |
| Description | `TRUST_PROXY_HOPS` defaults to 0 and `app.set('trust proxy', 0)` makes `req.ip` the TCP peer. On Render (managed load balancer in front) and on the Hostinger VPS (app bound to 127.0.0.1:4400 behind a proxy for chatflow.mannmate.com) the TCP peer is the proxy, so `rl:<prefix>:ip:<proxy-ip>` is one shared bucket for all users. `grep -rn TRUST_PROXY` across the repo hits only env.js:17 and app.js:25-27. It is not in render.yaml, deploy-vps.sh, DEPLOY.md or README. |
| Steps to reproduce / Evidence | `otpLimiter` (auth.routes.js:43-49) counts every call, max 10 per 15 min per IP, so the 11th `/register/start`, `/register/resend` or `/forgot-password` in any 15-minute window platform-wide gets 429. `refreshLimiter` (51-55) allows 60/min, counts every call and also guards `/auth/exchange` (133). With more than 60 active tabs refreshing in the same minute, refreshes get 429 and every expired-token API call in the SPA fails with "Could not refresh your session (429)" (frontend/src/lib/api.js:67). `loginLimiter` counts failures only (max 20 per 15 min), so 20 wrong passwords from anyone, including one attacker, lock every user out of `/login`, `/register/verify` and `/reset-password` for 15 min. The same applies to `wa-verify` (5 per 15 min), `widget-ask` (12/min across every customer site), `assistant` (12/min), `form-post` (10/min) and `oauth-token`. |
| Expected | `TRUST_PROXY_HOPS=1` set in render.yaml and documented in DEPLOY.md/README for the VPS proxy; ideally a boot warning when `NODE_ENV=production` and `TRUST_PROXY_HOPS=0`. |
| Actual | Default 0 everywhere, so per-IP limits become global limits. The per-email `subject` bucket still works, which is why this is not a brute-force bypass. |
| Impact | Trivial platform-wide DoS of signup, password reset, login and token refresh; legitimate traffic alone trips the OTP limiter at modest volume. |
| Suggested fix | Add `TRUST_PROXY_HOPS: "1"` to render.yaml; add it to the VPS `.env` and DEPLOY.md; log a warning at boot in production when it is 0. |
| Effort | S |
| Related IDs | CF-102; Lead 3 |
| Audit working IDs | F-A1-009, F-I-001 |

### CF-028

**Sequence worker records Meta failures as DELIVERED and bypasses window, OptOut table and credits**

| Field | Value |
|---|---|
| Module | Sequences |
| Area | Backend |
| Status | BROKEN |
| Severity | High |
| Confidence | Confirmed |
| Location | backend/src/workers/sequence.worker.js:136-205 (esp. :142, :173-186, :194); backend/src/services/sequenceEngine.service.js:96-100, :222-225 |
| Description | `sendSequenceMessage` catches every Meta error (:183-185) and then writes a `Message` with `status: metaMsgId ? 'SENT' : 'DELIVERED'` (:194): a failed or never-attempted send (no `waNumber`, expired token, 131047) is stored as DELIVERED with `metaMessageId: null`, and `advanceEnrollment` records the step outcome `SENT` (:225) and advances. There is no `getWindowState` check (sequence messages are free-form text), no `consumeMessageCredit`, and the opt-out check is `contact.optedOut` only (:142). `findExitReason` (:96-100) queries `OptOut` by the raw `contact.phoneNumber` (contacts are mostly stored with `+`; rows are digits — `optout.service.js:12,:125`) and ignores `active`, so it never matches a blocked number and would wrongly block an unblocked one if it did. |
| Steps to reproduce / Evidence | Enrol a contact whose conversation has no `waNumber` → Message row DELIVERED, step run SENT, cadence continues; nothing was sent. |
| Expected | Failure → step/enrollment FAILED or deferred; window respected; `isOptedOut`; credits metered. |
| Actual | Fake DELIVERED rows; unmetered sends when they succeed; blocked numbers may be messaged. |
| Impact |  |
| Suggested fix | Route through `sendAutomatedReply` (already handles opt-out, window, persistence) and throw when it returns `null`; use `isOptedOut(workspaceId, phoneNumber)` in `findExitReason`. |
| Effort | S |
| Related IDs | Lead 4 |
| Audit working IDs | F-D-005 |

### CF-029

**`npm test` and all `scripts/*-check.mjs` write to whatever DATABASE_URL `.env` holds; the local-DB guard exists but nothing calls it**

| Field | Value |
|---|---|
| Module | Tests / Safety |
| Area | Backend |
| Status | DATA |
| Severity | High |
| Confidence | Likely (the static trace is complete; the developer's `.env` host was not inspected) |
| Location | backend/package.json (`"test": "node --env-file=.env ... --test \"src/**/*.test.js\""`), backend/scripts/assert-local-db.js:1-10, backend/scripts/{addon,ai-flow,auth,campaign,messaging,regression,waba}-check.mjs, backend/src/services/*.test.js (15 `deleteMany`/raw DELETE sites), backend/test_key_gen.js, backend/tests-qa2-automation.mjs |
| Description | `assert-local-db.js` says it "exists because a stale credential in a backup file once pointed the backend at a shared Supabase instance holding real customer workspaces. Any script that migrates, seeds, resets or truncates must run this first". A grep for `assert-local-db` / `assertLocalDatabase` across backend src, scripts and tests finds **only the file itself**; nothing imports it. The data-writing entry points are: - `npm test` loads `backend/.env`, and the service tests create workspaces, contacts and leads (e.g. conversations.service.test.js:27 `prisma.workspace.create`), then `deleteMany` them (15 sites). - The 7 `*-check.mjs` scripts import prisma (15-43 references each) and drive `http://127.0.0.1:4000`, which uses that same DB. - `test_key_gen.js` mints an API key for the first workspace it finds. MIGRATION_AUDIT.md:24-25 records that the developer `.env` held real production credentials, and deploy-vps.sh says the prod DB is shared across deployments. One `npm test` run against a `.env` pointing at prod therefore creates and deletes rows in the production database. |
| Steps to reproduce / Evidence | Static code trace at the cited Location lines; the trace is written out in the Description. |
| Expected |  |
| Actual |  |
| Impact | Test data leaks into production tenants' analytics and counts. A test `deleteMany` with a wrong filter could delete real data. |
| Suggested fix | Import `assertLocalDatabase()` at the top of a shared test setup file (`--import ./tests/setup.mjs`) and in every `*-check.mjs` / seed script. Point `npm test` at `.env.test`. |
| Effort | S |
| Related IDs | CF-209 |
| Audit working IDs | F-JT-002 |

### CF-030

**Add-ons do not stack, never renew, and silently expire after 30 days**

| Field | Value |
|---|---|
| Module | Add-ons |
| Area | Backend |
| Status | PARTIAL |
| Severity | Medium |
| Confidence | Confirmed |
| Location | backend/src/services/addons.service.js:14,38-50,89-116,177-193, backend/prisma/schema.prisma:1327-1345 (WorkspaceAddon @@unique), backend/src/services/customFields.service.js:38,57,152,162 |
| Description | (a) `createAddonOrder` refuses a second purchase while active (409), and `verifyAddonPayment` upserts the single `(workspaceId, addonKey)` row — so `addonAllowance`'s stated "buys the field pack twice gets ten fields" is impossible; a workspace can never have more than 5 custom fields / 3 events. (b) `PERIOD_DAYS = 30` with no renewal job anywhere (`billing.worker.js` only sweeps subscriptions); after 30 days `hasAddon/addonAllowance` return 0, so creating new fields is blocked and `listCustomFields` reports `allowed: 0` while existing fields remain. The UI copy says "/month" implying recurring. (c) A purchase made 2 days before expiry that hits the `existing.currentPeriodEnd > now` check is refused; after expiry, re-buying resets `currentPeriodEnd` from now (no proration or credit). |
| Steps to reproduce / Evidence | `addons.service.js:46-50`, :94-116 upsert; grep for `workspaceAddon` in workers → none. |
| Expected | Either quantity column with stacking, or copy saying "one pack"; renewal via wallet in the billing sweep or expiry notification. |
| Actual | One-shot 30-day purchase presented as a monthly subscription. |
| Impact | Customer confusion, silent feature loss, comment/behaviour mismatch. |
| Suggested fix | Add `quantity` and stack; renew in `runBillingCycleSweep` with wallet debit and PAST_DUE handling, or state "30-day pack". |
| Effort | M |
| Related IDs |  |
| Audit working IDs | F-B-012 |

### CF-031

**Admin "Payments" revenue double-counts Razorpay wallet top-ups and counts wallet-funded renewals as new money**

| Field | Value |
|---|---|
| Module | Admin / Billing |
| Area | Both |
| Status | DATA |
| Severity | Medium |
| Confidence | Confirmed |
| Location | backend/src/services/admin.service.js:536-590, backend/src/services/wallet.service.js:258-269, backend/src/services/subscription.service.js:460-471, frontend/src/pages/SuperAdminView.jsx:1034-1045 |
| Description | `getPaymentsAnalysis` sums all `Invoice(status:'PAID')` rows as `planRevenue` **plus** all `WalletTransaction(CREDIT, reason:'Wallet recharge (Razorpay)')` as `walletRevenue`. But `verifyTopupPayment` writes both an Invoice ("Wallet recharge") and the ledger credit for the same payment, so every top-up appears twice in `summary.total` and in the list (once labelled "Plan subscription" because `kind` is derived from the table, not the description). Renewal invoices (`subscription.service.js:461`) are wallet debits of money already counted at recharge time, and add-on invoices are labelled PLAN_SUBSCRIPTION. Demo/manual recharges (CF-001) are excluded by reason string but still inflate `getWalletSummary.totalRecharged`. |
| Steps to reproduce / Evidence | one ₹1,000 top-up → `payments` has two rows (Invoice + txn), `summary.total = 2000`. |
| Expected | Revenue = gateway-confirmed payments only, each once. |
| Actual | Over-reported by 2x on top-ups and by renewal amounts. |
| Impact | Wrong business metrics. |
| Suggested fix | Derive payments from `WalletTransaction.gateway='razorpay'` + Invoice rows whose reference is a Razorpay payment id not present in the ledger; tag invoices with a `kind` column. |
| Effort | S |
| Related IDs | CF-009 |
| Audit working IDs | F-B-011 |

### CF-032

**Impersonation sessions are indistinguishable from real user sessions, last 7 days, and the audit row drops the workspace**

| Field | Value |
|---|---|
| Module | Admin / Impersonation |
| Area | Both |
| Status | SECURITY |
| Severity | Medium |
| Confidence | Confirmed |
| Location | backend/src/services/auth.service.js:672-694, backend/src/controllers/admin.controller.js:183-195, backend/src/routes/admin.routes.js:9,69, frontend/src/pages/SuperAdminView.jsx:917-934, frontend/src/pages/Dashboard.jsx:3154-3165 |
| Description | `impersonateUser` mints an ordinary access+refresh pair for the target with no `act`/`impersonatedBy` claim and stores the refresh token under the target's `userId` — it shows in the target's own "Sessions" list as theirs, survives 7 days via refresh, and every server-side action under it is attributed to the target. The audit row is written after success with `meta.workspaceId: result?.user?.workspaceId`, but `result.user` has no `workspaceId` (it is `result.workspace.id`), so the field is always `null`; `reason` is optional. Route protection is sound (`requireSuperAdmin` re-checks the DB e-mail, authorize.js:68-81) and the platform admin cannot be impersonated (auth.service.js:675). |
| Steps to reproduce / Evidence | `POST /admin/platform/users/:id/impersonate`; `GET /users/me/sessions` as the target shows an extra session; `AdminAuditLog.meta.workspaceId` is null. |
| Expected | Short-lived impersonation token (e.g. 30 min, no refresh) carrying `impersonatorId`; correct workspace in audit. |
| Actual | Full 7-day session, unattributed. |
| Impact | Accountability gap; long-lived high-privilege token if the admin browser is compromised (admin tokens also parked in sessionStorage, SuperAdminView.jsx:929). |
| Suggested fix | Return only a short access token with `imp: adminUserId`; propagate to `req.user.impersonatedBy` in `authenticate`; fix `meta.workspaceId: result?.workspace?.id`. |
| Effort | S |
| Related IDs | CF-042 |
| Audit working IDs | F-A1-008 |

### CF-033

**`resolveUserId` falls back to *any* user in the database (cross-tenant attribution)**

| Field | Value |
|---|---|
| Module | AI Agents studio |
| Area | Backend |
| Status | DATA |
| Severity | Medium |
| Confidence | Confirmed |
| Location | backend/src/services/aiAgents.service.js:146-155, :176, :206, :486 |
| Description | When `userId` is falsy or no member row exists, `prisma.user.findFirst({ select: { id: true } })` (:153) with no filter stamps an arbitrary user from any workspace as `createdByUserId` on the SavedView row. |
| Steps to reproduce / Evidence | Static trace :153 unfiltered findFirst. |
| Expected | Use `req.user.id` or fail. |
| Actual | Silent cross-tenant attribution possible. |
| Impact | Audit-trail corruption; low practical exploitability since the controller always passes `req.user?.id`. |
| Suggested fix | Remove the fallback; throw 400 when no user id. |
| Effort | S |
| Related IDs | Lead 11 |
| Audit working IDs | F-CAI-002 |

### CF-034

**`crm.escalate_human` action is a no-op (touches `updatedAt` only)**

| Field | Value |
|---|---|
| Module | AI Agents studio |
| Area | Backend |
| Status | FAKE/STUB |
| Severity | Medium |
| Confidence | Confirmed |
| Location | backend/src/services/aiAgents.service.js:361-369 |
| Description | ACTION_REGISTRY (:102-106) promises "Transfers chat thread to CRM Sales Inbox and flags as Urgent". Implementation only runs `conversation.updateMany({ data: { updatedAt: new Date() } })`. The real handoff primitive `escalateToHuman` (intentRouting.service.js:120) is not used. |
| Steps to reproduce / Evidence | Static code trace at the cited Location lines; the trace is written out in the Description. |
| Expected | Set `humanHandoffAt`, status OPEN, notify workspace. |
| Actual | Nothing observable changes. |
| Impact | Misleading. |
| Suggested fix | Call `escalateToHuman`. |
| Effort | S |
| Related IDs | Lead 11 |
| Audit working IDs | F-CAI-004 |

### CF-035

**AI Agents studio test lab: hard-coded investment-fund replies, fake model name, keyword-triggered "actions" never executed, UI hides errors**

| Field | Value |
|---|---|
| Module | AI Agents studio |
| Area | Both |
| Status | FAKE/STUB |
| Severity | Medium |
| Confidence | Confirmed |
| Location | backend/src/services/aiAgents.service.js:8-65 (DEFAULT_AGENTS finance personas), :528-541 (keyword heuristics set `triggeredActions`), :571-594 (canned replies, `model: 'heuristic-simulator'`), :19/:137/:172/:563 (`gemini-1.5-flash` label regardless of `env.GEMINI_MODEL`); frontend/src/pages/AiAgentsView.jsx:312-345 |
| Description | (a) Default agents/guidelines are an investment-fund vertical (accredited investor, AML/KYC) shipped to every workspace. (b) `triggeredActions` are chosen by `lower.includes('invest'\|'call'\|'rep'\|'support'...)` string checks, not by the LLM, and nothing executes them (`grep -rn "actions/execute" frontend/src` -> none). (c) Without Gemini, the reply is one of four canned fund-marketing paragraphs; with Gemini the response labels the model as the stored 'gemini-1.5-flash' (retired) rather than the model actually used. (d) UI renders canned "Thank you for your message..." on HTTP error or network error, so failures look like answers. |
| Steps to reproduce / Evidence | Send "I want to talk to a rep about support" with no GEMINI_API_KEY -> canned support paragraph (:582); actions [crm.escalate_human]. |
| Expected | Honest "no LLM configured"; actions executed or labelled simulated. |
| Actual | Simulation presented as AI. |
| Impact | Misleading demo; customers may believe CRM actions occurred. |
| Suggested fix | Return `{ok:false}` when no LLM (as aiAgent.service.testAgent does); drop heuristics or label them; use `env.GEMINI_MODEL`; surface errors. |
| Effort | M |
| Related IDs | Lead 11 |
| Audit working IDs | F-CAI-005 |

### CF-036

**Channel deployments (Website / Instagram) in AI Agents studio are configuration-only; nothing reads them; "Connected & Active" is synthetic**

| Field | Value |
|---|---|
| Module | AI Agents studio |
| Area | Both |
| Status | FAKE/STUB |
| Severity | Medium |
| Confidence | Confirmed |
| Location | backend/src/services/aiAgents.service.js:379-425, :430-458, :499-514 |
| Description | `listChannels` derives "Connected & Active" purely from the saved `enabled` flag, never from a connected WhatsApp number/widget/Instagram account. Only `whatsapp` has an effect (copies name/prompt into `workspace.aiAgent*`, :505-512, and silently overwrites the AI Agent page's `aiAgentPrompt` while leaving purpose/instructions/safety untouched). `website`/`instagram` settings (greeting, delaySeconds, widgetPosition, replyToStoryMentions, businessHoursOnly, autoSyncCrm, fallbackToHuman) are stored in `SavedView(entity='ai_channel_bot')` and read by no other module (`grep -rn ai_channel_bot backend/src` -> this file only). |
| Steps to reproduce / Evidence | Static code trace at the cited Location lines; the trace is written out in the Description. |
| Expected | Drive widget/instagram responders or remove toggles. |
| Actual | Dead settings with green badges. |
| Impact | Misleading UX. |
| Suggested fix | Remove website/instagram cards or wire them. |
| Effort | M |
| Related IDs | Lead 11 |
| Audit working IDs | F-CAI-006 |

### CF-037

**AI Agents studio routes lack Zod validation and role authorization; VIEWER can rewrite the live WhatsApp agent prompt**

| Field | Value |
|---|---|
| Module | AI Agents studio |
| Area | Backend |
| Status | SECURITY |
| Severity | Medium |
| Confidence | Confirmed |
| Location | backend/src/routes/aiAgents.routes.js:8-21; backend/src/services/aiAgents.service.js:238-241, :473-478, :505-512 |
| Description | All mutations run with only `authenticate, workspaceContext`. `updateAgent`/`updateChannel` spread `req.body` into stored JSON (unbounded keys/size). Any member can `PUT /ai-agents/channels/whatsapp {assignedAgentId, enabled}` which rewrites `workspace.aiAgentPrompt` and `aiAgentEnabled` (bypassing deployAgent's LLM/prompt checks at aiAgent.service.js:252-268). |
| Steps to reproduce / Evidence | Static code trace at the cited Location lines; the trace is written out in the Description. |
| Expected | `authorize('ADMIN','CLIENT')` + strict schemas. |
| Actual | In-tenant privilege escalation over the live bot. |
| Impact |  |
| Suggested fix | Add authorize + Zod `.strict()`. |
| Effort | S |
| Related IDs | CF-004; Lead 11 |
| Audit working IDs | F-CAI-007 |

### CF-038

**Three separate AI-agent UIs on three endpoint families; the WhatsApp AI Agent tab (the only UI that can deploy the agent) is reachable only by deep link**

| Field | Value |
|---|---|
| Module | AI-Agents |
| Area | Frontend |
| Status | PARTIAL |
| Severity | Medium |
| Confidence | Likely |
| Location | frontend/src/components/AgentTab.jsx:55,108, frontend/src/pages/AiAgentsView.jsx:74-350, frontend/src/pages/AutomationView.jsx:87-89,2112-2280,3836-3843,3853, frontend/src/pages/Dashboard.jsx:3000,3112,782 |
| Description | (1) `AgentTab` in Lead/Deal detail uses `/agent/history/:type/:id` and `PATCH /agent/facts/:id`. (2) `AiAgentsView` (`/dashboard/ai-agent`) uses `/ai-agents*`, `/ai-agents/channels\|guidelines\|actions\|:id/test`, `PATCH /ai-agent/config`, knowledge via `/widgets/knowledge`. (3) `WhatsAppAIAgentTab` in AutomationView uses `/ai-agent/config\|campaigns\|deploy\|undeploy\|knowledge/upload\|test`. Clicking the "WhatsApp AI Agent" tab runs `selectTab` → `TAB_ROUTES['wa-agent']`, which navigates to `/dashboard/ai-agent`, so `AiAgentsView` renders instead; the tab only renders for a direct `/dashboard/automation?tab=wa-agent` link. AiAgentsView has no deploy/undeploy or knowledge upload and writes knowledge to a different store. |
| Steps to reproduce / Evidence | Code trace above. |
| Expected | One AI Agent screen covering config, deploy, knowledge and test. |
| Actual | Split, overlapping screens; deploy control orphaned. |
| Impact | Users cannot turn the WhatsApp AI agent on/off from navigation; two knowledge stores confuse users. |
| Suggested fix | Move deploy and upload into AiAgentsView, or point the TAB_ROUTES entry back at the Automation tab. |
| Effort | M |
| Related IDs | CF-039, CF-036 |
| Audit working IDs | F-H-022 |

### CF-039

**AI Agents "Channels" panel shows fabricated "Connected & Active" channels when the API returns none or fails**

| Field | Value |
|---|---|
| Module | AI-Agents |
| Area | Frontend |
| Status | FAKE/STUB |
| Severity | Medium |
| Confidence | Confirmed |
| Location | frontend/src/pages/AiAgentsView.jsx:124-135,757-761 |
| Description | `(channels.length > 0 ? channels : [ {WhatsApp Cloud API, 'Investor Qualification Agent', 'Connected & Active'}, {Website Live Chat Widget, 'Fund Information Agent', 'Connected & Active'}, {Instagram DM, 'Investor Support Agent', 'Standby / Ready'} ])`. `loadChannels` only logs errors, so a failure also shows this demo data. |
| Steps to reproduce / Evidence | Code trace above. |
| Expected | Empty state or error. |
| Actual | Hard-coded demo data from another product domain shown as live status. |
| Impact | Tenants are told channels are connected to agents that do not exist. |
| Suggested fix | Remove the fallback array; render empty/error state. |
| Effort | S |
| Related IDs | CF-035, CF-036, CF-038 |
| Audit working IDs | F-H-023 |

### CF-040

**API Keys "Send test message" posts to a route that does not exist**

| Field | Value |
|---|---|
| Module | API Management (workspace API keys) |
| Area | Both |
| Status | BROKEN |
| Severity | Medium |
| Confidence | Confirmed |
| Location | frontend/src/pages/ApiKeysView.jsx:191 (`wFetch('/api-keys/test-message', {method:'POST'})`), :398 (button); backend/src/routes/apiKeys.routes.js (no `test-message` route; `grep -rn test-message backend/src/routes` is empty); frontend/src/pages/ApiKeysView.jsx:191, backend/src/routes/apikeys.routes.js:1-41 (no `test-message` route), backend/src/controllers/apikeys.controller.js:71-78 (`testMessage`, unreferenced), backend/src/services/apikeys.service.js:380-526 (`sendTestMessage`); frontend/src/pages/ApiKeysView.jsx:191-199, backend/src/routes/apikeys.routes.js:9-40 (routes: `/`, `/authentication`, `/authentication/rotate`, `/scopes`, `/:id/rotate`, `/:id`); `grep -rn "test-message" backend/src` → no results; MIGRATION_AUDIT.md:404-422 |
| Description | The test panel validates phone/template/variables client-side, then POSTs to `/workspaces/:id/api-keys/test-message`, which Express answers with 404. The button can never succeed. |
| Steps to reproduce / Evidence | Static code trace at the cited Location lines; the trace is written out in the Description. |
| Expected | Route exists (or the panel calls `/public/messages` with the key). |
| Actual | Always "Request failed (404)". |
| Impact | Dead feature on the API onboarding screen; customers cannot verify a key from the UI. |
| Suggested fix | Implement `POST /api-keys/test-message` (send via conversations.service with the workspace's number) or remove the panel. |
| Effort | S |
| Related IDs |  |
| Audit working IDs | F-core-017, F-A1-021, F-CCON-001, F-J-014 |

### CF-041

**Role floor is prefix-based: `authorize('AGENT')` on activities is dead, and AGENT gains paid sends, inbound simulation, contact import/delete**

| Field | Value |
|---|---|
| Module | Auth / Roles |
| Area | Backend |
| Status | SECURITY |
| Severity | Medium |
| Confidence | Confirmed |
| Location | backend/src/middleware/roleCapabilities.js:104-112,146-161, backend/src/routes/activities.routes.js:13, backend/src/routes/conversations.routes.js:12,24-32, backend/src/routes/contacts.routes.js:15-23; backend/src/routes/campaigns.routes.js (launch behind authorize('CLIENT')), backend/src/routes/conversations.routes.js:29, backend/src/routes/public.routes.js:56 |
| Description | `checkRoleCapability` runs inside `workspaceContext`, i.e. before any per-route `authorize`. VIEWER: every non-GET under `/workspaces/:id/*` is denied → VIEWER can write to nothing under the ws router (but see CF-005). AGENT: writes are allowed for the whole subtree of `/conversations`, `/contacts`, `/opt-outs`, `/blocked-numbers`, `/ai-agent/test`. Consequences: (a) `activities.routes.js:13` `authorize('AGENT')` on `POST /activities` is unreachable — the floor 403s agents first, so "AGENT logs activities" (crmPermissions.service.js:7) is false. (b) Under `/conversations` an AGENT may `POST /:id/template` (paid template send), `POST /:id/reopen-window` (paid), `POST /:id/inbound-simulate` (fabricates inbound messages), `POST /:id/media`, `POST /` (open a conversation with any number). (c) Under `/contacts` an AGENT may `POST /import` (bulk CSV), `DELETE /:id`, and `GET /export` (full PII dump — also available to VIEWER since it is a GET). |
| Steps to reproduce / Evidence | roleCapabilities.js:158 `relative.startsWith('/conversations/')` → allowed; conversations.routes.js:29 has no `authorize`. `POST /activities` as AGENT → 403 `ROLE_NOT_PERMITTED` from workspaceContext.js:209 before line 13's `authorize('AGENT')` runs. |
| Expected | Capability list consistent with documented semantics; agents cannot spend wallet or fabricate inbound; VIEWER cannot bulk-export PII. |
| Actual | Prefix allow-list grants the whole resource subtree. |
| Impact | In-tenant escalation: AGENT can incur paid sends, delete/import contacts; VIEWER/AGENT can export all contacts. |
| Suggested fix | Make the AGENT allow-list method+path specific, add `authorize('CLIENT')` to `/:id/template`, `/reopen-window`, `/inbound-simulate`, `/contacts/import\|export`, `DELETE /contacts/:id`; put `POST /activities` on the agent allow-list. |
| Effort | M |
| Related IDs | CF-078; Lead 7 |
| Audit working IDs | F-A2-002, F-B-020 |

### CF-042

**Refresh tokens stored in plaintext, no reuse detection, and every refresh re-scopes the session to the earliest-joined workspace**

| Field | Value |
|---|---|
| Module | Auth / Sessions |
| Area | Both |
| Status | SECURITY |
| Severity | Medium |
| Confidence | Confirmed |
| Location | backend/src/services/auth.service.js:39-44, backend/src/services/auth.service.js:143-187, backend/src/services/auth.service.js:659-666, backend/prisma/schema.prisma:890-897, frontend/src/lib/api.js:36-77, backend/src/controllers/oauth.controller.js:95-97,154 |
| Description | (a) `storeRefreshToken` writes the raw JWT into `RefreshToken.token`; anyone with DB read access (backup, dump, SQLi) holds 7-day bearer credentials. (b) `refresh()` deletes the presented token and issues a new one, but a token that is not found is just a 401 — no family tracking, so a stolen token used once by an attacker silently logs the victim out and the attacker keeps a fresh chain; nothing is revoked. (c) `refresh()` recomputes `workspaceId`/`role` from `workspaceMember.findFirst(orderBy joinedAt asc)`, not from the workspace the session was minted for by `switchWorkspace`/`mintSessionForWorkspace`. The SPA stores the new access token but keeps `user.workspaceId` in localStorage unchanged, so URL-scoped calls still target the switched workspace while claim-scoped endpoints (`/oauth/consent-info`, `/oauth/consent/decide`, `/auth/meta/start` default, `/users/me`) silently act on the earliest workspace. |
| Steps to reproduce / Evidence | User in workspaces A (joined first) and B: `POST /workspaces/B/switch` -> JWT.workspaceId=B; after 15 min any request 401 -> `api.js` refreshes -> new JWT.workspaceId=A, role=A's role. Approving an OAuth consent now creates the API key in A (oauth.controller.js:154). |
| Expected | Store a hash of the refresh token; carry `workspaceId` in the refresh token payload/row and re-mint for that workspace; on unknown-token presentation revoke the user's tokens (reuse detection). |
| Actual | Plaintext, unscoped, no reuse detection. |
| Impact | Credential exposure on DB compromise; wrong-workspace actions after refresh; silent session hijack. |
| Suggested fix | `RefreshToken { tokenHash, workspaceId, familyId }`; hash on store/lookup. |
| Effort | M |
| Related IDs | CF-025; Lead 12 |
| Audit working IDs | F-A1-007 |

### CF-043

**Authentication dashboard KPIs are all-time and its filters only apply to the last 20 transactions**

| Field | Value |
|---|---|
| Module | Authentication (OTP product) |
| Area | Both |
| Status | PARTIAL |
| Severity | Medium |
| Confidence | Confirmed |
| Location | backend/src/authentication/authentication-config.service.js:303-330 (`groupBy` with no date filter; `recent` = `take: 20`); frontend/src/pages/AuthenticationDashboard.jsx:337, :383-400, :426-431 (date range "All loaded / Today / 7d / 30d", status, source, template and search filters run over `recent` in memory) |
| Description | The KPI tiles (requests, accepted, delivered, verified, expired, failed) ignore the selected range, and the transactions table can never show more than the 20 newest rows; "Last 30 days" filters those 20. There is no pagination, no server-side search, and no export. |
| Steps to reproduce / Evidence | Static code trace at the cited Location lines; the trace is written out in the Description. |
| Expected | Range-aware aggregates and paginated/searchable transactions. |
| Actual | Misleading filters; anything older than the 20th transaction is unreachable. |
| Impact |  |
| Suggested fix | Accept `from/to/page/search` in `getAuthenticationUsage`. |
| Effort | M |
| Related IDs |  |
| Audit working IDs | F-core-023 |

### CF-044

**Workflow create/update accepts `nodes: z.any()`; the engine silently truncates at 20 steps and ignores `edges`**

| Field | Value |
|---|---|
| Module | Automation / Workflows |
| Area | Backend |
| Status | PARTIAL |
| Severity | Medium |
| Confidence | Confirmed |
| Location | backend/src/validators/index.js:225-237 (`nodes: z.any()`, `edges: z.any()`), backend/src/services/workflow.service.js:10-40 (stored verbatim, no validation), backend/src/services/workflowEngine.service.js:13 (`MAX_ACTIONS = 20`), :101-104 (`.slice(0, MAX_ACTIONS)`), backend/src/services/workflowCompiler.service.js:91 (`validateGraph` exists but is not used by create/update) |
| Description | The API accepts any JSON for `nodes` (a string, `null`, objects with unknown subtypes, unbounded length). Only the frontend validates (AutomationView.jsx:1486-1500). At runtime `actionsOf()` drops everything past step 20 with no error and no trace entry; unknown action subtypes are recorded as `skipped` (`workflowEngine.service.js:577`). `edges` is stored and never read anywhere in the engine (`grep -n edges workflowEngine.service.js` → none); the UI always sends `edges: []` (AutomationView.jsx:738). |
| Steps to reproduce / Evidence | `POST /workspaces/:ws/workflows {"name":"x","nodes":"garbage","isActive":true}` → 201; `PATCH` with 25 action nodes → saved, steps 21-25 never run. |
| Expected | Server-side schema (reuse `validateGraph`), 400 on >20 steps, drop `edges` from the API. |
| Actual | Bad data persisted; silent truncation. |
| Impact | API clients can create workflows the engine cannot run; misleading run history. |
| Suggested fix | Wire `validateGraph` into `workflowSchemas` via `superRefine`; enforce MAX_ACTIONS at save time; remove `edges`. |
| Effort | S |
| Related IDs | Lead 13 |
| Audit working IDs | F-CAI-011 |

### CF-045

**`missed` (Missed Inbound Call) workflow trigger is offered in the builder but no code ever emits `event: 'missed_call'`**

| Field | Value |
|---|---|
| Module | Automation / Workflows |
| Area | Both |
| Status | FAKE/STUB |
| Severity | Medium |
| Confidence | Confirmed |
| Location | frontend/src/pages/AutomationView.jsx:1122 (`['missed', 'Missed Inbound Call']`), :1153 (NO_CONFIG_SUBTYPES), backend/src/services/workflowEngine.service.js:115-116 (`case 'missed': return event === 'missed_call'`), backend/src/services/webhook.service.js:650-655 (only `event: 'message'` is ever passed) |
| Description | `grep -rn "missed_call" backend/src --include=*.js \| grep -v workflowEngine` returns nothing. The voice webhook (voice.controller.js) never calls `runWorkflowsForInbound` with a missed-call event either. A workflow saved with this trigger is silently inert. |
| Steps to reproduce / Evidence | Static code trace at the cited Location lines; the trace is written out in the Description. |
| Expected | Hide the option or emit the event from the voice/status webhook. |
| Actual | Dead trigger. |
| Impact | Misleading UX; customer builds automation that never fires. |
| Suggested fix | Remove from TRIGGER_SUBTYPES or emit from voice `status` handler. |
| Effort | S |
| Related IDs | Lead 13 |
| Audit working IDs | F-CAI-012 |

### CF-046

**Autonomous agent has no workspace on/off switch, no plan gate, no admin UI for its queue, and sweeps every workspace (first 500 only)**

| Field | Value |
|---|---|
| Module | Autonomous agent |
| Area | Both |
| Status | PARTIAL |
| Severity | Medium |
| Confidence | Confirmed |
| Location | backend/src/workers/agent.worker.js:22-25 (`workspace.findMany({ take: 500 })`), :37-46 (sweep loop), backend/src/services/agent.service.js:113-153 (`sweepWorkspace` - no enabled flag), backend/src/routes/agent.routes.js:44 (`GET /pending` - no frontend caller; `grep -rn "agent/pending\\|agent/run" frontend/src` → none), docs/AGENT_ROADMAP.md:64-65 (items 2.10 "Workspace on/off switch" and 2.11 "Admin view" listed as unbuilt), backend/prisma/schema.prisma (no `agentEnabled`-style column; grep returns none) |
| Description | The BullMQ `sweep` job books `schedule_followup` tasks (creates real CRM tasks on quiet deals) and `advance_contacted` (moves NEW leads to CONTACTED) for every workspace on the platform, regardless of plan and with no way for a workspace to opt out. Workspaces beyond the first 500 rows are silently never swept. `actorUserId` is `null` from the worker, so created tasks are assigned to `deal.ownerUserId ?? undefined` (unassigned) and audit rows have no actor. Only the per-record "Agent" tab (AgentTab.jsx on Leads/Deals) and `PATCH /agent/facts/:id` are wired in the UI; `/agent/run` (ADMIN) and `/agent/pending` have no UI. |
| Steps to reproduce / Evidence | Static trace as above. Evidence ledger itself is real (agent.tools.js:10-96 `verify()` queries messages/tasks/score; agent.evidence.js scoring) - no issue there; SENSITIVE deny-list (agent.tools.js:178-192) is enforced in `runTask` (agent.service.js:166). |
| Expected | Per-workspace toggle, plan gate, admin view; paginate the sweep. |
| Actual | Always-on for all tenants. |
| Impact | Unexpected lead status changes / tasks in customer CRMs; scaling cliff at 500 workspaces. |
| Suggested fix | Add `Workspace.agentEnabled` (default false), check in `sweepWorkspace`; cursor-paginate; render `/agent/pending` in SuperAdmin. |
| Effort | M |
| Related IDs |  |
| Audit working IDs | F-CAI-013 |

### CF-047

**Autonomous-agent sweep covers only the first 500 workspaces in arbitrary order and includes suspended workspaces**

| Field | Value |
|---|---|
| Module | Autonomous agent |
| Area | Backend |
| Status | RELIABILITY |
| Severity | Medium |
| Confidence | Confirmed |
| Location | backend/src/workers/agent.worker.js:22-25, :37-45; backend/src/services/agent.service.js:113-150; backend/prisma/schema.prisma (Workspace.suspended, ~:88) |
| Description | `activeWorkspaceIds()` is `workspace.findMany({ select: {id: true}, take: 500 })` — no `where` (the `suspended` flag exists on Workspace) and no `orderBy`, so Postgres returns an arbitrary 500; workspaces beyond that are never swept, and which ones is nondeterministic between runs. There is no per-workspace opt-in, so every tenant's NEW leads and quiet deals get `advance_contacted` / `schedule_followup` tasks booked (agent.service.js:135-150), including suspended tenants. Per-workspace sweep errors are swallowed (`.catch(() => ({ booked: 0 }))`, agent.worker.js:41). |
| Steps to reproduce / Evidence | Code trace above. |
| Expected | Paginated sweep over non-suspended (and opted-in / plan-gated) workspaces, errors logged. |
| Actual | As described. |
| Impact | Unrequested automated CRM changes in suspended workspaces; no coverage beyond 500 tenants. |
| Suggested fix | `where: { suspended: false, <opt-in flag> }`, cursor-paginate ordered by id, log sweep failures. |
| Effort | S |
| Related IDs | CF-046; Lead 15 |
| Audit working IDs | F-E-013 |

### CF-048

**Unbounded `findMany` inventory — 176 of 231 call sites have no `take`; the user-facing ones that matter are listed here**

| Field | Value |
|---|---|
| Module | Backend perf (Analytics, CRM, Campaigns, Admin) |
| Area | Backend |
| Status | PERF |
| Severity | Medium |
| Confidence | Confirmed (per-site read for the rows below; the count comes from a heuristic) |
| Location | see table |
| Description | `node C:\Users\thete\.claude\jobs\d1cefbb9\tmp\findmany.mjs` statically scans `backend/src` (non-test) and reports "231 findMany total, 176 without take". The heuristic looks for `take:`, so shorthand `skip, take,` counts as a false positive. `admin.service.js:646` (user list) is one and is actually paginated. The sites below were read by hand and are genuinely unbounded on tenant-sized data: \| Site \| Model \| What it loads \| Risk \| \|---\|---\|---\|---\| \| services/deals.service.js:44 \| deal + DEAL_INCLUDE \| Every deal in the workspace for the board, no skip/take, and `count` is computed but not used to paginate \| Deal board grows without bound \| \| services/tasks.service.js:28 \| task + TASK_INCLUDE \| Every task matching the filters, no pagination \| Same \| \| services/analytics.service.js:100 \| campaignRecipient \| Every recipient sent or delivered in the window (select 2 cols) \| Up to hundreds of thousands of rows in memory per dashboard load \| \| services/analytics.service.js:370 \| campaignRecipient **include campaign include template** \| Each recipient row carries a full Campaign row plus template, so a 100k-recipient campaign duplicates the Campaign row 100k times \| Heavy include; the aggregation should be a `groupBy`/SQL \| \| services/analytics.service.js:457,463 \| contact, message (inbound) \| Every contact created and every inbound message in N weeks \| Large \| \| services/contacts.service.js:112 \| contact.tags \| Every contact that has tags, just to build a distinct tag list \| O(contacts) per filter-panel open \| \| services/crmExport.service.js:43,64,86,105 \| lead/deal/task/product with includes \| Full export built in memory \| Acceptable for export but should stream \| \| services/admin.service.js:20 \| numberPool \| Whole pool, super-admin only \| Low \| \| services/campaigns.service.js:552,633 and workers/campaign.worker.js:401 \| campaignRecipient include contact, status PENDING \| Every pending recipient with the full contact row, loaded into worker memory in one go \| Memory spike on big campaigns (CF-053) \| \| server.js:172 \| workspace include subscription \| All tenants at boot \| CF-204 \| |
| Steps to reproduce / Evidence | Static code trace at the cited Location lines; the trace is written out in the Description. |
| Expected |  |
| Actual |  |
| Impact |  |
| Suggested fix | Add cursor pagination (`take` + `cursor`) to the deals and tasks lists. Replace analytics row scans with `groupBy` / `$queryRaw` date_trunc aggregates. Make the tag list a `SELECT DISTINCT unnest(tags)`. Stream exports. |
| Effort | M |
| Related IDs |  |
| Audit working IDs | F-G-001 |

### CF-049

**No plan change/cancel/downgrade API — `pendingPlanId` and `cancelAtPeriodEnd` are never set**

| Field | Value |
|---|---|
| Module | Billing |
| Area | Both |
| Status | MISSING |
| Severity | Medium |
| Confidence | Confirmed |
| Location | backend/src/routes/subscription.routes.js:10-20, backend/src/routes/admin.routes.js (no subscription route), backend/src/services/subscription.service.js:390-415, frontend/src/pages/PaymentsView.jsx:695-707,819 |
| Description | README §12.5 specifies `PATCH /workspaces/:id/subscription` and `PATCH /admin/platform/workspaces/:id/subscription`; neither exists (routes.md confirms). `pendingPlanId`/`cancelAtPeriodEnd` are only ever cleared (`subscription.service.js:313,409`, `server.js:160`) and read by the sweep — nothing sets them. The Payments UI renders "Cancels on"/"Switching to … next cycle" states that cannot occur and shows "Contact support to downgrade" with no support path. A paid plan cannot be cancelled: renewals keep debiting the wallet (`subscription.service.js:438`) until it empties, then PAST_DUE → EXPIRED locks the workspace (`workspaceContext.js:319`). |
| Steps to reproduce / Evidence | `grep cancel PaymentsView.jsx` → only add-on cancel; no PATCH under `/subscription` in routes.md. |
| Expected | Endpoints to schedule downgrade, cancel at period end, and a super-admin override (comp plan / extend cycle). |
| Actual | Missing. |
| Impact | Customers cannot stop being charged except by emptying the wallet and getting locked out; admin cannot comp accounts. |
| Suggested fix | Implement `PATCH /subscription {planId\|cancelAtPeriodEnd}` (validate member/contact counts on downgrade) and the admin override. |
| Effort | M |
| Related IDs | CF-010; Lead 16 |
| Audit working IDs | F-B-007 |

### CF-050

**Wallet-funded renewals + PAST_DUE/EXPIRED flow has no customer-facing renew action and no Razorpay auto-charge**

| Field | Value |
|---|---|
| Module | Billing |
| Area | Both |
| Status | PARTIAL |
| Severity | Medium |
| Confidence | Confirmed |
| Location | backend/src/services/subscription.service.js:369-523, backend/src/middleware/workspaceContext.js:318-324, frontend/src/pages/PaymentsView.jsx:297-330 |
| Description | Renewals are debited from the prepaid wallet only (`debit(... category:'SUBSCRIPTION')`). There is no Razorpay recurring mandate. When the wallet is short the sub goes PAST_DUE (3-day grace) then EXPIRED, and the notification says "renew from the Payments screen" — but the only path back is buying the same plan again via `/subscription/checkout` (which starts a fresh period, fine) or topping up the wallet and waiting for the next daily sweep (02:00) — there is no "retry renewal now" endpoint. Also `renewalCharge` infers quarterly vs monthly from period length (≥80 days) rather than a stored cycle field; a manually extended period could be billed at the quarterly price. |
| Steps to reproduce / Evidence | grep `sub_renew_` → only sweep; no `/subscription/renew`. |
| Expected | Documented renewal source, immediate retry after top-up, stored `billingCycle` column. |
| Actual | Works but opaque; customers can be locked out for up to 24h after topping up. |
| Impact | UX/lockout; plan-price inference risk. |
| Suggested fix | Trigger `runBillingCycleSweep` for that workspace after a successful top-up when status is PAST_DUE/EXPIRED; add `Subscription.cycle`. |
| Effort | S |
| Related IDs | CF-049 |
| Audit working IDs | F-B-013 |

### CF-051

**Plan feature flags are almost entirely unenforced versus what the landing page sells**

| Field | Value |
|---|---|
| Module | Billing / Feature gating |
| Area | Both |
| Status | PARTIAL |
| Severity | Medium |
| Confidence | Confirmed |
| Location | backend/src/middleware/requireFeature.js, backend/src/routes/automation.routes.js:16, backend/src/routes/instagram.routes.js:12, backend/src/routes/workflow.routes.js:11, backend/src/controllers/integrations.controller.js:16, backend/src/controllers/onboarding.controller.js:211, backend/src/server.js:73,91,106, backend/src/data/siteContent.js:133-150 |
| Description | `requireFeature` is mounted on exactly three routers (automation, instagram, workflow) and `hasFeature` in integrations/aiOnboarding. FREE seeds `{automation:true, workflows:true}`, so the only gates that ever bite are `integrations` and `aiOnboarding` on Free. Landing copy sells Growth-only "Campaign AI Agent", "AI intent matching", "Retries with SMS and email fallback", "Voice AI and Instagram flows", "Revenue and delivery analytics", and Basic "1 WhatsApp number" — none has a flag or limit (`Plan` has no `numberLimit`; campaignAi/voice/fallback/analytics have no feature check; instagram is gated on `automation`, which Free has). `campaignLimit` is null on every plan so `assertWithinLimit('campaign')` (`campaigns.service.js:246`) is a no-op. |
| Steps to reproduce / Evidence | A Free workspace can use Campaign AI, SMS fallback, Voice AI, Instagram and connect multiple numbers. |
| Expected | Flags per advertised feature, or honest copy. |
| Actual | Upsell claims not backed by enforcement. |
| Impact | Lost upgrade revenue; misleading marketing. |
| Suggested fix | Add `features.campaignAi/voice/instagram/fallback/analytics` + `numberLimit`; enforce in the respective routes; align `siteContent.js`. |
| Effort | M |
| Related IDs | CF-008; Lead 16 |
| Audit working IDs | F-B-009 |

### CF-052

**Billing details (business name, email, address, GSTIN) are saved only in localStorage, never sent to the server, and not cleared on logout**

| Field | Value |
|---|---|
| Module | Billing / Payments |
| Area | Frontend |
| Status | BROKEN |
| Severity | Medium |
| Confidence | Confirmed |
| Location | frontend/src/pages/PaymentsView.jsx:172-180,361-366,651-658, frontend/src/lib/api.js:78-83; frontend/src/pages/PaymentsView.jsx:98-102,172,361-366,625-660, backend/src/services/settings.service.js getInvoiceDocument (Billed to = workspace name only), backend/src/controllers/settings.controller.js:18-23 |
| Description | `handleSaveBilling` only does `localStorage.setItem('ChatFlow Pro_billing_details', ...)` and shows success. No API call, so invoices cannot carry GSTIN/address and details don't follow the user across devices. `clearStoredSession` removes only tokens and `user`, so the next person signing in on that browser sees the previous tenant's business details pre-filled. |
| Steps to reproduce / Evidence | Code trace above. |
| Expected | Persisted via a workspace billing-profile endpoint and used on invoices. |
| Actual | Browser-only save. |
| Impact | Wrong GST invoicing; business details leak between accounts on shared machines. |
| Suggested fix | Persist via `PATCH /settings` or a billing-profile endpoint; delete the localStorage key. |
| Effort | M |
| Related IDs |  |
| Audit working IDs | F-H-024, F-B-014 |

### CF-053

**Campaign worker loads all pending recipients at once and re-reads the campaign row before every send**

| Field | Value |
|---|---|
| Module | Campaign worker |
| Area | Backend |
| Status | PERF |
| Severity | Medium |
| Confidence | Confirmed |
| Location | backend/src/workers/campaign.worker.js:401-416 |
| Description | `prisma.campaignRecipient.findMany({ where: { campaignId, status: 'PENDING' }, include: { contact: true } })` has no batching, even though `CAMPAIGN_BATCH_SIZE` exists in env.js:82 and nothing uses it (CF-148). The loop then runs `prisma.campaign.findUnique({ select: { status } })` for **every** recipient (line 411) to detect pause or cancel. A 100k-recipient campaign holds 100k contact rows in memory and issues 100k extra round-trips on a pool of 3 connections (CF-097). |
| Steps to reproduce / Evidence | Static code trace at the cited Location lines; the trace is written out in the Description. |
| Expected |  |
| Actual |  |
| Impact |  |
| Suggested fix | Page through recipients in `CAMPAIGN_BATCH_SIZE` chunks with a cursor. Check pause/cancel once per chunk, or every N sends / every few seconds. |
| Effort | S |
| Related IDs | CF-097, CF-148 |
| Audit working IDs | F-G-002 |

### CF-054

**Campaign wizard "Reply Flows" (step 6) and "Conversion Tracking" (step 8) are persisted but never executed**

| Field | Value |
|---|---|
| Module | Campaigns |
| Area | Both |
| Status | FAKE/STUB |
| Severity | Medium |
| Confidence | Confirmed |
| Location | frontend/src/pages/CreateCampaign.jsx:921-1030 (StepReplyFlows), :1135-1190 (StepTracking), :1847-1849; backend/src/services/campaigns.service.js:296-300, :371-373; backend/src/validators/index.js:105-108 (`replyRules: z.any()`, `trackingConfig: z.any()`) |
| Description | The wizard lets the user define keyword auto-reply rules (reply/assign/optout actions) and UTM/conversion-event tracking and marks the steps "done". The backend stores the JSON on the Campaign row and that is the end of it: `grep -rn replyRules\\|trackingConfig backend/src` matches only campaigns.service.js (store) and validators (z.any). No worker, webhook handler or inbound-message path reads them, and no UTM is appended to any URL. Step 8 also ignores `initial` so reopening a draft shows an empty tracking form even though `trackingConfig` was saved (CreateCampaign.jsx:1605 vs :1135). |
| Steps to reproduce / Evidence | create a campaign with a reply rule "contains hi -> reply X"; send "hi" inbound; nothing fires (inbound path uses workflows/automation only). |
| Expected | Either execute the rules or mark the steps as not yet functional. |
| Actual | Silent no-op presented as configured. |
| Impact | Misleading feature; customers rely on auto-replies that never happen. |
| Suggested fix | Implement in the inbound handler keyed by campaignRecipient -> campaign.replyRules, or remove the steps. |
| Effort | M |
| Related IDs | CF-142 |
| Audit working IDs | F-core-006 |

### CF-055

**Main campaign loop: an exception after Meta accepted the message triggers a retry → duplicate send**

| Field | Value |
|---|---|
| Module | Campaigns |
| Area | Backend |
| Status | RELIABILITY |
| Severity | Medium |
| Confidence | Confirmed |
| Location | backend/src/workers/campaign.worker.js:539-599, :600-614 |
| Description | Everything after `sendWhatsAppMessage` succeeds (:539) — `campaignRecipient.update` to SENT (:553), `claimRecipientCharge` (:563), `campaign.update` (:566), `conversation.create`/`message.create` (:578-597; the `message.create` is not caught) — is inside the same `try`. Any throw there (pool timeout, P2002 on `metaMessageId`, a transient DB error) goes to the catch, which releases the credit (:606), marks `initialStatus: FAILED` and calls `handleRecipientFailure` (:613) → the recipient is scheduled for retry (RETRYING, retry job) although the customer already received the message. The retry path has the same shape (:271-330, message persistence swallowed with `.catch(() => null)` at :314/:326, so there it silently loses the Message row and all later status webhooks for it instead). |
| Steps to reproduce / Evidence | Code trace; make `message.create` throw (e.g. DB hiccup) → log `send failed … ` followed by `Retry scheduled` for a number that got the template. |
| Expected | Once Meta returns a message id, the recipient is SENT regardless of bookkeeping failures (bookkeeping retried separately). |
| Actual | Duplicate template send; credit released for a message that was delivered. |
| Impact | Duplicate paid messages; billing undercount. |
| Suggested fix | Split into `try { send } catch { failure }` and a separate guarded bookkeeping block that never routes to `handleRecipientFailure`. |
| Effort | S |
| Related IDs | CF-097 |
| Audit working IDs | F-E-014 |

### CF-056

**Fallback SMS ignores WhatsApp opt-out and is unmetered**

| Field | Value |
|---|---|
| Module | Campaigns / Fallback |
| Area | Backend |
| Status | BILLING |
| Severity | Medium |
| Confidence | Confirmed |
| Location | backend/src/services/fallback.service.js:46-60,81-108, backend/src/services/retry.service.js:236-238,274-276 |
| Description | When a WhatsApp send permanently fails, `runFallbackForRecipient` sends Twilio SMS from platform credentials (`env.TWILIO_ACCOUNT_SID`) with no per-SMS charge to the workspace and no `isOptedOut` check (the recipient was checked before the WhatsApp attempt, but an opt-out arriving between attempt and fallback is not re-checked, and there is no SMS-specific consent at all). |
| Steps to reproduce / Evidence | code paths above; no `debit` import in fallback.service. |
| Expected | SMS metered at an SMS rate; opt-out re-checked. |
| Actual | Platform absorbs Twilio cost; possible unsolicited SMS. |
| Impact | Money (platform), compliance (TRAI DND). |
| Suggested fix | Add `SMS` category rate and `debit` per successful SMS; re-check opt-out; require DLT template. |
| Effort | S |
| Related IDs | CF-007 |
| Audit working IDs | F-B-015 |

### CF-057

**A throw between the retry claim and the send leaves the recipient IN_PROGRESS; campaign cannot complete until reboot**

| Field | Value |
|---|---|
| Module | Campaigns / Retry |
| Area | Backend |
| Status | RELIABILITY |
| Severity | Medium |
| Confidence | Confirmed |
| Location | backend/src/workers/campaign.worker.js:177-186, :193, :331-341; backend/src/services/retry.service.js:56-62, :127-148 |
| Description | `processRetryJob` claims the recipient (`retryStatus → IN_PROGRESS`, :177-180) and then calls `decrypt(...)` at :186, *before* the `try` at :193. If it throws, BullMQ retries the job, but every retry now fails the claim (`retryStatus: {not: 'IN_PROGRESS'}`) and returns "already claimed elsewhere". The recipient stays `status RETRYING / retryStatus IN_PROGRESS`; `checkAndCompleteCampaign` counts RETRYING as pending (:57-62), so the campaign never completes, never reconciles counters, never settles its refund. Only a restart un-sticks it (`recoverPendingRetries` resets IN_PROGRESS→SCHEDULED, :144-148). A process crash mid-retry produces the same stuck state until the next boot. |
| Steps to reproduce / Evidence | Rotate `ENCRYPTION_KEY` while a campaign has scheduled retries → each retry job throws once in decrypt, then logs "already claimed elsewhere" on attempts 2-3; row stuck. |
| Expected | Any failure after the claim releases it or routes into `handleRecipientFailure`. |
| Actual | Stuck until reboot. |
| Impact | Campaign completion, counters and refund blocked. |
| Suggested fix | Move `decrypt` inside the try; add a periodic (not boot-only) sweep for `retryStatus IN_PROGRESS AND lastRetryAt < now()-10 min`. |
| Effort | S |
| Related IDs | CF-012 |
| Audit working IDs | F-E-003 |

### CF-058

**Pausing a non-authentication campaign does not stop its scheduled retries**

| Field | Value |
|---|---|
| Module | Campaigns / Retry |
| Area | Backend |
| Status | BROKEN |
| Severity | Medium |
| Confidence | Confirmed |
| Location | backend/src/workers/campaign.worker.js:145-148; backend/src/services/campaigns.service.js:1004-1017 |
| Description | The retry skip rule is `isAuthenticationCampaign(campaign) ? campaign.status !== 'RUNNING' : campaign.status === 'CANCELLED'` (:145). For non-OTP campaigns a `PAUSED` campaign is *not* skipped, so retries keep sending (and consuming credit, :194) while the user believes the campaign is halted. `pauseCampaign` resets RETRYING rows only for authentication campaigns (:1005-1010) and removes only the main `queueJobId` job (:1014-1017), never the `retry:<id>:<n>` jobs. |
| Steps to reproduce / Evidence | Campaign with retries enabled and some RETRYING rows → pause → at `nextRetryAt` the log shows `[CampaignRetry] Retry succeeded for recipient …` while status is PAUSED. |
| Expected | Pause halts all sending (comment :990-992: "Halts a running campaign"). |
| Actual | Retries continue while paused. |
| Impact | Messages sent against the user's explicit instruction; credit consumed. |
| Suggested fix | Skip when `status !== 'RUNNING'` for all campaign types (leave the row RETRYING); on resume re-enqueue RETRYING rows. |
| Effort | S |
| Related IDs | CF-011 |
| Audit working IDs | F-E-004 |

### CF-059

**env.js defines required variables nobody reads and omits one the code does read**

| Field | Value |
|---|---|
| Module | Config |
| Area | Backend |
| Status | BROKEN |
| Severity | Medium |
| Confidence | Confirmed |
| Location | backend/src/config/env.js:40,42,82; backend/src/services/whatsapp.service.js:358 |
| Description | The previous auditor's env_defined.txt and env_used.txt were diffed and then re-checked with grep over `backend/src`. Findings: - `META_SYSTEM_USER_ID` (env.js:40) and `META_DISPLAY_NAME` (env.js:42) are **required** (`z.string().min(1)`) but referenced nowhere outside env.js. The app refuses to boot (`process.exit(1)`, env.js:165-169) when a variable it never uses is missing. - `CAMPAIGN_BATCH_SIZE` (env.js:82) is defined and documented in README but never read (CF-053). - `META_TWO_STEP_PIN` is read as `env.META_TWO_STEP_PIN` (whatsapp.service.js:358) but is not in the zod schema. `parsed.data` drops unknown keys, and the `env` Proxy only falls back to `baseEnv` (env.js:222-226), so the value is **always undefined** even when set. Numbers that already have two-step verification enabled can never be registered with the operator's PIN: the comment at :355-357 says a fresh random PIN is rejected, and the error is only `console.warn`ed. - `PRISMA_PG_ADAPTER` is read straight from `process.env` (lib/prisma.js:21). That is intentional and documented there, but it is absent from README. |
| Steps to reproduce / Evidence | Static code trace at the cited Location lines; the trace is written out in the Description. |
| Expected |  |
| Actual |  |
| Impact |  |
| Suggested fix | Make META_SYSTEM_USER_ID and META_DISPLAY_NAME optional or delete them. Add `META_TWO_STEP_PIN: z.string().regex(/^\d{6}$/).optional()`. Delete or wire up CAMPAIGN_BATCH_SIZE. |
| Effort | S |
| Related IDs |  |
| Audit working IDs | F-I-002 |

### CF-060

**Integrations: 6 of 9 "OAuth" cards save a `pending` row that is reported as CONNECTED; no integration ever syncs data**

| Field | Value |
|---|---|
| Module | Connect / Integrations |
| Area | Both |
| Status | FAKE/STUB |
| Severity | Medium |
| Confidence | Confirmed |
| Location | frontend/src/pages/IntegrationsView.jsx:241-246 (`OAUTH_PROVIDER_MAP` maps only google-sheets, hubspot, shopify-sales, shopify-marketing), :217-232 (facebook-lead, zoho-crm, salesforce, zoho-bigin, zoho-billing, zoho-books, calendly typed `oauth`), :361-364 (unmapped → `onSave(intg.id, { type:'oauth', config:{ oauth:true, pending:true } })`), backend/src/services/integrations.service.js:22-24 (`status: 'CONNECTED'` unconditionally), backend/src/lib/oauthProviders.js:21-56 (registry: google, shopify, hubspot, slack, mailchimp only); consumers of `workspaceIntegration`: only integrations.controller/service and integrationHealth.service (grep) |
| Description | (a) Facebook Lead Ads, Zoho x4, Salesforce and Calendly have no OAuth backend; clicking Connect stores `{pending:true}` with `status:'CONNECTED'` and the card renders as connected. (b) Slack/Mailchimp exist in the backend registry but not in the UI catalogue. (c) For all 27 catalogue entries (Razorpay, Stripe, WooCommerce, Freshdesk, Zapier webhooks, ...) the stored credentials/config are read by nothing except the health check - there is no sync, no webhook delivery to the Zapier/Make/Pabbly URL (`grep -rn workspaceIntegration backend/src` → 3 files), so "connected" only means "credentials stored". (d) `integrations` is a plan feature (server.js:91,106) enforced only in the UI (IntegrationsView.jsx:718 `paidUnlocked`); `integrations.routes.js:7-17` has no `requireFeature`, so a FREE-plan API caller can store credentials (harmless given (c)). |
| Steps to reproduce / Evidence | Connect "Salesforce" → `POST /integrations/salesforce {type:'oauth',config:{pending:true}}` → 200 `{status:'CONNECTED'}`. |
| Expected | Only providers with a working flow are connectable; status reflects reality; some consumer of the credentials. |
| Actual | Catalogue of 27 cards where at most 4 reach a real consent screen and none moves data. |
| Impact | Misleading; customers enter live payment-gateway secrets into a store nothing uses. |
| Suggested fix | Mark unmapped providers "Coming soon" in the UI; store `status:'PENDING'` for pending; add `requireFeature('integrations')` server-side; remove cards for unbuilt syncs. |
| Effort | M |
| Related IDs | CF-061; Lead 16 |
| Audit working IDs | F-CCON-002 |

### CF-061

**Lead-capture toggle (Settings → Team/Workspace `LeadCaptureSetting`) is a silent no-op: `autoLeadFromReply` is stripped by the settings validator**

| Field | Value |
|---|---|
| Module | Connect / Settings |
| Area | Backend |
| Status | BROKEN |
| Severity | Medium |
| Confidence | Confirmed |
| Location | frontend/src/components/LeadCaptureSetting.jsx:46-49 (`PATCH /settings {autoLeadFromReply}`), backend/src/validators/index.js:10-13 (`req.body = schemas.body.parse(...)` - Zod strips unknown keys), :369-390 (`settingsSchemas.update` has no `autoLeadFromReply`; `grep -rn autoLeadFromReply backend/src/validators` → none), backend/src/services/settings.service.js:60 (service would accept it), backend/src/services/campaignLeads.service.js:56-58 (runtime reads the column) |
| Description | The switch returns 200 (empty update), the UI shows it as saved, but the column never changes. Auto-creating leads from campaign replies can therefore never be enabled from the UI (default `false`, schema.prisma:186). |
| Steps to reproduce / Evidence | Toggle on, reload → `GET /settings` still `autoLeadFromReply:false`. |
| Expected | Field allowed in schema. |
| Actual | Dropped. |
| Impact | Campaign-reply lead capture feature is unreachable. |
| Suggested fix | Add `autoLeadFromReply: z.boolean().optional()` to `settingsSchemas.update`. |
| Effort | S |
| Related IDs |  |
| Audit working IDs | F-CCON-003 |

### CF-062

**`SavedView` is used as an untyped key-value store for 7 unrelated config families, with structural risks**

| Field | Value |
|---|---|
| Module | CRM (cross-cutting) |
| Area | Backend |
| Status | DATA |
| Severity | Medium |
| Confidence | Confirmed |
| Location | backend/prisma/schema.prisma `model SavedView` (`@@unique([workspaceId, entity, createdByUserId, name])`); backend/src/services/leadDistribution.service.js:4-5; crmCustomization.service.js:4, :177-179; customReports.service.js:3; aiAgents.service.js:116, :181, :283, :433-490; savedViews.service.js:20-24 |
| Description | Config keys stored as SavedView rows (entity / name): `lead_distribution_rules` / `__SYSTEM_LEAD_DISTRIBUTION_RULES__`; `crm_customization` / `__CRM_CUSTOMIZATION_<SECTION>__` for lead_lifecycle, prospecting_criteria, deal_mode, lead_tags, lead_sources, call_outcomes, visit_outcomes, deal_setup, ticket_customization, document_categories; `crm_custom_report` / user-named; `ai_agent` / agent name; `ai_guideline`; `ai_channel_bot` / channel key. Risks: (1) none of these payloads has a schema (CF-074, CF-064, CF-076); the only validated path (`savedViewSchemas`) caps filters to flat scalars, which real config rows violate. (2) System rows use `createdByUserId: null`; Postgres treats NULLs as distinct in unique indexes, so duplicates can accumulate and every reader uses `findFirst` -> nondeterministic config. (3) `GET /saved-views` with no `entity` (savedViews.service.js:26-37) returns every `isShared` row, including distribution rules, all customization sections and AI-agent configs, to any member. (4) `deleteSavedView` protects system rows only because `null !== userId`. |
| Steps to reproduce / Evidence | `GET /api/v1/workspaces/W/saved-views` (no entity) as AGENT -> includes `__CRM_CUSTOMIZATION_*__` and `ai_agent` rows. |
| Expected | Dedicated tables or entity allow-list on list, schema per key. |
| Actual | As described. |
| Impact | Config leakage to low-privilege roles, nondeterminism. |
| Suggested fix | Require and allow-list `entity` in `listSavedViews`; partial unique index for system rows; per-key Zod. |
| Effort | M |
| Related IDs | CF-074, CF-064, CF-018, CF-076 |
| Audit working IDs | F-CRM-017 |

### CF-063

**Custom fields: choice/URL/email/phone/user types cannot be created (Zod enum mismatch); `SELECT` passes Zod then 500s; service file is two modules concatenated**

| Field | Value |
|---|---|
| Module | CRM-Custom fields |
| Area | Both |
| Status | BROKEN |
| Severity | Medium |
| Confidence | Confirmed |
| Location | backend/src/validators/index.js:520 (`['TEXT','NUMBER','DATE','BOOLEAN','SELECT']`), :747-755; backend/src/services/customFields.service.js:212-219 (12 types, `CHOICE_TYPES = ['DROPDOWN','MULTISELECT']`), :416-424, :253-331; schema.prisma `enum CustomFieldType` (no SELECT); frontend/src/components/CustomFields.jsx:9-24; customFields.service.js:1-209 vs :210-474 (second `import { prisma }` with a BOM at :210; first half has no prisma import and relies on ESM hoisting); backend/src/routes/index.js:169,194 (mounted at `/custom-fields` and `/custom`) |
| Description | The UI type picker offers the 12 service types; the route's Zod enum accepts 5, so DROPDOWN, MULTISELECT, TEXTAREA, CURRENCY, URL, EMAIL, PHONE, USER return 400. `SELECT` passes Zod, is not in `CHOICE_TYPES` (options nulled at :423) and Prisma rejects `type: 'SELECT'` -> 500. Only TEXT/NUMBER/DATE/BOOLEAN work. The file also contains a second, unrelated module (contact-level `workspaceCustomField` with add-on gating at :46-57); the CRM `customFieldDefinition` half has no add-on gating at all. |
| Steps to reproduce / Evidence | ForecastView -> Custom fields -> type "Dropdown" -> Add -> 400. |
| Expected | Enum shared with the service. |
| Actual | Most field types unusable; SELECT 500s; gating inconsistent. |
| Impact |  |
| Suggested fix | `type: z.enum(CUSTOM_FIELD_TYPES)` from the service; split the file; decide gating. |
| Effort | S/M |
| Related IDs | CF-155 |
| Audit working IDs | F-CRM-013 |

### CF-064

**Customization sections persist arbitrary JSON; stage deletion bypasses the safe-delete check; custom stage keys unvalidated**

| Field | Value |
|---|---|
| Module | CRM-Customize |
| Area | Backend |
| Status | DATA |
| Severity | Medium |
| Confidence | Confirmed |
| Location | backend/src/services/crmCustomization.service.js:360-371 (only `typeof data === 'object'`), :423-467, :294-355 (advisory only), :449-458 (creates `pipelineStage` with unchecked `s.key`), :296-298 (custom lifecycle keys always "safe") |
| Description | No Zod schema for any of the 10 sections: `filters` receives whatever object the client sends (unbounded size, wrong types). `checkSafeDeletion` is a separate GET the UI may call, but `updateSection` deletes any pipeline stage missing from the submitted list regardless (`.catch(() => {})` swallows errors). New stage keys are not checked for shape/length. Custom lifecycle keys stored in `customFields.statusKey` are reported "safe" to delete without counting leads using them. |
| Steps to reproduce / Evidence | `PUT /crm-customization/deal_setup {"stages":[{"key":"CLOSED_WON"},{"key":"CLOSED_LOST"}]}` deletes QUALIFICATION..NEGOTIATION rows while deals still sit in them. |
| Expected | Per-section schema; deletion refused when in use. |
| Actual | Anything persists. |
| Impact | Data integrity, UI crashes on malformed config. |
| Suggested fix | Zod per section; call `checkSafeDeletion` inside `updateSection`. |
| Effort | M |
| Related IDs | CF-014, CF-062 |
| Audit working IDs | F-CRM-011 |

### CF-065

**Deal stage filter drops deals that have any custom-field values**

| Field | Value |
|---|---|
| Module | CRM-Deals |
| Area | Backend |
| Status | BROKEN |
| Severity | Medium |
| Confidence | Confirmed |
| Location | backend/src/services/deals.service.js:30-39 vs :173-177, :183; compare leads.service.js:162-172 |
| Description | For a built-in stage the filter is `OR: [{stage, customFields:{equals:null}}, {customFields.stageKey == stage}]`. `updateDealStage` deletes `stageKey` on a built-in move but keeps other `customFields`; `updateDeal` writes validated custom-field values there. A deal in PROPOSAL with `{region:'EU'}` matches neither branch, so `GET /deals?stage=PROPOSAL` omits it. Leads have the third clause (`statusKey: null`) that deals lack. |
| Steps to reproduce / Evidence | PATCH `/deals/:id {customFields:{<field>:'x'}}` then `GET /deals?stage=QUALIFICATION` -> absent; `GET /deals` -> present. |
| Expected | Third OR branch as in leads.service.js:164-168. |
| Actual | Deals vanish from stage-filtered lists. |
| Impact | Pipeline board/export undercount. |
| Suggested fix | Mirror the leads three-branch OR. |
| Effort | S |
| Related IDs | CF-068 |
| Audit working IDs | F-CRM-005 |

### CF-066

**Structured engagement fields (engagementType/status/duration/notes/outcome/sentiment) are stripped by Zod, so the Engagements Log modal silently loses data**

| Field | Value |
|---|---|
| Module | CRM-Engagements |
| Area | Both |
| Status | BROKEN |
| Severity | Medium |
| Confidence | Confirmed |
| Location | backend/src/validators/index.js:10-14 (`req.body = schema.parse(...)`), :837-845 (`crmActivitySchemas.create` non-strict with only type/content/leadId/dealId/contactId), backend/src/services/activities.service.js:206-223, :238-241; frontend/src/pages/EngagementsView.jsx:222-236; frontend/src/components/LogInteractionModal.jsx:78-90 |
| Description | Zod `z.object()` strips unknown keys and `validate()` replaces `req.body`. `createActivity` then reads `body.engagementType`, `body.status`, `body.duration`, `body.notes`, `body.outcome`, `body.sentiment` -- all `undefined` after validation. The `JSON.stringify(meta)` branch (214-223) and `body.outcome`/`body.sentiment` (239, 241) are unreachable via HTTP. |
| Steps to reproduce / Evidence | EngagementsView posts `{type:'MEETING', engagementType:'Video Call', status, duration, notes, content}`; DB row gets `type` and `content` only. List enrichment (activities.service.js:159-194) then falls back to `engagementStatus='Active'`, `leadSource='INSTAGRAM'`/`'Incoming'`, `teamName='Enterprise Growth Team'` -- fabricated placeholder values shown in the Engagements table. LogInteractionModal still works only because it also serialises `Outcome: ... \| Sentiment: ...` into `content` and the service regex-parses it (238-241). |
| Expected | Schema includes the structured fields. |
| Actual | Status/duration lost; table shows hard-coded defaults. |
| Impact | Misleading engagement reports; wasted input. |
| Suggested fix | Extend `crmActivitySchemas.create`; remove hard-coded fallbacks at activities.service.js:171,180. |
| Effort | S |
| Related IDs | CF-067 |
| Audit working IDs | F-CRM-003 |

### CF-067

**Activities list ignores record-visibility scope and mislabels tabs (Visits == Video Calls == MEETING)**

| Field | Value |
|---|---|
| Module | CRM-Engagements |
| Area | Backend |
| Status | PARTIAL |
| Severity | Medium |
| Confidence | Confirmed |
| Location | backend/src/services/activities.service.js:54-93 (no `scopeFilter`), :71-82, :154-156 |
| Description | (a) Unlike leads/deals/tasks, `listActivities` never applies `scopeFilter`, so an AGENT under `recordVisibility=OWN/TEAM` can read every colleague's notes via `GET /activities` (and `?leadId=<any>` for leads that `GET /leads/:id` would 404). (b) `VIDEO_CALLS` and `VISITS` tabs both map to `type=MEETING`, `MESSAGES` maps to `EMAIL\|NOTE`; counts at 154-156 copy MEETING into both keys, so Visits == Video Calls. |
| Steps to reproduce / Evidence | EngagementsView.jsx:145-148 sets `type=VIDEO_CALL`/`VISITS`; service 75-81 collapses both. |
| Expected | Scope enforced; distinct kinds. |
| Actual | In-tenant leak; duplicated tabs. |
| Impact | Privacy of notes; misleading UI. |
| Suggested fix | Add `scopeFilter(..., { ownerField: 'createdByUserId' })` or owner join; add a subtype column. |
| Effort | M |
| Related IDs | CF-066 |
| Audit working IDs | F-CRM-004 |

### CF-068

**Forecast weights custom pipeline stages as QUALIFICATION (10%); any string is accepted as a stage**

| Field | Value |
|---|---|
| Module | CRM-Forecast / Deals |
| Area | Backend |
| Status | PARTIAL |
| Severity | Medium |
| Confidence | Confirmed |
| Location | backend/src/services/deals.service.js:88-93, :161-162, :179-183; backend/src/services/forecast.service.js:50, :59, :87-91; backend/src/services/pipelineStages.service.js:52-55; backend/src/validators/index.js:804-807 |
| Description | Custom stages (Customize -> deal_setup) are stored as `customFields.stageKey` with DB enum forced to QUALIFICATION. Forecast reads `deal.stage` and `stageProbabilities` only knows the six `PipelineStage` rows, so every custom-stage deal is forecast at 10% in the pipeline bucket. `createDeal`/`updateDealStage` never verify the key exists, so any <=50-char string is a valid stage. |
| Steps to reproduce / Evidence | PATCH `/deals/:id/stage {stage:'FOO'}` -> 200; forecast weights it 10%. |
| Expected | Validate against deal_setup; resolve probability via effective stage. |
| Actual | Silent misweighting; typos accepted. |
| Impact | Forecast wrong for any workspace using custom stages. |
| Suggested fix | Resolve effective stage in forecast; reject unknown keys. |
| Effort | M |
| Related IDs | CF-065 |
| Audit working IDs | F-CRM-006 |

### CF-069

**CRM CSV import runs synchronously row-by-row with no row cap, unvalidated `ownerUserId`, no distribution/category/events; exports drop custom stages/statuses and are unscoped**

| Field | Value |
|---|---|
| Module | CRM-Import/Export |
| Area | Backend |
| Status | PARTIAL |
| Severity | Medium |
| Confidence | Confirmed |
| Location | backend/src/routes/crmData.routes.js:9, :15-18; backend/src/controllers/crmData.controller.js (runImport: `ownerUserId = req.body?.ownerUserId`); backend/src/services/crmImport.service.js:132-215; backend/src/services/crmExport.service.js:3-16, :39-117, :121-134; frontend/src/components/ImportExport.jsx:44, :65 |
| Description | Import: (a) a 10 MB CSV (~150-200k rows) is processed inside the HTTP request with 3-5 sequential queries per row plus `computeLeadScore` (:170-205); the request outlives proxy timeouts, the client sees an error while the loop keeps writing, and a retry re-imports (existing contacts are reused, so the retry mostly counts `alreadyLeads`, but new-contact creation is not idempotent across a partial failure). (b) `ownerUserId` comes from the multipart body with no Zod and no membership check, written to every imported lead (:198). (c) Imported leads skip `evaluateAndAssignLead`, `computeLeadCategory`, custom lifecycle keys (status is forced into the 6 built-ins, :6, :155-160) and `emitCrmEvent('lead_created')`, so workflows/distribution do not see them. (d) Imports are allowed status `CONVERTED` with no deal. (e) Contact limit bypass: CF-016. Dedupe within file (:149-152) and against existing contacts/leads (:171-185) works. Export: (f) formula-injection neutralisation (`sanitiseCell`, :7-16) is applied to every cell including the header -- correct; note it also prefixes `'` to phone numbers stored with a leading `+`, which then round-trip badly on re-import. (g) Deals export `d.stage` and leads export `l.status` (DB enum), so every custom stage is exported as QUALIFICATION and every custom status as its base enum, i.e. exported data disagrees with the board. (h) Export ignores `recordVisibility` (ADMIN-only route, so acceptable) and loads all rows into memory, no streaming; "every run is logged" is only a `console.log`, not an audit-log row. |
| Steps to reproduce / Evidence | Import CSV with 100k rows -> request time > 60 s; `POST /crm-data/import/leads` multipart `ownerUserId=<foreign user id>` -> all leads owned by the foreign id. Deal in custom stage `SITE_VISIT` -> export shows `QUALIFICATION`. |
| Expected | Background job with progress, row cap, validated owner, effective stage/status in export, audit-log entry. |
| Actual | As described. |
| Impact | Timeouts on real-sized files, ownership corruption, misleading exports. |
| Suggested fix | Enqueue import on BullMQ with a job id; cap rows (e.g. 20k); validate `ownerUserId` with `workspaceMember`; export `customFields.stageKey \|\| stage`; write to the audit log. |
| Effort | M |
| Related IDs | CF-016, CF-068, CF-074 |
| Audit working IDs | F-CRM-026 |

### CF-070

**Public lead form: concurrent submissions 500 on unique constraints, leads bypass distribution rules/prospecting checks, unbounded submission rows from honeypot/rejected floods, owner not membership-checked**

| Field | Value |
|---|---|
| Module | CRM-Lead forms (public) |
| Area | Backend |
| Status | RELIABILITY |
| Severity | Medium |
| Confidence | Confirmed |
| Location | backend/src/routes/publicForms.routes.js:13-26; backend/src/services/leadForms.service.js:100-121, :216-316; backend/prisma/schema.prisma:408 (`@@unique([workspaceId, phoneNumber])` on Contact), :2191 (`Lead.contactId @unique`); backend/src/services/leads.service.js:381-387 (distribution only in `createLead`) |
| Description | Verified the claimed controls: honeypot `_hp` (accepted by Zod `.strict()` and discarded at :224-232), consent enforcement when `consentText` is set (:238-240, `consentAt` stored), answers validated against the form definition (:167-196), attribution allow-list (:23, :198-206), IP stored hashed (:33), identical success response for duplicate/opted-out (:277-292), inactive/unknown both 404. Gaps: (a) `findFirst` then `contact.create` (:276-286) and `findUnique` then `lead.create` (:288-309) are check-then-act; two submissions of the same phone within milliseconds (double-submit, or a retrying embed) hit P2002 on Contact or Lead -> unhandled 500 and a half-written state (contact without lead / lead without submission record). (b) Leads created here never go through `evaluateAndAssignLead`, custom `lead_sources`, or prospecting criteria (`createLead` path) -- they get `form.ownerUserId` or no owner, so round-robin distribution silently excludes all web-form leads. (c) Honeypot hits and every REJECTED/DUPLICATE submission still write a `LeadFormSubmission` row (:225-230, :242-251); the only brake is the per-IP bucket (and the in-memory fallback of rateLimit.js:25-40 is per-process), so a distributed bot fills the table without limit. (d) `consent` is required but not propagated to the Contact (no opt-in flag/timestamp on the contact), so WhatsApp opt-in evidence lives only in submissions. (e) `ownerUserId` on create/update form (validators/index.js:705, :716) is not checked against workspace membership. (f) `getForm` returns the last 50 submissions with answers (PII) to any role, including VIEWER (leadForms.routes.js:12). |
| Steps to reproduce / Evidence | Two parallel `POST /api/v1/forms/W/slug {answers:{phone:'+919999999999'}}` -> one 200, one 500 `Unique constraint failed on the fields: (workspaceId,phoneNumber)`. |
| Expected | Upsert contact / catch P2002 and re-read; route form leads through `createLead` or at least `evaluateAndAssignLead`; cap submissions per form per hour; membership check on owner. |
| Actual | As described. |
| Impact | Lost leads on double-submit, distribution rules not applied to the main inbound channel, table bloat. |
| Suggested fix | `prisma.contact.upsert` on `(workspaceId, phoneNumber)`; wrap lead creation in try/catch P2002 -> DUPLICATE; call `evaluateAndAssignLead` after create; per-form hourly cap stored in Redis. |
| Effort | M |
| Related IDs | CF-073, CF-016 |
| Audit working IDs | F-CRM-025 |

### CF-071

**Lead convert-to-deal ignores record-visibility scope, is not idempotent under concurrency, does not validate owner, and loses custom stage/status**

| Field | Value |
|---|---|
| Module | CRM-Leads / Convert |
| Area | Backend |
| Status | PARTIAL |
| Severity | Medium |
| Confidence | Confirmed |
| Location | backend/src/services/leads.service.js:543-583; backend/src/routes/leads.routes.js:23; backend/src/validators/index.js:563-570; backend/prisma/schema.prisma:2206 (`convertedDealId String?`, not unique), :2230 (`Deal.leadId`, not unique) |
| Description | (a) `convertLead(workspaceId, id, body, userId)` takes no `user` and never calls `scopeFilter`, so an OWN/TEAM-scoped CLIENT can convert any lead by id (and read its data back via the returned deal) although `GET /leads/:id` would 404 for them. (b) The "already converted" check (:547) is a plain read inside a READ COMMITTED interactive transaction; two concurrent converts (double-click, or UI + workflow) both pass and create two deals; no unique constraint on `Deal.leadId`/`Lead.convertedDealId` stops it; the second write wins `convertedDealId`, orphaning the first deal. (c) `body.ownerUserId` is written to `Deal.ownerUserId` with no `workspaceMember` check (same pattern as CF-074/007). (d) `stage` is any 50-char string (CF-068) and the history row sets only `toStage` without `toStageKey` (:572-574), unlike `createDeal` (deals.service.js:113-121), so the stage-history timeline shows "Qualification" for a deal converted into a custom stage. (e) Lead gets DB `status='CONVERTED'` but an existing `customFields.statusKey` (custom lifecycle) is left in place; effective status (`customFields.statusKey \|\| status`, leads.service.js:465) keeps showing the old custom stage and the lead does not appear under "Converted". (f) No `emitCrmEvent` from convert, so workflows keyed on lead status change do not fire for conversions (updateLead emits at :475+). |
| Steps to reproduce / Evidence | Two parallel `POST /leads/L/convert {title:'X'}` -> two `Deal` rows with `leadId=L`. Lead with `customFields.statusKey='DEMO_BOOKED'` -> convert -> list still shows DEMO_BOOKED. |
| Expected | Scoped, conditional claim of the lead; owner membership check; statusKey cleared; event emitted. |
| Actual | As described. |
| Impact | Duplicate deals inflate pipeline/forecast; in-tenant access bypass; missed workflow triggers. |
| Suggested fix | Begin the tx with `tx.lead.updateMany({ where:{id, workspaceId, convertedDealId:null, ...scope}, data:{status:'CONVERTED'} })` and abort on count 0; `@unique` on `Lead.convertedDealId`; strip `statusKey`; emit event. |
| Effort | S |
| Related IDs | CF-068, CF-015, CF-074 |
| Audit working IDs | F-CRM-021 |

### CF-072

**`ownerUserId`/`teamId` references on leads, deals, tickets, conversations are not verified as workspace members/teams**

| Field | Value |
|---|---|
| Module | CRM-Leads / Deals / Tickets / Inbox |
| Area | Backend |
| Status | SECURITY |
| Severity | Medium |
| Confidence | Confirmed |
| Location | backend/src/services/leads.service.js:367,464,566,585-594, backend/src/services/deals.service.js:106,140, backend/src/services/tickets.service.js:144,161-170, backend/src/services/conversations.service.js:694-701, backend/src/services/crmReferences.js:37-54 (the correct pattern, used only by tasks/activities); backend/src/services/copilot.tools.js:224-240, backend/src/services/tickets.service.js:161-170 |
| Description | Tasks/activities resolve `assignedToUserId` through `crmReferences.js` (membership check). Leads (`createLead`, `updateLead` via `data = {...updates}`, `convert`, `bulkAssignLeads`), deals (`createDeal`, `updateDeal`), tickets (`createTicket` checks contact/team/conversation but not `ownerUserId`; `updateTicket` re-checks nothing — `teamId`, `contactId`, `conversationId`, `ownerUserId` all pass through `data = {...updates}`) and `assignConversation` write whatever user/team id the client sends. The FK only proves the row exists. |
| Steps to reproduce / Evidence | `PATCH /workspaces/W/tickets/T {teamId: "<team id from workspace X>"}` → tickets.service.js:170 `crmTicket.update({where:{id}, data})` succeeds; `TICKET_INCLUDE` then returns the foreign team's name. `PATCH /leads/L {ownerUserId: "<any user cuid>"}` → lead owner set to a non-member; `LEAD_INCLUDE` returns that user's `name`/`email` (leads.service.js owner select) and `awardXp`/notifications fire for a non-member. |
| Expected | Owner/assignee must be a member of the workspace; team must belong to the workspace, on create and update. |
| Actual | Any existing id is accepted. |
| Impact | Cross-tenant reference (foreign team name / foreign user name+email disclosure by id), gamification XP and notifications delivered to non-members, records assigned to users who cannot see them. Ids are cuids so blind guessing is hard; a user who was removed from the workspace, or who is in a second workspace, is the realistic vector. |
| Suggested fix | Extend `resolveCrmReferences` with `ownerUserId`/`teamId` and call it in leads/deals/tickets/conversations create+update+bulk-assign. |
| Effort | S |
| Related IDs | CF-079 |
| Audit working IDs | F-A2-006, F-A2-016, F-core-013 |

### CF-073

**Round-robin lead distribution counter is a non-atomic read-modify-write (Lead 17)**

| Field | Value |
|---|---|
| Module | CRM-Leads / Lead distribution |
| Area | Backend |
| Status | RELIABILITY |
| Severity | Medium |
| Confidence | Confirmed |
| Location | backend/src/services/leadDistribution.service.js:67, :154-171, :219-240; backend/src/services/leads.service.js:381-387; backend/src/services/aiAgents.service.js:331 |
| Description | `evaluateAndAssignLead` reads the rules row (`getDistributionRules`, line 67), computes `idx = roundRobinIndex % n` (154), then re-reads the SavedView row (159) and writes `{...config, roundRobinIndex: nextIndex}` (163-171) with no transaction, no row lock, and no optimistic version. It is invoked per lead creation (leads.service.js:382), from the AI agent (aiAgents.service.js:331) and from the batch endpoint (`autoDistributeBatch`). |
| Steps to reproduce / Evidence | Two leads created concurrently (two public-form submissions / import) both read `roundRobinIndex=0`, both assign candidate[0], both write `1`. The write at 163-171 also spreads the stale `config` (rules included) back into `filters`, so a concurrent `saveDistributionRules` (32-61) is overwritten with the old rule set. |
| Expected | Atomic increment or per-workspace lock. |
| Actual | Duplicate assignments to the same rep; lost rule edits under concurrency. |
| Impact | Uneven lead allocation; silently reverted distribution-rule edits. |
| Suggested fix | Dedicated integer column + `update({ data: { roundRobinIndex: { increment: 1 } } })` in a transaction; never write the whole `config` back. |
| Effort | S |
| Related IDs | CF-074; Lead 17 |
| Audit working IDs | F-CRM-001 |

### CF-074

**Lead distribution rules accept arbitrary JSON; ROUND_ROBIN pool user IDs never checked against workspace membership**

| Field | Value |
|---|---|
| Module | CRM-Leads / Lead distribution |
| Area | Backend |
| Status | SECURITY |
| Severity | Medium |
| Confidence | Confirmed |
| Location | backend/src/routes/leadDistribution.routes.js:12-13 (no `validate()`), backend/src/controllers/leadDistribution.controller.js:8-11, backend/src/services/leadDistribution.service.js:32-41, :139-155, :181-183 |
| Description | `POST /lead-distribution/rules` has no Zod schema; `rules` is stored verbatim. For `assignment.type === 'USER'` the userId is checked against `workspaceMember` (132-138) but for `ROUND_ROBIN` the `poolUserIds` array is used as-is (141-155) and written to `lead.ownerUserId` (181-183). `Lead.ownerUserId` is a plain FK to `User`, so a CLIENT-role user can assign every new lead to a user id from another workspace, making leads invisible to owner-scoped views. |
| Steps to reproduce / Evidence | `POST /lead-distribution/rules {"enabled":true,"rules":[{"enabled":true,"name":"x","conditions":{},"assignment":{"type":"ROUND_ROBIN","poolUserIds":["<foreign user id>"]}}]}` then create a lead -> `ownerUserId` = foreign user. Rule count/size unbounded. |
| Expected | Zod schema; every candidate id verified as `workspaceMember`. |
| Actual | Any JSON persisted; foreign user ids accepted. |
| Impact | Data integrity, ownership confusion. |
| Suggested fix | Add `leadDistributionSchemas.rules`; filter `candidateIds` through `workspaceMember.findMany`. |
| Effort | S |
| Related IDs | CF-073 |
| Audit working IDs | F-CRM-002 |

### CF-075

**Lead score and HOT/WARM/COLD category are computed once and never refreshed; time-decaying factors go stale, and segment campaigns target stale categories**

| Field | Value |
|---|---|
| Module | CRM-Leads / Scoring & segmentation |
| Area | Backend |
| Status | PARTIAL |
| Severity | Medium |
| Confidence | Confirmed |
| Location | backend/src/services/leadScoring.service.js:32-40 (recency 30/20/10 pts by days since last reply), :72-79 (freshness by contact age); backend/src/services/leadSegmentation.service.js:114-134 (category from score + `hasRecentReply`), :210-217 (`lead_category_changed` emitted only here), :225-242 (`recalculateAllLeadCategories`, no caller); callers of `computeLeadScore`/`computeLeadCategory`: leads.service.js:359, :378, :520, :529; leadForms.service.js:294, :312; crmImport.service.js:189; campaignLeads.service.js:71-96; crmSalesInbox.controller.js:32 -- none in the inbound-message/webhook path, no worker or cron |
| Description | Both scoring models are explicitly time-based (reply within 24h = 30 pts, contact created <= 3 days = 10 pts, category HOT on recent reply), but the stored `score`/`category` is only recomputed on lead creation, on the manual "Recalculate" buttons, or when a campaign reply converts into a lead. A lead that replied once in January still shows 30 "reply recency" points and HOT in September; a lead that replies today stays COLD until someone clicks recalculate. `recalculateAllLeadCategories` exists but nothing calls it. Consequences: Leads list default sort (`sort='score'`), Sales Inbox HOT/WARM/COLD counts (crmSalesInbox.service.js:17-28), segment campaign audiences (CF-080) and workflows keyed on `lead_category_changed`/`score_above` all operate on stale values. The "8 unit tests" in docs cover only the pure `scoreLead` function. Import scores with `computeLeadScore` but never computes a category (crmImport.service.js:189-203), so imported leads have `category=null` and are counted in neither HOT/WARM/COLD (only ALL), although the review UI renders null as COLD (crmSalesInbox.service.js:108). |
| Steps to reproduce / Evidence | Create lead, send an inbound message 40 days later -> `score`/`category` unchanged until POST `/leads/:id/recalculate-score`. |
| Expected | Recompute on inbound message / campaign read (debounced) and a nightly sweep for decay. |
| Actual | Manual only. |
| Impact | Prioritisation and targeting based on wrong data; misleading "explainable" breakdown. |
| Suggested fix | Enqueue a debounced `computeLeadCategory` from the inbound-message handler; BullMQ repeatable job calling `recalculateAllLeadCategories` per workspace nightly (batched); compute category on import. |
| Effort | M |
| Related IDs | CF-023, CF-080, CF-069 |
| Audit working IDs | F-CRM-032 |

### CF-076

**Custom reports: unvalidated filters (500 on bad enum), no visibility scope, any CLIENT can delete any user's saved report, config stored unvalidated**

| Field | Value |
|---|---|
| Module | CRM-Overview / Custom reports |
| Area | Backend |
| Status | PARTIAL |
| Severity | Medium |
| Confidence | Confirmed |
| Location | backend/src/routes/crm-analytics.routes.js:14-17 (no `validate()`), backend/src/services/customReports.service.js:61-83 (`filters.status`/`filters.stage` straight into Prisma enums), :284-299 (`config` any JSON), :301-308 (`userId` unused; no author check), :255-282 (no `scopeFilter`); frontend/src/pages/CrmDashboardView.jsx:102, :141-166 |
| Description | `POST /crm-analytics/reports/query {entity:'leads', filters:{status:'foo'}}` -> 500. Reports ignore `recordVisibility`, so an OWN-scoped AGENT can chart every colleague's pipeline by owner. `DELETE /reports/saved/:id` deletes another user's report. |
| Steps to reproduce / Evidence | as above. |
| Expected | Zod for query/save; author check on delete; scope applied. |
| Actual | Missing. |
| Impact | In-tenant info leak, 500s, loss of other users' reports. |
| Suggested fix | Add `reportSchemas`; reuse `assertAuthor` from savedViews.service.js:72-84. |
| Effort | S |
| Related IDs | CF-015, CF-062 |
| Audit working IDs | F-CRM-016 |

### CF-077

**Integration Health modal shows fabricated status values**

| Field | Value |
|---|---|
| Module | CRM-Overview / Integration health |
| Area | Backend |
| Status | FAKE/STUB |
| Severity | Medium |
| Confidence | Confirmed |
| Location | backend/src/services/integrationHealth.service.js:45-47, :50-62, :78-89, :101; frontend/src/components/CrmIntegrationHealthModal.jsx:16 |
| Description | `webhook: 'ACTIVE'` and `lastPing: now` derive only from "a WaNumber row exists"; "Facebook Lead Ads Webhook" is CONNECTED whenever any web `LeadForm` exists (`formsCount > 0`, :50) with no Facebook integration; "Meta Graph API" is hard-coded HEALTHY with `latencyMs: 42`, `rateLimitStatus: 'NORMAL (<10% threshold)'`, `apiVersion: 'v20.0'`; `uptime: '99.98%'` is a literal. `overallStatus` is computed from these constants. |
| Steps to reproduce / Evidence | Fresh workspace with one WA number and one lead form -> "ALL_SYSTEMS_OPERATIONAL", 99.98% uptime, 42 ms latency. |
| Expected | Real signals (last webhook receipt, last send error) or honest "not measured" labels. |
| Actual | Invented numbers. |
| Impact | Misleading operators during outages. |
| Suggested fix | Derive from stored webhook/send timestamps; drop invented metrics. |
| Effort | M |
| Related IDs | CF-069 |
| Audit working IDs | F-CRM-015 |

### CF-078

**CRM permission matrix is never enforced server-side and contradicts the real route guards**

| Field | Value |
|---|---|
| Module | CRM-Permissions |
| Area | Both |
| Status | FAKE/STUB |
| Severity | Medium |
| Confidence | Confirmed |
| Location | backend/src/services/crmPermissions.service.js:11-75, backend/src/routes/crmPermissions.routes.js:10, backend/src/routes/leads.routes.js:16-18, backend/src/routes/leadDistribution.routes.js:12, backend/src/routes/crmData.routes.js:15, backend/src/controllers/crmData.controller.js:5-6 |
| Description | `requireCrmPermission()` has zero callers (only the defining file; the sole consumer is `GET /crm-permissions/my`, which returns booleans for the UI). The matrix says LEAD_DELETE and DISTRIBUTION_RULES_MANAGE are ADMIN-only, yet `DELETE /leads/:id`, `POST /leads/bulk-delete`, `POST /lead-distribution/rules` are `authorize('CLIENT')`. It says CLIENT may LEAD_EXPORT, yet `GET /crm-data/export/:entity` is `authorize('ADMIN')`. PHONE_MASKING_OVERRIDE is "enforced" by the caller opting in with `?maskPhone=true` (crmData.controller.js:5). AGENT is listed for CUSTOM_REPORTS_MANAGE but the role floor 403s any AGENT POST to `/crm-analytics/reports/saved`. |
| Steps to reproduce / Evidence | `grep -rn requireCrmPermission backend/src` → definition only. CLIENT `POST /leads/bulk-delete` → 200 while `/crm-permissions/my` for that user returns `canDeleteLeads:false`. |
| Expected | The matrix shown in the UI is the one the server enforces. |
| Actual | UI-only gating; server rules differ in both directions. |
| Impact | Misleading security model; CLIENT can delete leads / edit distribution rules despite UI; documented CLIENT export is blocked. |
| Suggested fix | Wire `requireCrmPermission` onto the routes and align `authorize` levels, or delete the module and derive `/my` from the real guards. |
| Effort | M |
| Related IDs | Lead 8 |
| Audit working IDs | F-A2-004, F-CRM-030 |

### CF-079

**Record-visibility scope applied to leads/deals/tasks/tickets only; sibling read surfaces bypass it**

| Field | Value |
|---|---|
| Module | CRM-Permissions |
| Area | Backend |
| Status | PARTIAL |
| Severity | Medium |
| Confidence | Likely |
| Location | backend/src/services/recordScope.service.js:61-84, backend/src/services/leads.service.js:403-408,487-490, backend/src/services/deals.service.js:130-131, backend/src/services/tickets.service.js:154-159, backend/src/services/tasks.service.js:14; backend/src/services/tasks.service.js:13-33 (list scoped via `assignedToUserId`), :35-42, :70-100, :102-106 (no scope, no `user` param); backend/src/controllers/tasks.controller.js:10, :20, :25; backend/src/routes/crm-analytics.routes.js:12; backend/src/controllers/crm-analytics.controller.js:4-8; backend/src/services/crm-analytics.service.js:30-130 (`baseWhere` / `startDate`), :112-121 (lead query has no `userId` filter), :194, :258-264; frontend/src/pages/CrmDashboardView.jsx:59-88 |
| Description | `scopeFilter` is spread into list/get/update/delete for leads, deals, tasks, tickets (verified). Activities, search, crm-sales-inbox, exports, quotes, copilot/agent tools query by `workspaceId` only, so in OWN/TEAM mode a member still reads colleagues' leads through those surfaces. |
| Steps to reproduce / Evidence | `grep -n scopeFilter backend/src/services/*.js` → only leads/deals/tasks/tickets/recordScope. |
| Expected | §45 "enforced on the server" for every read surface. |
| Actual | Bypassable via sibling endpoints. |
| Impact | In-tenant visibility leak when TEAM/OWN mode is enabled (default ALL). |
| Suggested fix | Apply `scopeFilter` (or scoped id lists) in search, activities, exports, sales inbox, tools. |
| Effort | M |
| Related IDs | CF-078 |
| Audit working IDs | F-A2-005, F-CRM-022, F-CRM-029 |

### CF-080

**Sales Inbox segment campaign launch: no Zod, no record-visibility scope, unbounded audience query, custom status 500s, orphan DRAFT campaigns on failure, analytics mislabel "skipped" as opted-out**

| Field | Value |
|---|---|
| Module | CRM-Sales inbox / Segment campaigns |
| Area | Both |
| Status | PARTIAL |
| Severity | Medium |
| Confidence | Confirmed |
| Location | backend/src/routes/crmSalesInbox.routes.js:12-16 (no `validate()`; only launch has `authorize('CLIENT')`); backend/src/controllers/crmSalesInbox.controller.js:14-27, :39-50; backend/src/services/crmSalesInbox.service.js:44-74, :133-167, :172-236; frontend/src/pages/CrmSalesInboxView.jsx:344-362, :568-603 |
| Description | (a) `reviewSegmentAudience` runs `prisma.lead.findMany` with no `take`, including the latest form submission answers, and returns every lead of the workspace to the browser on every Segment-tab open (PERF; a 50k-lead workspace ships 50k rows + answers). (b) No `scopeFilter`: an AGENT/VIEWER under `recordVisibility=OWN\|TEAM` can pull name/phone/email/form answers for all leads via `GET /crm-sales-inbox/audience-review` (in-tenant leak, same family as CF-015). (c) `status` from query/body goes straight into the `LeadStatus` Prisma enum (:48) -> a custom lifecycle key (Customize -> lead_lifecycle) yields a 500 both on review and on launch. (d) `launchSegmentCampaign` is three non-transactional steps: `createCampaign` (:145) then `setRecipients` (:154) then `launchCampaign` (:157). If launch throws (insufficient wallet, template not APPROVED, number disconnected, plan limit) the DRAFT campaign with the full recipient list is left behind; each retry creates another draft. (e) `templateId`/`waNumberId` unvalidated at the route (checked only downstream in campaigns.service). (f) Positive: opt-out and MSISDN length are pre-filtered, `Lead.contactId` is unique (no duplicate recipients), `setRecipients` (campaigns.service.js:359-399) re-checks workspace ownership and dedupes, and the normal campaign engine (billing/limits) is reused, so no unmetered-send path was found here. (g) `getSegmentCampaignAnalytics` claims "CRM broadcast campaigns" but returns the last 15 campaigns of any kind (:173-178) and reports `skipped` as `optedOut` (:200), which also counts invalid-number/other skips. (h) `POST /crm-sales-inbox/leads/:leadId/recalculate-category` writes lead category/score with no role check (any VIEWER). |
| Steps to reproduce / Evidence | Workspace with custom lifecycle key `DEMO_BOOKED`: Sales Inbox -> Segment -> status DEMO_BOOKED -> audience review 500. Launch with an unapproved template -> error from launch step; a new DRAFT "CRM Segment (...)" appears in Campaigns on each attempt. |
| Expected | Zod schema for query/body, scope applied, paginated/summary-only review, launch cleaned up on failure, campaign tagging for CRM analytics. |
| Actual | As described. |
| Impact | In-tenant PII exposure, performance, orphan drafts, misleading analytics. |
| Suggested fix | Add `crmSalesInboxSchemas`; count-only review with a `take: 200` preview; AND the scope; delete the draft in `catch`; tag campaigns `source='CRM_SEGMENT'`; `authorize('CLIENT')` on recalculate. |
| Effort | M |
| Related IDs | CF-015, CF-023, CF-158 |
| Audit working IDs | F-CRM-020 |

### CF-081

**Ticket SLA: category `slaHours` from Customize is ignored, `firstRespondedAt` is never stamped, no breach detection job**

| Field | Value |
|---|---|
| Module | CRM-Tickets |
| Area | Backend |
| Status | PARTIAL |
| Severity | Medium |
| Confidence | Confirmed |
| Location | backend/src/services/tickets.service.js:11, :33-36, :114-147 (dueAt from priority only), :210-218 (`markFirstResponse` has no production caller: only tickets.service.test.js:162-166); crmCustomization.service.js:130-136 (`categories[].slaHours`); frontend/src/pages/TicketsView.jsx:45-47, :158, :163-170 (category only sets priority) |
| Description | The Customize tab advertises "category SLAs" and stores `slaHours`, but `createTicket` computes `dueAt` solely from `SLA_HOURS[priority]`. Custom ticket stages beyond the aliased ones (IN_PROGRESS->OPEN, WAITING_ON_CUSTOMER->WAITING) fall back to NEW (:119-130). Nothing calls `markFirstResponse`. No worker checks breaches; only NBA lists "about to breach" on dashboard open. |
| Steps to reproduce / Evidence | category "Account Access" slaHours=4 with priority LOW -> dueAt = +72h. |
| Expected | category SLA respected; first response stamped on outbound reply. |
| Actual | Ignored. |
| Impact | Misleading SLA promises. |
| Suggested fix | Resolve `slaHours` by category first; call `markFirstResponse` from the outbound-message path. |
| Effort | S/M |
| Related IDs | CF-068 |
| Audit working IDs | F-CRM-018 |

### CF-082

**Notable swallowed promises (`.catch(() => {})`) that hide money/data loss**

| Field | Value |
|---|---|
| Module | Cross-cutting |
| Area | Backend |
| Status | TECH-DEBT |
| Severity | Medium |
| Confidence | Confirmed |
| Location | backend/src/services/wallet.service.js:259-269; backend/src/workers/campaign.worker.js:338, :606, :611, :314, :326; backend/src/services/conversations.service.js:252, :350, :463; backend/src/services/campaignBilling.service.js:84-94; backend/src/services/optout.service.js:133-142, :239-241; backend/src/services/retry.service.js:147, :166; backend/src/workers/agent.worker.js:41; backend/src/services/auth.service.js:43, :96 |
| Description | 102 `.catch(() => {})`/`.catch(() => null)`/`.catch(() => [])` sites in services/workers/controllers. Most are cosmetic (notifications, `job.remove()`), but these hide real loss: (1) **wallet recharge invoice** creation after a successful Razorpay capture is swallowed (wallet.service.js:269) → paid recharge with no invoice record; (2) **`releaseMessageCredit`** failures swallowed at 5 sites → quota/wallet silently not refunded for failed sends; (3) `recordAttempt` swallows its write (campaignBilling.service.js:94) → retry history gaps; (4) `Contact.optedOut` sync after `recordOptOut`/`unblockNumbers` swallowed (optout.service.js:135, :142, :241) → the two opt-out sources diverge (CF-205) with no log; (5) `recoverPendingRetries` swallows each re-enqueue failure (retry.service.js:166) → retries stay lost with the boot log claiming success count; (6) retry-path `conversation.create`/`message.create` swallowed (campaign.worker.js:314, :326) → no Message row, so delivery/read webhooks for that retry are dropped. |
| Steps to reproduce / Evidence | grep `\.catch\(\(\) => (\{\}\|null\|\[\])\)` under services/workers/controllers → 102 hits; sites above read individually. |
| Expected | At minimum log with context; for money paths, retry or alert. |
| Actual | Silent. |
| Impact | Undetectable billing record gaps and opt-out divergence. |
| Suggested fix | Replace with `.catch(logAndReport('context'))`; for the invoice and credit release, retry or write to a reconciliation table. |
| Effort | S |
| Related IDs | CF-205, CF-093 |
| Audit working IDs | F-E-016 |

### CF-083

**Required FKs without onDelete (RESTRICT) block user, template and workspace deletion**

| Field | Value |
|---|---|
| Module | Data model / Cascades |
| Area | Backend |
| Status | RELIABILITY |
| Severity | Medium |
| Confidence | Likely |
| Location | backend/prisma/schema.prisma (`Campaign.template`, `Invitation.invitedBy`, `Subscription.plan`/`pendingPlan`) |
| Description | schemadiff.mjs lists 5 FK relations with no onDelete: - Invitation.invitedBy -> User - Campaign.template -> Template - Message.senderUser -> User? (optional, so SetNull; fine) - Subscription.plan -> Plan - Subscription.pendingPlan -> Plan? For required relations Prisma defaults to `Restrict`. As a result: - Deleting a user who ever sent an invite fails with P2003. - A template used by any campaign cannot be deleted. - A Workspace delete cascades to both Template and Campaign. RESTRICT is checked immediately (unlike NO ACTION), so the workspace delete can fail depending on cascade order. All other relations under Workspace, Contact, Lead, Deal and Campaign use `onDelete: Cascade`, e.g. Conversation->Contact, CampaignRecipient->Campaign/Contact, WorkflowRun->Lead/Deal/Ticket. So deleting a Lead also erases its WorkflowRun history. That is a retention choice (Info). |
| Steps to reproduce / Evidence | Static code trace at the cited Location lines; the trace is written out in the Description. |
| Expected |  |
| Actual |  |
| Impact |  |
| Suggested fix | Make `Invitation.invitedBy` and `Campaign.template` optional with `onDelete: SetNull`. Map P2003 to 409 in errorHandler. |
| Effort | S |
| Related IDs |  |
| Audit working IDs | F-F-007 |

### CF-084

**Missing indexes on hot tenant-scoped queries**

| Field | Value |
|---|---|
| Module | Data model / Indexes |
| Area | Backend |
| Status | PERF |
| Severity | Medium |
| Confidence | Confirmed |
| Location | backend/prisma/schema.prisma:419 (Campaign), :878 (Invoice), :544 (Conversation), :890 (RefreshToken), :216 (WorkspaceMember), :484 (CampaignRecipient) |
| Description | Taken from the schemadiff.mjs index inventory: - **Campaign** has no `@@index` at all. Campaign lists and analytics filter on `workspaceId` (plus `status`), and `recoverScheduledCampaigns` filters on `status`. - **Invoice** has no `workspaceId` index. `reference` is described as the "gateway payment id, for reconciliation" (schema.prisma:886) but is not unique, so the DB cannot reject a double-recorded payment. - **Conversation** has only `@@index([workspaceId, contactId, waNumberId])`. The inbox list (services/conversations.service.js:38-43) filters by workspaceId and sorts by `lastMessageAt desc` with skip/take, so it needs `(workspaceId, lastMessageAt)`. Status filters need `(workspaceId, status)`. - **RefreshToken** is indexed only on `token` (unique). There is no `userId` or `expiresAt` index for revoke-all or cleanup. - **WorkspaceMember** has PK `(userId, workspaceId)`, so listing members by `workspaceId` cannot use it. - **CampaignRecipient** has `@@unique([campaignId, contactId])`, which gives a campaignId prefix, but no `(campaignId, status)` for per-campaign status counts. - Refuted/OK: - `Message(conversationId, createdAt)` is not needed: `@@index([conversationId, sentAt])` exists, and every message query orders by `sentAt` (conversations.service.js:51,147,529,637). - `Message.metaMessageId` and `AuthenticationTransaction.metaMessageId` are `@unique`. - `ApiKey.keyHash` is `@unique`. - `EmailOtp(email,purpose)` and `WhatsAppAuthOtp(phone,purpose)` are indexed. - `WalletTransaction.idempotencyKey` is `@unique`. |
| Steps to reproduce / Evidence | Static code trace at the cited Location lines; the trace is written out in the Description. |
| Expected |  |
| Actual |  |
| Impact |  |
| Suggested fix | Add these indexes: - Campaign: `@@index([workspaceId, createdAt])` and `@@index([status, scheduledAt])`. - Invoice: `@@index([workspaceId, invoiceDate])` and `@unique` on `reference`. - Conversation: `@@index([workspaceId, lastMessageAt])` and `@@index([workspaceId, status])`. - RefreshToken: `@@index([userId])`. - WorkspaceMember: `@@index([workspaceId])`. - CampaignRecipient: `@@index([campaignId, status])`. |
| Effort | S (reproducible delivery is blocked on CF-019) |
| Related IDs |  |
| Audit working IDs | F-F-005 |

### CF-085

**Backend ships `multer@1.4.5-lts.2`, a deprecated line with published DoS advisories fixed only in multer 2.x**

| Field | Value |
|---|---|
| Module | Dependencies / Uploads |
| Area | Backend |
| Status | SECURITY |
| Severity | Medium |
| Confidence | Likely (the version is Confirmed from the lockfile; advisory applicability comes from public advisories because the audit DB is unreachable offline) |
| Location | backend/package.json:41 (`"multer": "^1.4.5-lts.1"`), backend/package-lock.json (resolved `multer@1.4.5-lts.2`) |
| Description | Multer 1.x is end-of-life. The 2025 advisories (unhandled exception / stream-leak DoS from malformed multipart requests: CVE-2025-47935, CVE-2025-47944, CVE-2025-48997, CVE-2025-7338) are fixed only in 2.0.x. Every authenticated upload route (media, documents, imports, knowledge base) parses multipart through it, so any logged-in user of any workspace can send malformed bodies. `npm audit --omit=dev --json --offline` returned an empty report (`total: 0`). That output only means no advisory cache exists locally; it is not evidence of a clean tree. |
| Steps to reproduce / Evidence | Lockfile scan: `multer@1.4.5-lts.2`, `pdf-parse@2.4.5`, `axios@1.18.1`, `jsonwebtoken@9.0.3`, `express@5.2.1`, `body-parser@2.2.2`, `path-to-regexp@8.4.2`, `nodemailer@9.0.1`, `bcryptjs@2.4.3`, `passport@0.7.0`, `passport-google-oauth20@2.0.0`, `ws@8.21.0`, `form-data@4.0.6`, `qs@6.15.2`, `cookie@0.7.2`, `@prisma/client@5.22.0`, `razorpay@2.9.8`, `twilio@6.0.2`. Only multer is on a known-vulnerable line. pdf-parse is the 2.x rewrite, not the 1.1.1 version that opened a test PDF when `module.parent` was unset. axios 1.18 is past the 1.12 `data:` URI DoS fix. jsonwebtoken 9.x is past the 8.x algorithm-confusion advisories. `xlsx` (SheetJS, npm-registry versions unpatched) is not a dependency. |
| Expected | `multer@^2.0.2`. |
| Actual | 1.4.5-lts.2. |
| Impact | Authenticated process-level DoS of the single service that also runs all six workers. |
| Suggested fix | Upgrade to multer 2.x (the API is compatible for `diskStorage`/`memoryStorage` + `limits`), then run `npm audit --omit=dev` online in CI. |
| Effort | S |
| Related IDs | CF-140 |
| Audit working IDs | F-A1-012 |

### CF-086

**No error boundary anywhere while 8 views load lazily — any render error or stale chunk after a deploy blanks the app**

| Field | Value |
|---|---|
| Module | Frontend-Shell |
| Area | Frontend |
| Status | RELIABILITY |
| Severity | Medium |
| Confidence | Confirmed |
| Location | frontend/src/main.jsx:6-10, frontend/src/pages/Dashboard.jsx:17,29-35,3186-3194 |
| Description | `grep componentDidCatch\|getDerivedStateFromError\|ErrorBoundary` finds nothing. `Suspense` handles loading, not failed chunk imports. After a redeploy the hashed chunk names change; a tab opened before the deploy that navigates to Forecast, Products, Quotes, Sequences, Lead Forms, Tickets, Customize Business or CRM Overview gets a failed dynamic import, and React unmounts the whole root. The same happens for any render-time throw (e.g. CF-186). |
| Steps to reproduce / Evidence | Code trace above. |
| Expected | Root boundary with reload button; per-view boundary that reloads once on chunk-load errors. |
| Actual | White screen. |
| Impact | Users on long-lived tabs hit a blank app after every deploy. |
| Suggested fix | `ErrorBoundary` in main.jsx and around `renderView()`; on `ChunkLoadError`, reload once. |
| Effort | S |
| Related IDs | CF-186, CF-183 |
| Audit working IDs | F-H-021 |

### CF-087

**Shared `Modal` has no Escape handling, no focus trap, no `role="dialog"`/`aria-modal`, no focus restore — used at 49 sites in 19 files; `useFocusTrap` is used by only 2 bespoke dialogs**

| Field | Value |
|---|---|
| Module | Frontend-Shell / Accessibility |
| Area | Frontend |
| Status | UX |
| Severity | Medium |
| Confidence | Confirmed |
| Location | frontend/src/components/Modal.jsx:5-18; frontend/src/lib/useFocusTrap.js (used only at components/TemplateModal.jsx:158, pages/Dashboard.jsx:1103); consumers: BulkTaskModal, CrmIntegrationHealthModal, ImportExport, LeadDistributionModal, LogInteractionModal, AiAgentsView(4), ContactsView(5), CrmSalesInboxView(6), CustomizeBusinessView(9), DealsView(2), EngagementsView(2), LeadFormsView(2), LeadsView(3), NumberSetupView(3), ProductsView, QuotesView(2), SequencesView(3), TasksView, TicketsView(2) |
| Description | `Modal` renders an overlay and a card; the only a11y affordance is `aria-label="Close"` on the X. No Escape keydown, no focus trap, no `role="dialog"`, no `aria-labelledby`, focus is neither moved in on open nor restored on close, backdrop click does nothing. Tab escapes to the page behind. `role="dialog"` exists only in 8 bespoke dialogs (CommandPalette:131, SiteAssistant:240, TemplateModal:617, TemplatePreviewModal:78, AuthenticationDashboard:617,665, AutomationView:473, Dashboard:1106,2455). |
| Steps to reproduce / Evidence | Modal.jsx is 18 lines with no ref/keydown. |
| Expected | Escape closes, focus trapped/restored, `role="dialog" aria-modal="true" aria-labelledby`. |
| Actual | none for ~49 dialogs. |
| Impact | Keyboard/screen-reader users cannot reliably dismiss or navigate most CRM dialogs (WCAG 2.1.2, 4.1.2). |
| Suggested fix | Add ref + `useFocusTrap`, document Escape listener, dialog roles in Modal.jsx — one change covers all sites. |
| Effort | S |
| Related IDs | CF-187, CF-134 |
| Audit working IDs | F-H-011 |

### CF-088

**Three authenticated call sites bypass `authedFetch` — no token refresh/retry, so they 401 once the access token expires even though the session is still valid**

| Field | Value |
|---|---|
| Module | Frontend-Shell / API layer |
| Area | Frontend |
| Status | RELIABILITY |
| Severity | Medium |
| Confidence | Confirmed |
| Location | frontend/src/pages/ContactsView.jsx:141-147 (POST /contacts/import — manual Bearer, no refresh); frontend/src/pages/NumberSetupView.jsx:536-538 (GET /auth/meta/start — manual Bearer); frontend/src/pages/Dashboard.jsx:782-789 (POST /onboarding/chat — Bearer when present); frontend/src/components/AIOnboardingCard.jsx:56-62 (same, component unused); frontend/src/components/SiteAssistant.jsx:149-153 (POST /assistant/chat — unauthenticated by design). Expected-unauthenticated raw fetches: api.js:48, AuthCallback.jsx:25, ForgotPassword.jsx:42,55,71, InviteAccept.jsx:32, Landing.jsx:393, Login.jsx:41, PublicForm.jsx:70,87, Register.jsx:41,85,99,122. |
| Description | `authedFetch` handles 401 -> single-flight refresh (api.js:36-77; the `_refreshing` promise guard is correct and cleared in `finally`) -> retry. The authenticated raw sites read `localStorage.accessToken` directly; after the access token expires (before the refresh token does) the CSV import, Meta connect start and the home-page AI onboarding prompt return 401 and surface as "Error 401" with no refresh and no redirect. `authedFetch` already supports FormData (api.js:103-105), so the import bypass is unnecessary. `wDownload` (api.js:150) correctly goes through `wFetch`. |
| Steps to reproduce / Evidence | ContactsView.jsx:142-146. |
| Expected | `wFetch('/contacts/import', { method:'POST', body: fd })`. |
| Actual | raw fetch; 401 after token expiry. |
| Impact | Intermittent "import failed" / "could not start Meta connection" after a period of inactivity. |
| Suggested fix | Replace with `wFetch`/`apiFetch`. |
| Effort | S |
| Related IDs | CF-182 |
| Audit working IDs | F-H-008, F-core-025 |

### CF-089

**Sidebar nav is identical for ADMIN/CLIENT/AGENT/VIEWER — no role gating; VIEWER/AGENT see ~20 sections whose primary actions the backend rejects with 403**

| Field | Value |
|---|---|
| Module | Frontend-Shell / Role gating |
| Area | Frontend |
| Status | UX |
| Severity | Medium |
| Confidence | Confirmed |
| Location | frontend/src/pages/Dashboard.jsx:2517-2556 (ADMIN_NAV), :2668-2670 (`navForUser` returns ADMIN_NAV for every non-super-admin), :2656 (groups only branch on superAdmin); backend/src/middleware/roleCapabilities.js:17-31,65-80; frontend/src/lib/permissions.js (used for gating by only 5 views: ApiKeysView:76, Dashboard TemplatesView:1776, NumberSetupView:251, PaymentsView:78, SettingsView:102-104) |
| Description | `navForUser(user)` (Dashboard.jsx:2668) only distinguishes super admin vs everyone else; `user.role` is never consulted for the sidebar. Backend `checkRoleCapability` denies every non-GET for VIEWER and every non-GET outside `/conversations`, `/contacts`, `/opt-outs`, `/blocked-numbers`, `/ai-agent/test` for AGENT. Only 5 of ~35 views call `canManage()/canBill()/canManageMembers()`; `isReadOnly()` and `canHandleConversations()` have zero call sites. Concrete controls a VIEWER sees and clicks that 403: Campaigns "New campaign" wizard (CreateCampaign -> POST /campaigns), Contacts "Add contact"/Import (ContactsView:143 POST /contacts/import), Automation builder Save, Widgets save, Integrations connect, Leads/Deals/Tasks/Quotes/Products/Sequences create/edit/delete (CRM views import no permissions), Inbox composer send (POST /conversations/:id/messages), AI Agent create/delete (AiAgentsView:244-288). For AGENT additionally: every CRM write (/leads, /deals, /tasks are not in AGENT_WRITABLE_PREFIXES), Templates create/sync, Campaign launch, Automation save, Intent matching, Widget save. |
| Steps to reproduce / Evidence | grep for canManage(/isReadOnly(/canHandleConversations( in src -> 7 hits in 5 files, none for isReadOnly/canHandleConversations. CRM views do not import permissions.js. roleCapabilities.js:67 `if (role === 'VIEWER') return deny(...)` for any non-safe method. |
| Expected | Sidebar and primary CTAs hidden/disabled per role, or a read-only banner via `isReadOnly()` (which permissions.js:73-77 was written for). |
| Actual | VIEWER/AGENT get the full ADMIN sidebar and every create/edit/delete button; each click fails with a 403 toast/alert or, in views that swallow errors, silently. |
| Impact | Confusing UX for restricted roles; error paths that swallow 403 make the app look broken. |
| Suggested fix | Add `minRole` per ADMIN_NAV item and filter in `navForUser`; call `isReadOnly()` in the shell to show a banner; hide write CTAs behind `canManage()/canHandleConversations()`. |
| Effort | M |
| Related IDs | CF-178; Lead 19 |
| Audit working IDs | F-H-004 |

### CF-090

**Onboarding chat creates templates/campaigns with raw prisma, bypassing service validation and plan limits**

| Field | Value |
|---|---|
| Module | Home / Onboarding AI chat |
| Area | Backend |
| Status | PARTIAL |
| Severity | Medium |
| Confidence | Confirmed |
| Location | backend/src/controllers/onboarding.controller.js:262-273, :291-293, :341-350, :383-385 |
| Description | Template rows are inserted with `prisma.template.create` (status PENDING, no Zod `templateSchemas.create` name/body checks, no uniqueness per number, `waNumberId` may be `undefined`) and campaigns with `prisma.campaign.create` (no `assertWithinLimit(workspaceId,'campaign')`, unlike campaigns.service.createCampaign:281). Nothing is submitted to Meta; the "PENDING" status therefore does not mean "in review". |
| Steps to reproduce / Evidence | compare with backend/src/services/campaigns.service.js:278-283 (plan cap) and templates.routes.js:20 (Zod validate). |
| Expected | Route through templates.service.createTemplate / campaigns.service.createCampaign. |
| Actual | Plan campaign cap bypassed; templates that would fail validation are stored as PENDING. |
| Impact | Plan limits bypass (billing), confusing template state. |
| Suggested fix | Call the services; label the status DRAFT rather than PENDING until submitted. |
| Effort | S |
| Related IDs | CF-021 |
| Audit working IDs | F-core-002 |

### CF-091

**Inbox is capped at the 20 most-recent conversations with no pagination; filters are client-side over that page**

| Field | Value |
|---|---|
| Module | Inbox |
| Area | Both |
| Status | BROKEN |
| Severity | Medium |
| Confidence | Confirmed |
| Location | frontend/src/pages/InboxView.jsx:258-273 (`wFetch('/conversations')`, no page/limit), :480-492 (client-side filter); backend/src/controllers/conversations.controller.js:4-11 (`limit: +limit \|\| 20`) |
| Description | The list request never passes `page`/`limit`, the server defaults to 20, and there is no "load more". The All/Unassigned/AI-handled/Mine filters and the search box only filter the 20 rows already loaded (the server `search` param is never sent). A workspace with >20 active threads silently loses older ones from the inbox; the only way to reach them is via a contact's "Open conversation". |
| Steps to reproduce / Evidence | create 25 conversations; inbox shows 20; searching for the 21st contact returns nothing. |
| Expected | Server-side search/filter with pagination or infinite scroll. |
| Actual | Truncated list, misleading empty search. |
| Impact | Agents miss customer messages (core flow). |
| Suggested fix | Pass `search` and `page`, add a load-more, or raise limit and add status/assignee filters server-side. |
| Effort | M |
| Related IDs |  |
| Audit working IDs | F-core-010 |

### CF-092

**Inbound never reopens a CLOSED/RESOLVED conversation; OOO fires on closed threads regardless of hours**

| Field | Value |
|---|---|
| Module | Inbox |
| Area | Backend |
| Status | PARTIAL |
| Severity | Medium |
| Confidence | Confirmed |
| Location | backend/src/services/webhook.service.js:337, :398-408, :745; backend/src/workers/workflow.worker.js:280 |
| Description | The inbound update (:398-408) increments `unreadCount` and timestamps but never sets `status: 'OPEN'`; only `escalateToHuman` (`intentRouting.service.js:127`) and `actionAgent` (`workflowEngine.service.js:358`) do. `wasClosed` (:337) is then used at :745 to send the OOO message even inside business hours, and `processDelayedResponse` skips CLOSED conversations (:280), so the delayed-response automation never fires for a customer who writes to a closed thread. |
| Steps to reproduce / Evidence | `PATCH /:id/status {"status":"CLOSED"}`; send an inbound at 11:00 on a working day with `autoOooEnabled` → OOO text sent; row still CLOSED. |
| Expected | Inbound reopens the thread; OOO depends only on business hours. |
| Actual | As described. |
| Impact | Inbox filters hide active threads; wrong auto-reply; delayed-response silently skipped. |
| Suggested fix | Add `...(conversation.status !== 'OPEN' ? { status: 'OPEN' } : {})` at :400; drop `wasClosed` from :745. |
| Effort | S |
| Related IDs |  |
| Audit working IDs | F-D-006 |

### CF-093

**Token decryption failure after credit consumption leaks a message credit**

| Field | Value |
|---|---|
| Module | Inbox / Billing |
| Area | Backend |
| Status | BILLING |
| Severity | Medium |
| Confidence | Confirmed |
| Location | backend/src/services/conversations.service.js:233→240, :328→335, :428→438 |
| Description | In `sendMessage`, `sendMediaMessage` and `sendTemplateMessage` the credit is consumed first and `decrypt(conversation.waNumber.encryptedAccessToken)` runs outside the try/catch that releases it. A rotated `ENCRYPTION_KEY` (the case `whatsapp.service.js:650-656` documents) makes `decrypt` throw → 500 with the credit kept. `sendAutomatedReply` (`outbound.service.js:76`) decrypts inside its try and is safe. |
| Steps to reproduce / Evidence | Number stored under an old key → every inbox reply 500s and each burns one credit. |
| Expected | Decrypt before charging, or release on any throw. |
| Actual | Credit leak per failed attempt. |
| Impact | Billing. |
| Suggested fix | Move `decrypt` above `consumeMessageCredit`. |
| Effort | S |
| Related IDs |  |
| Audit working IDs | F-D-007 |

### CF-094

**Concurrent inbound webhooks for one conversation run the automation chain in parallel**

| Field | Value |
|---|---|
| Module | Inbox automation |
| Area | Backend |
| Status | RELIABILITY |
| Severity | Medium |
| Confidence | Likely |
| Location | backend/src/controllers/webhook.controller.js:43; backend/src/services/webhook.service.js:743, :778, :832-848 |
| Description | Each Meta POST is processed independently and immediately. Two messages from one customer in separate POSTs (the burst case described at :286-290) execute steps 10-26 concurrently. `alreadyWelcomed` (:832) is count-then-send; `generateAgentReply` runs twice; form and campaign-AI handlers read-then-write session state. Only contact/conversation/message creation is race-hardened. |
| Steps to reproduce / Evidence | Two rapid messages from a new number → both pass `alreadyWelcomed` before either stores its outbound row → two welcome messages (or two AI replies). |
| Expected | Per-conversation serialisation. |
| Actual | Duplicate automated replies possible. |
| Impact | UX / spam to customer. |
| Suggested fix | Serialise per conversation (BullMQ queue keyed by conversation, or `pg_advisory_xact_lock`). |
| Effort | M |
| Related IDs | CF-095 |
| Audit working IDs | F-D-009 |

### CF-095

**`NODE_ENV` defaults to `development`, which silently disables migrations and makes Redis give up after the first failure**

| Field | Value |
|---|---|
| Module | Infra / Boot |
| Area | Backend |
| Status | RELIABILITY |
| Severity | Medium |
| Confidence | Confirmed |
| Location | backend/src/config/env.js:7; backend/src/lib/redis.js:60-70; backend/src/server.js:221-228, :277-300 |
| Description | `NODE_ENV` defaults to `'development'`. With that value (a deploy that forgets to set it): `migrate deploy` is skipped (server.js:221-228); a Redis health failure only degrades instead of exiting (:284-287); and `retryStrategy` returns `null` on the *first* failure because `GIVE_UP_AFTER = 0` (redis.js:60-68), so any transient Redis blip after boot permanently ends every connection — all six workers stop and never reconnect, with ECONNREFUSED logs suppressed in development (redis.js:38-40). The same "give up immediately" applies to `NODE_ENV=test`. Even in genuine dev, one Redis restart kills the queues until the Node process restarts. |
| Steps to reproduce / Evidence | Start with Redis up and `NODE_ENV` unset → stop/start Redis → workers never resume; no log line. |
| Expected | Production-safe defaults; bounded but non-zero reconnects in dev. |
| Actual | As described. |
| Impact | Silent loss of every background feature on a mis-set environment. |
| Suggested fix | Require `NODE_ENV` in production images (fail fast when unset), set `GIVE_UP_AFTER` to e.g. 20, and log the give-up once regardless of env. |
| Effort | S |
| Related IDs | CF-096, CF-098 |
| Audit working IDs | F-E-010 |

### CF-096

**A failed `prisma migrate deploy` at boot only logs; the server serves traffic against an old schema**

| Field | Value |
|---|---|
| Module | Infra / Boot |
| Area | Backend |
| Status | RELIABILITY |
| Severity | Medium |
| Confidence | Confirmed |
| Location | backend/src/server.js:216-231; backend/package.json:17; backend/src/server.js:216-231, backend/package.json (`start:prod`), deploy-vps.sh:63-67, DEPLOY.md:205-208 |
| Description | `execFileSync(... 'migrate', 'deploy')` is wrapped in a try/catch whose catch only `console.error`s (:229-231); boot continues to `prisma.$connect`, plan upserts (which will throw on missing columns and are themselves swallowed, :211-213 / :258-260), worker start and `app.listen`. Every request touching a new column then 500s. `start:prod` additionally runs `migrate deploy` before `server.js`, so under that script migrations run twice (harmless but redundant) and a failure there does stop the start — the plain `start` script does not. |
| Steps to reproduce / Evidence | Introduce a migration that fails (lock timeout / drift) → log `[Migration] Failed to run migration` → server reports `running on port …` and returns 500s. |
| Expected | Exit non-zero so the orchestrator keeps the previous release. |
| Actual | Half-migrated app goes live. |
| Impact | Outage/data errors after a bad deploy with a misleading "healthy" process. |
| Suggested fix | `process.exit(1)` in the catch when `NODE_ENV === 'production'`; pick one of the two migrate paths. |
| Effort | S |
| Related IDs | CF-095 |
| Audit working IDs | F-E-011, F-F-002 |

### CF-097

**Prisma pool forced to `connection_limit=3` shared by ~19 concurrent worker slots plus all HTTP traffic**

| Field | Value |
|---|---|
| Module | Infra / DB |
| Area | Backend |
| Status | PERF |
| Severity | Medium |
| Confidence | Likely |
| Location | backend/src/lib/prisma.js:10-15; backend/src/workers/campaign.worker.js:643; backend/src/config/env.js:83; backend/src/workers/email.worker.js:16; backend/src/workers/workflow.worker.js:77; backend/src/workers/sequence.worker.js:126; backend/src/workers/billing.worker.js:14; backend/src/workers/agent.worker.js:59; backend/src/lib/prisma.js:10-15,25; backend/src/server.js:302-313; backend/src/workers/sequence.worker.js:126; backend/src/config/env.js:83 |
| Description | Unless `DATABASE_URL` already carries `connection_limit`, the client appends `connection_limit=3`. The same single PrismaClient serves the HTTP API and six in-process workers whose concurrency adds up to 2 (campaign default) + 5 (email) + 1 (billing) + 5 (workflow) + 5 (sequence) + 1 (agent) = 19 slots, plus the fire-and-forget webhook processing (CF-116) and the `$transaction` in `runBillingCycleSweep` (`subscription.service.js:385`) that pins one of the three connections for its whole duration. Prisma's default `pool_timeout` is 10 s, after which queries throw P2024. Those throws land in the un-guarded spots listed in CF-012/CF-121 (campaign loop status read, workflow final update) and in webhook processing (lost events, CF-116). |
| Steps to reproduce / Evidence | Static; run a 2 000-recipient campaign while a workflow burst and inbox traffic hit the API → expect `Timed out fetching a new connection from the connection pool` in logs. |
| Expected | Pool sized to the concurrency (or workers in a separate process with its own pool); PgBouncer-aware settings. |
| Actual | 3 connections. |
| Impact | Latency spikes, P2024 errors that cascade into stranded campaigns/runs and dropped webhooks. |
| Suggested fix | Default to e.g. `connection_limit=15` (bounded by the DB plan) or make it explicit per deploy; split workers into a separate process; document in DEPLOY.md. |
| Effort | S |
| Related IDs | CF-012, CF-121, CF-116 |
| Audit working IDs | F-E-008, F-F-009 |

### CF-098

**A Redis outage in production makes queue enqueues and the token-revocation check hang instead of failing**

| Field | Value |
|---|---|
| Module | Infra / Redis |
| Area | Backend |
| Status | RELIABILITY |
| Severity | Medium |
| Confidence | Likely |
| Location | backend/src/lib/redis.js:60-78, :84-91; backend/src/lib/tokenDenylist.js:37-44; backend/src/middleware/authenticate.js:22; backend/src/services/campaigns.service.js:763, :771; backend/src/services/workflowEngine.service.js:528-529 |
| Description | In production `retryStrategy` retries forever (:61-70) and every client uses `maxRetriesPerRequest: null` with ioredis' default offline queue, so a command issued while Redis is down neither fails nor times out — it waits until Redis returns. `isAccessTokenRevoked` does `await redis.exists(...)` with no `redis.status` check and no timeout; its catch (the documented "fail open") is never reached. `authenticate` awaits it on every request (:22). Likewise `campaignQueue.add` in `launchCampaign`, `enqueueWorkflowResume`, invite-email enqueue etc. hang the HTTP request / webhook processing. The rate limiter and OAuth code store avoid this by checking `redis.status === 'ready'` first (`middleware/rateLimit.js:70`, `controllers/auth.controller.js:64, :85`) — the denylist does not. |
| Steps to reproduce / Evidence | ioredis semantics: with `maxRetriesPerRequest: null` queued commands are only flushed or rejected on reconnect/`disconnect()`. Stop Redis in a production-mode instance → every authenticated API call hangs until the client/proxy timeout. |
| Expected | Short command timeout / status check → degrade (fail-open for revocation as the comment says; 503 for enqueue). |
| Actual | Whole authenticated API unresponsive during a Redis outage. |
| Impact | Total API outage from a cache outage. |
| Suggested fix | Check `redis.status === 'ready'` in `isAccessTokenRevoked`/`revokeAccessToken`; add `commandTimeout` or `enableOfflineQueue: false` on the shared client; wrap `queue.add` calls with a timeout. |
| Effort | S |
| Related IDs | CF-095 |
| Audit working IDs | F-E-009 |

### CF-099

**Graceful shutdown misses the agent worker/queue and cannot finish a campaign job within its 25 s budget**

| Field | Value |
|---|---|
| Module | Infra / Workers |
| Area | Backend |
| Status | RELIABILITY |
| Severity | Medium |
| Confidence | Confirmed |
| Location | backend/src/server.js:384-413, :313; backend/src/workers/campaign.worker.js:410-617, :21 |
| Description | `shutdown` closes campaign/email/billing/workflow/sequence workers and their queues (:396-403) but not `agentWorker` (assigned at :313) or `agentQueue`, nor any of the per-worker `createBullConnection` clients. `Worker.close()` waits for the active job to finish, but a campaign job is one loop over *all* recipients with a ≥250 ms delay per send (:21, :616) — 1 000 recipients ≈ 4+ minutes — and the loop has no shutdown flag. The 25 s timer (:389-392) then calls `process.exit(1)` mid-loop, leaving `SENDING` rows and a RUNNING campaign that nothing resumes (CF-012). The comment at :381-383 ("Prevents half-processed campaigns and double sends on redeploys") is therefore not achieved. |
| Steps to reproduce / Evidence | SIGTERM during a 1 000-recipient campaign → `[Server] Shutdown timed out — forcing exit`; after restart the campaign is stuck RUNNING. |
| Expected | Loop observes a shutdown signal, releases its SENDING claims, and the job is re-queued with resume semantics; agent worker closed too. |
| Actual | Forced exit; agent worker killed without close. |
| Impact | Every deploy during a campaign strands it. |
| Suggested fix | Add `agentWorker?.close()` / `agentQueue.close()`; have the campaign loop check a module-level `stopping` flag each iteration, reset SENDING→PENDING, and re-enqueue `{resume: true}` before returning. |
| Effort | S |
| Related IDs | CF-012 |
| Audit working IDs | F-E-012 |

### CF-100

**The request-log middleware writes the full `req.url`, including query strings and path tokens, to a plaintext file: invite tokens, OAuth `code`/`state`, the Google one-time exchange code and the Meta webhook verify token all land on disk**

| Field | Value |
|---|---|
| Module | Logging / Secrets |
| Area | Backend |
| Status | SECURITY |
| Severity | Medium |
| Confidence | Confirmed |
| Location | backend/src/app.js:31-38, backend/src/lib/logger.js:6,10,36-44, backend/src/routes/invitations.routes.js:35-36, backend/src/controllers/auth.controller.js:70, backend/src/routes/auth.routes.js:169-170,324-327, backend/src/controllers/webhook.controller.js:7, backend/src/controllers/instagram.controller.js:116, frontend/src/App.jsx:287, .gitignore:38 |
| Description | `logToFile(`${req.method} ${req.url} - Status: ...`)` runs for every request, including the SPA fallback. It records: - `GET /api/v1/invitations/<token>` and `POST /api/v1/invitations/<token>/accept` (a bearer-equivalent invite token in the path); - the SPA invite page (`/invite/accept?token=...`); - `GET /api/v1/auth/google/callback?state=...&code=...`, where the state carries the invite token as base64url JSON that is signed but not encrypted (oauthState.js:10); - `GET /auth/callback?code=<64-hex one-time code>` (auth.controller.js:70), the code that `/auth/exchange` swaps for an access+refresh token pair within 120 s; - `GET /api/v1/auth/meta/callback?code=&state=`; - `GET /api/v1/webhook?hub.verify_token=<META_WEBHOOK_VERIFY_TOKEN>` on every Meta verification; - `/api/v1/oauth/authorize?...&state=`. Error paths also log `req.url` via `console.error`/`console.warn` (errorHandler.js:38,48,57,69). |
| Steps to reproduce / Evidence | The file is `backend/server_error.log` (logger.js:6). It rotates at 5 MB and keeps one generation (`server_error.log.1`, lines 10, 36-43), so retention is set by volume, not time. On the VPS it persists across restarts. It is git-ignored (`*.log`, .gitignore:38) and no route serves it (`grep server_error` finds only logger.js), so exposure requires host, backup or log access. That is why this is Medium, not High. |
| Expected | Log `req.path`, or `originalUrl` with `token\|code\|state\|hub.verify_token\|key` parameters and `/invitations/:token` redacted. |
| Actual | The raw URL, including secrets, is written unencrypted to disk. |
| Impact | Anyone with shell, backup or log-shipping access can accept pending invites into any workspace and replay a Google one-time code that has not yet been exchanged (120 s window). |
| Suggested fix | Use a redacting URL formatter in the request-log middleware; drop the query string entirely for 2xx responses. |
| Effort | S |
| Related IDs | CF-128 |
| Audit working IDs | F-A1-011 |

### CF-101

**API-key authentication ignores workspace suspension / subscription state (public API and OTP API keep working after suspension)**

| Field | Value |
|---|---|
| Module | Public API / Authentication OTP API |
| Area | Backend |
| Status | SECURITY |
| Severity | Medium |
| Confidence | Confirmed |
| Location | backend/src/middleware/authenticateApiKey.js:17-52, backend/src/routes/public.routes.js:19, backend/src/authentication/authentication.routes.js:10, backend/src/middleware/workspaceContext.js:19-34 (contrast), backend/prisma/schema.prisma:766-780 |
| Description | `authenticateApiKey` looks up `ApiKey` by hash and `revokedAt: null`, then fabricates `req.user = { role: 'CLIENT', ... }`. It never loads the workspace, so `workspace.suspended` and CANCELLED/EXPIRED subscriptions — which block every dashboard route in `workspaceContext` — are not enforced for any key-authenticated route. ApiKey has no `expiresAt`. |
| Steps to reproduce / Evidence | Super-admin suspends workspace W; `POST /api/v1/public/messages` with W's key still sends (whatsapp.service.js:565-627); `POST /api/v1/authentication/generate` still sends. |
| Expected | Suspended or billing-inactive workspaces refused on all key-authenticated surfaces. |
| Actual | Suspension only applies to browser sessions. |
| Impact | Platform cannot actually stop an abusive/unpaid workspace from sending; compounds CF-002. |
| Suggested fix | In `authenticateApiKey` select `workspace: { suspended, subscription: { status } }` and return 403 as `workspaceContext` does. |
| Effort | S |
| Related IDs | CF-025, CF-002, CF-102 |
| Audit working IDs | F-A1-003 |

### CF-102

**No rate limiting on the public API or the Authentication OTP API; OTP `generate` has no per-recipient cooldown**

| Field | Value |
|---|---|
| Module | Public API / Authentication OTP API |
| Area | Backend |
| Status | SECURITY |
| Severity | Medium |
| Confidence | Confirmed |
| Location | backend/src/routes/public.routes.js (no `rateLimit` import), backend/src/authentication/authentication.routes.js:1-26 (no `rateLimit`), backend/src/routes/index.js:108-110, backend/src/authentication/otp.service.js:11,337-357 (MAX_ATTEMPTS applies to verify only) |
| Description | `grep rateLimit(` across `backend/src` shows limiters on auth, oauth, invitations, forms, widget, assistant, copilot, whatsapp-verify, onboarding, widget-preview — none on `/public/*` or `/authentication/*`. `generateOtp` creates a transaction and sends immediately with no cooldown per phone; only `verify` is capped (5 attempts per transaction). Key guessing is not a concern (256-bit random keys, sha256 lookup) but volume abuse is. |
| Steps to reproduce / Evidence | Loop `POST /api/v1/authentication/generate {to: <victim>}` with one key -> unlimited WhatsApp OTP messages to a third party; unlimited `POST /public/messages`. |
| Expected | Per-key and per-recipient limits (e.g. N OTPs per phone per 10 min, M sends/min per key). |
| Actual | None. |
| Impact | Mass-messaging abuse from a single leaked or self-obtained key (CF-006); Meta quality-rating/enforcement risk. |
| Suggested fix | `rateLimit` keyed on `req.apiKey.id` (extend `subject`) on both routers; per-recipient cooldown in `createAuthenticationTransaction`. |
| Effort | S |
| Related IDs | CF-006, CF-002; Lead 3 |
| Audit working IDs | F-A1-005 |

### CF-103

**`POST /public/webhooks` bypasses Zod validation and stores any string as the workspace webhook URL (SSRF)**

| Field | Value |
|---|---|
| Module | Public API / Settings |
| Area | Backend |
| Status | SECURITY |
| Severity | Medium |
| Confidence | Confirmed |
| Location | backend/src/routes/public.routes.js:78-97, backend/src/routes/settings.routes.js:12, backend/src/validators/index.js:365-370, backend/src/services/settings.service.js:117-127, backend/src/services/settings.service.js:253-274 |
| Description | The dashboard route validates with `settingsSchemas.update` (`webhookUrl: z.string().url()`), but the public route builds a `mockReq` and calls `settingsController.updateSettings` directly; `settings.service.updateSettings` only whitelists field names and validates branding — no URL check. `testWebhook` then `axios.post(ws.webhookUrl, ...)` and the event dispatcher posts every workspace event there. |
| Steps to reproduce / Evidence | `POST /api/v1/public/webhooks {"webhookUrl":"http://169.254.169.254/latest/meta-data/"}` (or `http://localhost:6379/`, or a multi-MB string) -> 200; `POST /workspaces/:id/settings/webhook/test` -> server issues the request to the internal address. |
| Expected | Same schema as the dashboard; `https:` only; block private/link-local ranges. |
| Actual | Unvalidated string persisted; the mock request also lacks `req.user`. |
| Impact | SSRF from the API surface into the hosting network; oversized-string storage. |
| Suggested fix | `validate({ body: settingsSchemas.update })` on the public route; add an SSRF allow-list check in the service used by both paths. |
| Effort | S |
| Related IDs | Lead 9 |
| Audit working IDs | F-A1-006 |

### CF-104

**`lib/encryption.js` uses AES-256-CBC with no MAC and a single static key with no key id or rotation path, and 23 of 24 callers do not handle decrypt failure**

| Field | Value |
|---|---|
| Module | Secrets / Crypto |
| Area | Backend |
| Status | SECURITY |
| Severity | Medium |
| Confidence | Confirmed |
| Location | backend/src/lib/encryption.js:4,17,19-24,26-39, backend/src/services/platformSettings.service.js:26-36, backend/src/services/whatsapp.service.js:562,595, backend/src/workers/campaign.worker.js:186,398, backend/src/services/conversations.service.js:240,335,438 (24 call sites in total) |
| Description | (a) Unauthenticated CBC: ciphertext is `ivHex:dataHex` with no HMAC/GCM tag. Anyone with DB write access (or a SQL-injection write) can flip IV bits to change the first plaintext block of a stored WhatsApp access token, Instagram token or platform secret without detection. A PKCS#7 padding error is also distinguishable from garbage output, which is a padding-oracle shape if any path ever reflects decrypt errors. (b) One key is derived at module load (`const KEY = deriveKey(env.ENCRYPTION_KEY)`, line 17). The format carries no version or key id, and there is no `ENCRYPTION_KEY_OLD` or re-encrypt script (`grep -rn "reencrypt\\|ENCRYPTION_KEYS"` finds nothing). Rotating the key therefore irrecoverably breaks every stored `encryptedAccessToken` and `SystemSetting`. (c) Decrypt failure: only `loadPlatformSettings` catches it (it falls back to env, platformSettings.service.js:26-36). The other 23 callers call `decrypt()` bare. A bad row throws `Error('Malformed encrypted value')` or an OpenSSL `bad decrypt` error with no `status`, which becomes a generic 500 on HTTP paths; in `campaign.worker.js:186` the whole campaign job fails. The 32-ASCII-char key path uses raw UTF-8 bytes with no KDF, so entropy is limited to the printable-ASCII space; that is acceptable if the key is randomly generated. |
| Steps to reproduce / Evidence | `encrypt()` returns `iv.toString('hex') + ':' + encrypted.toString('hex')` (line 23), with no tag. Change ENCRYPTION_KEY and restart: overrides log `[Settings] Could not decrypt ...`, and every send throws inside `decrypt` (line 37, `decipher.final()`). |
| Expected | AES-256-GCM (or CBC+HMAC) with a versioned prefix (`v2:<kid>:iv:tag:ct`), a keyring (current + previous) for rotation, a re-encryption script, and a typed `DecryptError` mapped to a clear "reconnect this number" error. |
| Actual | Malleable ciphertext, no rotation, opaque 500s on key mismatch. |
| Impact | The integrity of stored Meta tokens is not protected. Rotating the key after a suspected leak is effectively impossible without reconnecting every WhatsApp number. |
| Suggested fix | Add a GCM encrypt with a key id and a `decrypt` that also reads legacy CBC values; add a script that re-encrypts `WaNumber.encryptedAccessToken`, `Workspace.instagramAccessToken` and `SystemSetting.value`. |
| Effort | M |
| Related IDs | CF-107 |
| Audit working IDs | F-A1-010 |

### CF-105

**Outgoing webhook dispatcher and "Send test" have no SSRF guard; the test is a status/error-code oracle and follows redirects**

| Field | Value |
|---|---|
| Module | Settings / Webhooks |
| Area | Backend |
| Status | SECURITY |
| Severity | Medium |
| Confidence | Confirmed |
| Location | backend/src/services/outgoingWebhook.service.js:50-64,97-103, backend/src/services/settings.service.js:250-300, backend/src/validators/index.js:365-370, backend/src/routes/settings.routes.js:15 |
| Description | `webhookUrl` is checked only by `z.string().url()` plus an `^https?://` refine (the public path skips even that, CF-103). Neither `deliverOnce` nor `testWebhook` resolves the host or blocks private/loopback/link-local/metadata addresses, though `lib/siteCrawler.js` already has DNS-resolving guards. `testWebhook` uses axios defaults (follows 5 redirects) and returns `status`, "responded with status N", `ECONNREFUSED`/`ECONNABORTED`. The dispatcher POSTs to any address on every subscribed event. |
| Steps to reproduce / Evidence | CLIENT `PATCH /settings {webhookUrl:"http://10.0.0.5:9200/_bulk"}` then `POST /settings/webhook/test` → status/error code reveals open ports; every inbound message then POSTs JSON there (webhook.service.js:432). |
| Expected | Resolve and reject non-public addresses on save and per attempt, pin IP, no redirects, generic errors. |
| Actual | No guard. |
| Impact | Blind SSRF POST into the hosting network and internal port scanning from any CLIENT account. |
| Suggested fix | Extract `assertSafeUrl` + resolve-public check into `lib/safeUrl.js`; use in save, dispatch and test; `maxRedirects: 0` on test; collapse error text. |
| Effort | S |
| Related IDs | CF-103, CF-117; Lead 9 |
| Audit working IDs | F-A2-008 |

### CF-106

**Outgoing webhook retries are in-process `setTimeout` chains with unbounded concurrency; signing secret defaults to empty string**

| Field | Value |
|---|---|
| Module | Settings / Webhooks |
| Area | Backend |
| Status | RELIABILITY |
| Severity | Medium |
| Confidence | Confirmed |
| Location | backend/src/services/outgoingWebhook.service.js:29,37-39,97-116,121-125, backend/prisma/schema.prisma:52, backend/src/services/webhook.service.js:432,977 |
| Description | (a) `emitWebhook` is fire-and-forget; each event sleeps through `[0,2s,10s,60s,300s]` with a 10 s timeout per attempt (~6.5 min) in process memory. A restart drops all pending retries; concurrency is unbounded. `message.status` fires per status update, so a 50k-recipient campaign aimed at a black-holed endpoint holds on the order of 150k concurrent chains and sockets; a tenant can degrade the shared process deliberately. (b) `webhookVerifyToken String @default("")` plus `String(secret \|\| '')` means unconfigured workspaces sign with HMAC key `""`, which anyone can forge. |
| Steps to reproduce / Evidence | Code trace above. |
| Expected | BullMQ delivery queue with limiter/backoff; random secret generated on first URL save. |
| Actual | In-memory, unbounded, lossy retries; forgeable default signature. |
| Impact | Lost events, memory/socket exhaustion, untrustworthy signatures. |
| Suggested fix | `webhook-delivery` queue; `crypto.randomBytes(32)` secret on URL save; refuse to sign with an empty key. |
| Effort | M |
| Related IDs | CF-105; Lead 9 |
| Audit working IDs | F-A2-009 |

### CF-107

**Many super-admin writes are not audited (platform settings, Meta app webhook callback, cross-workspace invitations, number pool)**

| Field | Value |
|---|---|
| Module | Super Admin / Audit |
| Area | Backend |
| Status | SECURITY |
| Severity | Medium |
| Confidence | Confirmed |
| Location | backend/src/controllers/admin.controller.js:17-40,51-64,163-176,257-261,267-270 (unaudited), backend/src/services/audit.service.js:20; backend/src/services/platformSettings.service.js:118-123,134-157, backend/src/config/settingsStore.js:14-32,48-64, backend/src/controllers/admin.controller.js:240-242,267-270, backend/src/routes/admin.routes.js:9,22-23, backend/src/config/env.js:222-231 |
| Description | `audit.record` covers ban, assign number, suspend, ticket update, impersonate and plan CRUD, but not `updateSystemSettings`, `repairWebhooks` (re-points every tenant's inbound Meta traffic via `setAppWebhookSubscription(req.body.callbackUrl)`), `workspaceInvite`/`workspaceInviteLink`/`workspaceRevokeInvite` (membership minted in any tenant), `addNumber`, `requestOtp`/`verifyOtp`, `resetAllAssignments`, `resetPoolEntry`, `unbanPoolEntry`, `twilioSync`, `syncPoolFromWaba`. |
| Steps to reproduce / Evidence | 8 `audit.record` call sites vs 22 mutating admin routes. |
| Expected | Every privileged mutation audited. |
| Actual | The highest-impact actions are unaudited. |
| Impact | A compromised or rogue super admin can redirect all webhooks, change credentials, or join any workspace without trace. |
| Suggested fix | Add `audit.record` to each handler (log callback URL and setting keys without values); require a reason. |
| Effort | S |
| Related IDs | CF-032 |
| Audit working IDs | F-A2-015, F-A1-014 |

### CF-108

**Impersonation writes the customer's tokens to shared localStorage — the admin's other tabs silently become the customer, with no banner and no way back**

| Field | Value |
|---|---|
| Module | SuperAdmin / Impersonation |
| Area | Frontend |
| Status | SECURITY |
| Severity | Medium |
| Confidence | Confirmed |
| Location | frontend/src/pages/SuperAdminView.jsx:917,925-938, frontend/src/pages/Dashboard.jsx:3155-3165,3172-3180, frontend/src/lib/api.js:83 |
| Description | The admin's tokens are stashed in tab-scoped `sessionStorage.impersonatorSession`, while the customer's tokens overwrite shared `localStorage`. Every other open admin tab now calls the API as the customer, without the amber banner (which reads sessionStorage, :3156) and without "Return to admin". Closing the impersonating tab loses the admin backup; `returnToAdmin` only swaps storage and never ends the impersonation server-side or revokes the customer refresh token; an expired impersonated session's `logout()` deletes the backup (api.js:83). |
| Steps to reproduce / Evidence | Code trace above. |
| Expected | Admin session intact; impersonation tab-scoped and clearly marked, or server-tracked and revoked on return. |
| Actual | Other tabs silently switch identity. |
| Impact | Super admin may act as the customer unknowingly; audit trail attributes actions to the customer. |
| Suggested fix | Keep impersonation tokens in sessionStorage, or tag `user.impersonating` so every tab shows the banner; add a server end-impersonation endpoint; listen to `storage` events. |
| Effort | M |
| Related IDs | CF-032, CF-223 |
| Audit working IDs | F-H-025 |

### CF-109

**Invitation acceptance: seat-limit and `maxUses` checks are check-then-act without a lock**

| Field | Value |
|---|---|
| Module | Team / Invitations |
| Area | Backend |
| Status | RELIABILITY |
| Severity | Medium |
| Confidence | Likely |
| Location | backend/src/services/invitations.service.js:288-299, :318-330, :361-376; backend/src/services/subscription.service.js:184-197 |
| Description | `acceptInvitation` checks `useCount >= maxUses` (:288) and `assertWithinLimit(..., 'member')` (:295; a plain count, subscription.service.js:192-193) and only then creates the member (:297) and increments `useCount` later (:318+). In the transactional variant (:355-376) `assertWithinLimit` uses the global `prisma` client, not `tx`, and the tx runs at READ COMMITTED with no row lock on the invitation. N users redeeming the same LINK invite concurrently all pass both checks. |
| Steps to reproduce / Evidence | Plan with `memberLimit: 1` extra seat, LINK invite `maxUses: 1`; fire 5 concurrent accepts from 5 accounts → up to 5 members created, `useCount` 5. |
| Expected | Atomic `updateMany({ where: { id, useCount: { lt: maxUses } }, data: { useCount: { increment: 1 } } })` claim and a locked seat count. |
| Actual | Limits bypassable by concurrency. |
| Impact | Plan seat limit bypass (billing), invite-link overuse. |
| Suggested fix | Claim `useCount` atomically first; run the seat count inside the same tx with `SELECT … FOR UPDATE` on the workspace/subscription row. |
| Effort | S |
| Related IDs |  |
| Audit working IDs | F-E-015 |

### CF-110

**Carousel card `_assetId` from user template JSON is loaded without a workspace check — another tenant's stored media can be sent**

| Field | Value |
|---|---|
| Module | Templates |
| Area | Backend |
| Status | SECURITY |
| Severity | Medium |
| Confidence | Likely |
| Location | backend/src/lib/templateStructure.js:161-167, backend/src/services/templates.service.js:268-273,300-301, backend/src/services/templateImage.service.js:595,607-609,480-497 |
| Description | `headerAssetId` is ownership-checked at create, but a carousel card's `_assetId` is copied verbatim by `normalizeTemplateComponents` (:167). At send, `carouselComponent` loads it with `templateAsset.findUnique({ where: { id: assetId } })` (no workspaceId), uploads the bytes to the attacker's number and sends them. It also overwrites the victim asset's `metaMediaId/metaMediaNumberId` cache (:495). |
| Steps to reproduce / Evidence | Create or PATCH a template (PATCH stores locally, :300-301, see CF-112) with a card header carrying `"_assetId":"<workspace B asset id>"`; send to own number; templateImage.service.js:609 loads B's asset. |
| Expected | Asset resolved with `workspaceId: template.workspaceId`. |
| Actual | Any existing asset id accepted. |
| Impact | Cross-tenant read of stored media and cache tampering. Needs the asset cuid (not enumerable), so realistic vector is a former member or leaked id. Also allows sending media that differs from the Meta-approved sample. |
| Suggested fix | `findFirst({ id, workspaceId })` at :465 and :609; validate `_assetId` on normalize. |
| Effort | S |
| Related IDs | CF-112, CF-111 |
| Audit working IDs | F-A2-007 |

### CF-111

**Template media recovery `axios.get`s `example.header_handle` from user-editable template JSON with no SSRF guard**

| Field | Value |
|---|---|
| Module | Templates |
| Area | Backend |
| Status | SECURITY |
| Severity | Medium |
| Confidence | Likely |
| Location | backend/src/services/templateImage.service.js:520-549,449-457,595-600, backend/src/lib/templateStructure.js:159-166, backend/src/services/templates.service.js:300-301 |
| Description | When a header/card has no stored asset, `adoptMediaFromHandle` fetches `header_handle[0]` if it matches `^https?://`, with axios defaults (5 redirects, no `maxContentLength`, 20 s) and no host check. Components are user input on create or via local PATCH of an APPROVED template. Bytes are kept only if they sniff as an image, so SSRF is mostly blind, but image-returning internal endpoints are exfiltrated to the attacker's WhatsApp. |
| Steps to reproduce / Evidence | PATCH an approved carousel with card 1 `example.header_handle:["http://169.254.169.254/latest/meta-data/"]` and no `_assetId`; send; server GETs at :532. |
| Expected | Meta-CDN host allow-list, shared guard, size cap, no redirects. |
| Actual | Any http(s) URL fetched. |
| Impact | Blind GET SSRF from the send path; unbounded response buffering. |
| Suggested fix | Host allow-list (`*.fbcdn.net`, `lookaside.fbsbx.com`, `*.whatsapp.net`), `maxContentLength: MAX_IMAGE_BYTES`, `maxRedirects: 0`. |
| Effort | S |
| Related IDs | CF-110, CF-105 |
| Audit working IDs | F-A2-010 |

### CF-112

**Editing an APPROVED/PENDING template updates only the local row; Meta never sees the change**

| Field | Value |
|---|---|
| Module | Templates |
| Area | Both |
| Status | BROKEN |
| Severity | Medium |
| Confidence | Confirmed |
| Location | backend/src/services/templates.service.js:291-320 (`updateTemplate`); frontend/src/pages/Dashboard.jsx:2269 (Edit shown for every non-deleted template when `isAdmin`); frontend/src/components/TemplateModal.jsx:490-493 (PUT name/category/language/components) |
| Description | `updateTemplate` only re-submits to Meta when `template.status === 'REJECTED'`; for APPROVED or PENDING templates it does `prisma.template.update` with the new name/components and keeps `status`/`metaTemplateId`. The approved content on Meta and the stored content now differ: sends are built from the stored components (variable count, buttons) but Meta renders its approved version, and a renamed template is sent under a name Meta does not know (error 132001). In the REJECTED path the Meta call is `.catch(() => null)` and the status is still flipped to PENDING even when re-submission failed. |
| Steps to reproduce / Evidence | Approve template `t1` with 1 variable; Edit in UI to 2 variables -> PUT succeeds, status stays APPROVED; launch a campaign -> Meta rejects each send with parameter mismatch. |
| Expected | Block edits of APPROVED/PENDING content (Meta requires an edit API call or a new version), or push the edit through `lib/meta.js` and reset status to PENDING only on success. |
| Actual | Silent divergence; misleading APPROVED badge. |
| Impact | Failed campaign sends after an innocent edit; wallet debited then refunded per recipient. |
| Suggested fix | Hide Edit for APPROVED unless implementing Meta's template edit endpoint; in the REJECTED path only set PENDING when `createMetaTemplate` resolved. |
| Effort | M |
| Related IDs |  |
| Audit working IDs | F-core-015 |

### CF-113

**Coverage gaps: no tests for billing/wallet, Razorpay, auth/refresh, the campaign worker, or outbound webhook dispatch**

| Field | Value |
|---|---|
| Module | Tests |
| Area | Backend |
| Status | MISSING |
| Severity | Medium |
| Confidence | Confirmed |
| Location | backend/src/**/*.test.js (39 files), backend/tests/ (2 files) |
| Description | The 39 unit test files cover: - CRM: leads, deals, tasks, tickets, quotes, line items, custom fields, saved views, search scope, record scope, export, analytics, forecast, gamification, scoring, distribution, lead forms - workflows: compiler, routing, chat, CRM, inbound - copilot (including injection), the agent, sequences, conversations, partial-update validators, jobIds Grepping every test file for `wallet\|razorpay\|refresh\|billing\|subscription\|campaign.worker` matches **nothing** relevant. The only hits are gamification, which mentions "subscription" in passing, and `refreshed` variable names. Untested: - wallet debit/credit/idempotency (`wallet.service`, `WalletTransaction.idempotencyKey`) - Razorpay order/verify/webhook signature - subscription billing-cycle sweep and renewals - campaign worker send/charge/refund/pause (workers/campaign.worker.js) - retry.service - auth login/refresh rotation/logout, Google OAuth, and the OTP signup flow (only authentication-product OTP scope is tested, tests/otp-scope.test.mjs) - public API key auth and scopes - outbound customer-webhook dispatch Inbound Meta webhook -> workflow **is** covered end to end, including redelivery idempotency (workflowInbound.test.js:404). Tenant isolation is covered only for tasks/activities (tasksActivities.isolation.test.js), search scope, record scope and OTP. No generic test walks every `/workspaces/:id/*` route with a foreign workspace id. |
| Steps to reproduce / Evidence | Static code trace at the cited Location lines; the trace is written out in the Description. |
| Expected |  |
| Actual |  |
| Impact |  |
| Suggested fix | Priority order: wallet/campaign charge and refund, Razorpay verify+webhook, refresh-token rotation, a cross-tenant route sweep driven by routes.json. |
| Effort | M |
| Related IDs |  |
| Audit working IDs | F-JT-003 |

### CF-114

**E2E scripts call a register endpoint that no longer exists; Playwright's default target is production**

| Field | Value |
|---|---|
| Module | Tests / E2E |
| Area | Both |
| Status | BROKEN |
| Severity | Medium |
| Confidence | Confirmed |
| Location | tests-e2e.mjs:11,60,75,113; tests-e2e-v2.mjs:9,48; tests-e2e-v3.mjs:7,24; playwright.config.js:7; tests/smoke.spec.js, tests/discover.spec.js |
| Description | `C:\Users\thete\.claude\jobs\d1cefbb9\tmp\e2epaths.mjs` matched every `req('METHOD','/path')` in the root e2e scripts against routes.json (trailing-slash normalised): - tests-e2e.mjs: 76 calls, 2 unknown: `POST /api/v1/auth/register` and `GET /api/v1/admin/pool`. - tests-e2e-v2.mjs: 71 calls, 1 unknown: `POST /auth/register`. - tests-e2e-v3.mjs: 22 calls, 1 unknown: `POST /auth/register`. - `auth.routes.js` now has only `/register/start`, `/register/verify` and `/register/resend` (routes.md:63-65). There is no `'/register'` route in auth.routes.js (grep). Every script's first step, creating a user, therefore gets 404, and nothing after it can run. README.md's API table still advertises "Register (legacy single-step)". - `/admin/pool` moved under `/admin/platform/*`. - Refuted from the brief: `POST /workspaces/:id/members/invite` (routes.md:343) and `POST /workspaces/:id/wallet/recharge` (routes.md:443) **do exist**. The e2e scripts target `http://localhost:4000` (tests-e2e.mjs:11), and the `backend/scripts/*-check.mjs` target `http://127.0.0.1:4000`. None of them points at production. **`playwright.config.js:7` sets `baseURL: 'https://chatflow.mannmate.com'`** (production) with `headless: false`, so `npx playwright test` drives the live site by default. tests-e2e.mjs:75 and tests-e2e-v3.mjs:24 also try self-registration with `role: 'ADMIN'`, a mass-assignment probe; that is fine as a negative test, but it cannot run because the route is gone. |
| Steps to reproduce / Evidence | Static code trace at the cited Location lines; the trace is written out in the Description. |
| Expected |  |
| Actual |  |
| Impact |  |
| Suggested fix | Replace `/auth/register` with a helper that runs register/start and reads the OTP from the DB. `backend/scripts/signup-helper.mjs` already exists for this. Point Playwright `baseURL` at `process.env.E2E_BASE_URL ?? 'http://localhost:5173'`. |
| Effort | S |
| Related IDs |  |
| Audit working IDs | F-JT-004 |

### CF-115

**Uploads buffer up to 100 MB in memory, docx parsing has no decompression cap, and CRM import bypasses uploadGuard**

| Field | Value |
|---|---|
| Module | Uploads |
| Area | Backend |
| Status | RELIABILITY |
| Severity | Medium |
| Confidence | Likely |
| Location | backend/src/lib/uploadGuard.js:69-73, backend/src/routes/conversations.routes.js:33, backend/src/routes/templates.routes.js:17, backend/src/lib/documentText.js:11,72-76,90-105, backend/src/routes/aiAgent.routes.js:18, backend/src/routes/widgets.routes.js:14, backend/src/routes/crmData.routes.js:9,17-18 |
| Description | `uploader` is well designed (type allow-list, magic bytes, `files: 1`) but: (a) `memoryStorage` with 100 MB `fileSize` on conversation media (reachable by AGENT) and template media — ~10 parallel uploads pin ~1 GB in the single API+worker process, no upload rate limit; (b) knowledge docx (10 MB compressed) goes to `mammoth.extractRawText`, which inflates fully in memory (zip bomb); pdf-parse has no page/time cap; (c) `crmData.routes.js:9` uses bare multer with no `fileFilter`/`verifyFileContents`. |
| Steps to reproduce / Evidence | Code trace above. |
| Expected | Disk/streamed storage for large files, upload rate limit, uncompressed-size check before mammoth, pdf page cap, guard on CRM import. |
| Actual | Whole files in heap; uncapped inflation. |
| Impact | Any member can take down the shared API/worker process. |
| Suggested fix | `diskStorage` for >10 MB routes; sum ZIP uncompressed sizes before parsing; `uploader(ACCEPTS.csv, 10MB)` + `verifyFileContents` on crmData. |
| Effort | M |
| Related IDs | CF-041 |
| Audit working IDs | F-A2-012 |

### CF-116

**Webhook is ACKed before processing; any processing failure permanently loses the event**

| Field | Value |
|---|---|
| Module | Webhooks |
| Area | Backend |
| Status | RELIABILITY |
| Severity | Medium |
| Confidence | Confirmed |
| Location | backend/src/controllers/webhook.controller.js:41-45; backend/src/services/webhook.service.js:25-55, :342-349 |
| Description | `receive` returns 200 (:41) then runs `processWebhook` detached with `.catch(console.error)`. The idempotency comment (:342-349) assumes Meta redelivers on non-200, but Meta never sees a non-200 here. A DB outage, pool timeout (CF-097) or a throw inside `handleStatusUpdate` (e.g. `handleRecipientFailure`) drops the message/status permanently — no dead-letter, no retry. Entries are processed sequentially with no per-entry try/catch, so a throw from `message.create` (:394) also aborts the remaining messages/statuses of the same POST. |
| Steps to reproduce / Evidence | Pause Postgres briefly, send a WhatsApp message → `[Webhook] Processing error` logged; message never appears. |
| Expected | Persist raw event first (or ACK after a bounded attempt) with a retry path. |
| Actual | Fire-and-forget. |
| Impact | Lost customer messages / delivery statuses under load or outages. |
| Suggested fix | Persist the raw payload (table or BullMQ job) before ACK and process with retries; wrap each entry/message in its own try/catch. |
| Effort | M |
| Related IDs | CF-097 |
| Audit working IDs | F-D-008 |

### CF-117

**Workspace knowledge URL indexer uses a hostname-only SSRF guard while the platform already has a DNS-resolving one**

| Field | Value |
|---|---|
| Module | Website widget knowledge / WhatsApp AI Agent sources |
| Area | Backend |
| Status | SECURITY |
| Severity | Medium |
| Confidence | Confirmed |
| Location | backend/src/services/workspaceKnowledge.service.js:40-56 (`BLOCKED_HOST` regex, comment at :34-39 admits "A hostname that resolves to a private address still gets through"), :108-115 (`axios.get` with `maxRedirects: 3`, no redirect re-check); compare backend/src/lib/siteCrawler.js:57-138 (`ipIsPublic`, `assertSafeUrl`, DNS resolution, redirect re-validation used by website analysis) |
| Description | `POST /workspaces/:ws/widgets/knowledge {kind:'url', url}` (any CLIENT) fetches server-side. Hostnames that resolve to RFC1918/169.254 (e.g. `10.0.0.1.nip.io`, attacker DNS) or a public URL that 30x-redirects to `http://169.254.169.254/` pass the regex and are fetched; the response text is stored as a knowledge source and is readable back via `GET /widgets/knowledge` (content preview) and via the widget's AI answers. |
| Steps to reproduce / Evidence | Static trace; `assertFetchableUrl('http://169.254.169.254.nip.io/latest/meta-data/')` passes the regex (hostname does not start with a blocked literal). |
| Expected | Use `safeFetchHtml`/`assertSafeUrl` from lib/siteCrawler.js. |
| Actual | Weaker guard in a second fetcher. |
| Impact | SSRF read of internal HTTP services / cloud metadata from a member account (limited to text/html or text/plain responses, 4 MB, 15 s). |
| Suggested fix | Replace `assertFetchableUrl` + axios with `safeFetchHtml`. |
| Effort | S |
| Related IDs |  |
| Audit working IDs | F-CAI-015 |

### CF-118

**WhatsApp AI Agent readiness counts URL knowledge sources the agent never reads; `escalationThreshold` stored but unused**

| Field | Value |
|---|---|
| Module | WhatsApp AI Agent |
| Area | Backend |
| Status | PARTIAL |
| Severity | Medium |
| Confidence | Confirmed |
| Location | backend/src/services/aiAgent.service.js:59, :132-135, :460-500; frontend/src/pages/AutomationView.jsx:2168-2260 (sources panel posts to `/widgets/knowledge`); backend/src/services/campaignAi.service.js:319-336 |
| Description | The AI Agent page adds URL knowledge sources (`KnowledgeSource` + `SiteKnowledgeChunk` via workspaceKnowledge.service) and readiness awards 25 pts for one. But `generateAgentReply` and `generateCampaignReply` only pass `ws.aiAgentKnowledge` (12k-char text column) to the model; no retrieval over chunks (no import of siteRetrieval/embeddings in aiAgent/campaignAi/webhook). `escalationThreshold` (edited in AiAgentsView Setup modal :200-210, validated in updateAgentConfig :187-195) is never read at runtime (only comments intentRouting.service.js:115,152). |
| Steps to reproduce / Evidence | Static code trace at the cited Location lines; the trace is written out in the Description. |
| Expected | Agent answers from indexed sources; threshold gates escalation. |
| Actual | Sources ignored for WhatsApp; threshold dead. |
| Impact | Misleading readiness; wasted indexing. |
| Suggested fix | Retrieve top-k chunks for the workspace corpus into the prompt; use or remove threshold. |
| Effort | M |
| Related IDs | CF-036 |
| Audit working IDs | F-CAI-008 |

### CF-119

**Six BullMQ workers run inside the HTTP process; ~19 Redis connections per instance; the agent worker is never closed on shutdown**

| Field | Value |
|---|---|
| Module | Workers / Ops |
| Area | Backend |
| Status | RELIABILITY |
| Severity | Medium |
| Confidence | Confirmed |
| Location | backend/src/server.js:302-313, backend/src/server.js:394-404, backend/src/lib/redis.js:73-93, backend/src/queues/*.js, backend/src/workers/*.js |
| Description |  - **Workers share the web process.** Campaign, email, billing, workflow, sequence and agent workers all start in the web process (server.js:303-313). CPU-heavy work shares the event loop with HTTP, including AI calls, PDF/mammoth parsing and campaign loops. So does the 3-connection DB pool (CF-097). DEPLOY.md confirms "BullMQ workers live *inside* the web process". Horizontal scaling therefore multiplies workers along with web capacity. - **Redis connections.** Each instance opens 1 shared ioredis connection (redis.js:73), 6 Queue connections and 6 Worker connections (redis.js:85). BullMQ Workers also duplicate a blocking connection, which gives roughly 19 connections per instance. That fits Render Key Value starter limits, but two deployments (Render plus VPS, CF-020) double it. - **Shutdown.** `shutdown()` closes campaign, email, billing, workflow and sequence workers and their queues (server.js:396-403). It never closes `agentWorker` (created at :313) or the agent queue (queues/agent.queue.js:11). A SIGTERM mid-job leaves the agent job to be reclaimed only after `WORKER_STALLED_INTERVAL_MS` (default 300 000 ms = 5 min, env.js:80). With concurrent redeploys this can run an agent task twice. |
| Steps to reproduce / Evidence | Static code trace at the cited Location lines; the trace is written out in the Description. |
| Expected |  |
| Actual |  |
| Impact |  |
| Suggested fix | Add `agentWorker?.close()` and `agentQueue.close()` to shutdown. Add a `WORKERS_ENABLED` env var and run a separate worker process (Render background worker / PM2 second app). |
| Effort | S (shutdown) / M (process split) |
| Related IDs | CF-097, CF-020 |
| Audit working IDs | F-G-004 |

### CF-120

**Workflow runs parked on a delay (and reply reminders) live only in Redis — no DB sweep, stranded WAITING forever after a Redis loss**

| Field | Value |
|---|---|
| Module | Workflow |
| Area | Backend |
| Status | RELIABILITY |
| Severity | Medium |
| Confidence | Confirmed |
| Location | backend/src/services/workflowEngine.service.js:517-538, :500-512, :742-762; backend/src/queues/workflow.queue.js:47-49, :67-69; backend/src/server.js:302-355 |
| Description | A `delay` step writes `status: 'WAITING', cursor: i+1` (:521-526) and relies solely on a delayed BullMQ `resume` job (:528-529). Nothing in the database records *when* the run is due (no `nextRunAt`/`resumeAt` column is written), and the boot sequence recovers campaigns, retries and sequences but has no workflow recovery (server.js:323-347). The code itself states the deployed Redis has no persistence (server.js:339-341). The same applies to `reply-reminder` jobs (:505-506). The 24 h reply timeout (:758-761) is only evaluated when the customer writes again, and only for runs awaiting a reply, so a delay-parked run never times out. Contrast the sequence engine, which was explicitly built with a DB sweep for exactly this reason (`backend/src/queues/sequence.queue.js:8-10`). |
| Steps to reproduce / Evidence | Workflow "keyword → message → delay 1h → message"; trigger it; restart Redis (or Upstash flush) → the second message never goes; `WorkflowRun` stays `WAITING` indefinitely; `hasActiveRun` (:810) keeps reporting the conversation as having an active run, so control words like "cancel" are acknowledged against a ghost run. |
| Expected | Due time persisted in the run row + periodic sweep that re-enqueues overdue WAITING runs (as sequences do). |
| Actual | Redis is the only copy of the schedule. |
| Impact | Silent loss of follow-up messages for every delayed workflow on any Redis restart/eviction. |
| Suggested fix | Store `resumeAt` on `WorkflowRun` when parking; add a repeat job (or piggy-back on the sequence sweep) that enqueues `status=WAITING AND resumeAt<=now()`; add an overall run TTL. |
| Effort | M |
| Related IDs | CF-121; Lead 13 |
| Audit working IDs | F-E-006 |

### CF-121

**`advanceRun` has no claim/lock — concurrent replies, BullMQ retries and cancellations race and re-execute steps**

| Field | Value |
|---|---|
| Module | Workflow |
| Area | Backend |
| Status | RELIABILITY |
| Severity | Medium |
| Confidence | Confirmed |
| Location | backend/src/services/workflowEngine.service.js:422-460, :496-499, :521-526, :582-585, :616-619, :742-765, :787-802; backend/src/workers/workflow.worker.js:8-12 |
| Description | `advanceRun` reads the row (:423), runs every step from `stored.cursor` in memory, and only persists the cursor when it parks or finishes. There is no `updateMany({where:{id, status, cursor}})` claim. (a) Two inbound replies processed concurrently (webhooks are processed in parallel, CF-094) both call `resumeAwaitingRun` → both see `WAITING` + `AWAIT_KEY` and both execute the following steps → every message/template/CRM action after the `wait_reply` runs twice. (b) If the final `workflowRun.update` (:616) or a park update throws (P2024 pool timeout, CF-097), the `resume` job throws, BullMQ retries it (attempts 3, `workflow.queue.js:13`), and the retry restarts from the old cursor → all steps since the delay are re-sent. (c) `cancelActiveRuns` (:787-802) marks runs COMPLETED, but an in-flight `advanceRun` that then reaches a `delay` writes `status: 'WAITING'` unconditionally (:521-526), resurrecting the cancelled run; the resume job later messages a customer who typed "stop"/"cancel". |
| Steps to reproduce / Evidence | Code trace above; `resumeAwaitingRun` (:745-764) has no guard between `findMany` and `advanceRun`. |
| Expected | Single owner per run step (atomic cursor/status claim), idempotent step execution. |
| Actual | Duplicate sends and resurrected cancelled runs are possible. |
| Impact | Duplicate WhatsApp messages (paid) and messaging after opt-out-like "cancel". |
| Suggested fix | Claim with `updateMany({ where: { id, status: stored.status, cursor: stored.cursor }, data: { status: 'RUNNING' } })` and abort on count 0; make every subsequent write conditional on `status: 'RUNNING'`; persist the cursor after each side-effecting step. |
| Effort | M |
| Related IDs | CF-120, CF-094; Lead 13 |
| Audit working IDs | F-E-007 |

### CF-122

**44 of 102 icon-only buttons have no accessible name**

| Field | Value |
|---|---|
| Module | Accessibility |
| Area | Frontend |
| Status | UX |
| Severity | Low |
| Confidence | Confirmed |
| Location | frontend/src/pages/CustomizeBusinessView.jsx:902,1196,1202,1407,1413,1598, frontend/src/pages/ContactsView.jsx:45,1058,1064,1070, frontend/src/pages/AuthenticationDashboard.jsx:630,676, frontend/src/components/LeadDistributionModal.jsx:174, frontend/src/components/TemplateModal.jsx:626, frontend/src/components/TemplatePreviewModal.jsx:87, frontend/src/pages/CrmDashboardView.jsx:1005 |
| Description | A scripted scan found `<button>` elements whose only child is `<I/>` with no `aria-label`/`title`: CustomizeBusinessView 13, IntegrationsView 5, ContactsView 4, Dashboard 3, ProfileView 3, and 1-2 each in 12 other files. Screen readers announce "button" (WCAG 4.1.2). `Btn` cannot forward `aria-label` (CF-187); `useFocusTrap` is used by only 2 dialogs. |
| Steps to reproduce / Evidence | Scan result above. |
| Expected | Every control has an accessible name. |
| Actual | 44 unlabeled. |
| Impact | Unusable for screen-reader users. |
| Suggested fix | Add `aria-label`; add `jsx-a11y/control-has-associated-label` lint. |
| Effort | S |
| Related IDs | CF-187, CF-087 |
| Audit working IDs | F-H-029 |

### CF-123

**Copilot puts the user's email and user id in every Gemini system prompt**

| Field | Value |
|---|---|
| Module | AI Copilot |
| Area | Backend |
| Status | SECURITY |
| Severity | Low |
| Confidence | Confirmed |
| Location | backend/src/services/copilot.service.js:39-41,112-119 |
| Description | `buildSystemPrompt` embeds Name, User ID and Email, back-filled from the DB (:112-118); the email serves no function. Injection posture is otherwise good: tool results carry an "untrusted" preamble, writes are proposals only, `confirmProposal` re-runs `{tool,args}` through ordinary services with no model involvement. |
| Steps to reproduce / Evidence | :40 template string. |
| Expected | No email in prompt; processing notice for CRM data sent to Gemini. |
| Actual | Email sent on every ask. |
| Impact | Unnecessary PII to a third-party processor. |
| Suggested fix | Remove Email; resolve "me" server-side. |
| Effort | S |
| Related IDs | Lead 17 |
| Audit working IDs | F-A2-014 |

### CF-124

**Analytics overview opt-out rate uses the wrong denominator**

| Field | Value |
|---|---|
| Module | Analytics |
| Area | Backend |
| Status | DATA |
| Severity | Low |
| Confidence | Confirmed |
| Location | backend/src/services/analytics.service.js:41-46, :63-77 |
| Description | `totalContacts` is `contact.count({ createdAt >= since })` (contacts *created in the range*) while `optOuts` is `contact.count({ optedOut, optedOutAt >= since })` (any contact that opted out in the range). `optOutRate = percent(optOuts, totalContacts)` therefore divides opt-outs of the whole base by new sign-ups and can exceed 100 %. The card is also labelled "Total Contacts" in AnalyticsView.jsx while it is really "new contacts in range". |
| Steps to reproduce / Evidence | Static code trace at the cited Location lines; the trace is written out in the Description. |
| Expected |  |
| Actual |  |
| Impact |  |
| Suggested fix | Use the full contact count (or contacts messaged in range) as the denominator; rename the KPI. |
| Effort | S |
| Related IDs |  |
| Audit working IDs | F-core-018 |

### CF-125

**Analytics date bucketing uses server-local time in one place and hard-coded IST in another**

| Field | Value |
|---|---|
| Module | Analytics |
| Area | Backend |
| Status | DATA |
| Severity | Low |
| Confidence | Confirmed |
| Location | backend/src/services/analytics.service.js:35-39, :94-131 (`setHours(0,0,0,0)` + `toISOString().slice(0,10)` -> bucket key is the UTC date of the *server's* local midnight); :181-187, :262-270 (`+5.5h` and `AT TIME ZONE 'Asia/Kolkata'` hard-coded) |
| Description | Overview/Delivery day buckets shift with `TZ` of the host (on a UTC host an IST customer's 1 a.m. sends land on the previous day), while Chat analytics assumes India. No workspace timezone setting is consulted (Workspace model has no timezone field used here). |
| Steps to reproduce / Evidence | Static code trace at the cited Location lines; the trace is written out in the Description. |
| Expected |  |
| Actual |  |
| Impact |  |
| Suggested fix | One helper taking the workspace timezone; SQL `date_trunc` with `AT TIME ZONE`. |
| Effort | M |
| Related IDs |  |
| Audit working IDs | F-core-020 |

### CF-126

**"Agent stats" count outbound messages, not chats handled**

| Field | Value |
|---|---|
| Module | Analytics (Agents) / User Analytics |
| Area | Backend |
| Status | DATA |
| Severity | Low |
| Confidence | Confirmed |
| Location | backend/src/services/analytics.service.js:148-179 (`chatsHandled: countMap.get(...)` from `message.groupBy(senderUserId)`) |
| Description | The field named `chatsHandled` (rendered as "Chats handled" in AnalyticsView/UserAnalyticsView) is the number of outbound messages the member sent. A member who sends 40 messages in 1 thread shows 40. |
| Steps to reproduce / Evidence | Static code trace at the cited Location lines; the trace is written out in the Description. |
| Expected |  |
| Actual |  |
| Impact |  |
| Suggested fix | `groupBy(['senderUserId','conversationId'])` distinct count. |
| Effort | S |
| Related IDs |  |
| Audit working IDs | F-core-021 |

### CF-127

**Performance funnel and resolution split are computed from mismatched populations**

| Field | Value |
|---|---|
| Module | Analytics (Performance tab) |
| Area | Backend |
| Status | DATA |
| Severity | Low |
| Confidence | Confirmed |
| Location | backend/src/services/analytics.service.js:791-800 (`sent` = all recipient rows with sentAt incl. FAILED/SKIPPED-with-sentAt), :802-806 (`replied` = every conversation with *any* inbound message in the range, not campaign replies), :840-848 (any non-OPEN conversation with no human outbound message counted as "resolved by AI", including conversations with zero outbound messages) |
| Description | The funnel stages Sent -> Delivered -> Read -> Replied -> AI chat mix campaign recipients with organic inbox traffic, so "Replied" can exceed "Delivered". "Resolved by AI" is really "closed without a human reply". |
| Steps to reproduce / Evidence | Static code trace at the cited Location lines; the trace is written out in the Description. |
| Expected |  |
| Actual |  |
| Impact |  |
| Suggested fix | Restrict `replied` to `campaignRecipientId != null`; count AI resolution from `campaignAiSession`/bot messages. |
| Effort | S |
| Related IDs |  |
| Audit working IDs | F-core-019 |

### CF-128

**Google OAuth `state` is signed but not bound to the initiating browser (login CSRF), is signed with `JWT_ACCESS_SECRET`, and exposes the invite token in cleartext**

| Field | Value |
|---|---|
| Module | Auth / Google OAuth |
| Area | Backend |
| Status | SECURITY |
| Severity | Low |
| Confidence | Confirmed |
| Location | backend/src/lib/oauthState.js:9-28, backend/src/routes/auth.routes.js:146-167,169-232, backend/src/controllers/auth.controller.js:60-75 |
| Description | `signState({ n, ts, inviteToken })` is a stateless HMAC token, and no cookie or nonce ties it to the browser. Anyone can call `GET /api/v1/auth/google`, complete Google sign-in as themselves, stop before the callback, and send a victim the `/auth/google/callback?code=...&state=...` URL. The state verifies (10-minute TTL, line 23), so the victim's browser finishes a sign-in to the attacker's account (classic login CSRF). The victim may then connect WhatsApp numbers or upload data into the attacker's workspace. The code comment ("binds the callback to the browser that initiated the flow", oauthState.js:4-5; auth.routes.js:141-142) overstates what the code does. The same HMAC key (`JWT_ACCESS_SECRET`) signs states and access tokens. Payloads are not interchangeable (different formats), but this is key reuse. The state payload is base64url JSON and not encrypted, so the invite token travels readably through Google's redirect and into request logs (CF-100). |
| Steps to reproduce / Evidence | `verifyState` checks only the HMAC and `ts`. auth.routes.js never reads or sets a cookie. |
| Expected | An httpOnly, SameSite=Lax cookie holding the nonce `n`, compared in the callback. A dedicated `OAUTH_STATE_SECRET` (or HKDF of the access secret). The invite token kept server-side (Redis keyed by `n`) rather than in the state. |
| Actual | Replayable-by-anyone state within 10 minutes. |
| Impact | Login CSRF, and invite token exposure. |
| Suggested fix | Set a `g_oauth_nonce` cookie in `/google` and require `payload.n === cookie` in the callback. Apply the same pattern to the Meta and Instagram states, which already carry `userId` and so are less exposed. |
| Effort | S |
| Related IDs | CF-100 |
| Audit working IDs | F-A1-013 |

### CF-129

**Account enumeration through the forgot-password cooldown (429 only for real accounts) and through bcrypt timing on login and signup**

| Field | Value |
|---|---|
| Module | Auth / Login, Signup, Password reset |
| Area | Backend |
| Status | SECURITY |
| Severity | Low |
| Confidence | Confirmed |
| Location | backend/src/services/auth.service.js:530-541 (forgot-password), 105-119 (login), 371-385,410 (signup) |
| Description | (a) `startPasswordReset` returns the generic message immediately when the email is unknown (line 534). For a real account it first checks the 60 s resend cooldown and throws **429 "A code was just sent"** (lines 536-540). Two `POST /auth/forgot-password` calls one second apart return 200/200 for an unknown address and 200/429 for a real one, which reveals the account unambiguously. (b) `login` returns 401 without running bcrypt when the user does not exist or has no password (Google-only accounts), but runs a cost-12 `bcrypt.compare` otherwise. The latency difference is roughly 150-300 ms. (c) `startSignup` claims "the same latency as one that does not" (lines 374-376), but only the new-account path runs `bcrypt.hash` (line 410) and the existing-account path returns after sending mail. The latencies differ, although mail delivery time adds noise. |
| Steps to reproduce / Evidence | As above. The per-email subject limiter (5 per 15 min) slows this down but does not stop it. |
| Expected | Apply the cooldown uniformly (check it before the user lookup, keyed on the normalised email); run a dummy `bcrypt.compare` against a fixed hash when the user is missing; hash the password on both signup branches. |
| Actual | Distinguishable responses. |
| Impact | Lets an attacker confirm which email addresses have accounts (useful for phishing and credential stuffing). |
| Suggested fix | As above. |
| Effort | S |
| Related IDs | CF-027 |
| Audit working IDs | F-A1-017 |

### CF-130

**Rate-limiter memory fallback and OAuth code exchange — minor races**

| Field | Value |
|---|---|
| Module | Auth / Rate limiting |
| Area | Backend |
| Status | SECURITY |
| Severity | Low |
| Confidence | Confirmed |
| Location | backend/src/middleware/rateLimit.js:25-49, :68-80, :118-137; backend/src/controllers/auth.controller.js:58-69, :85-91 |
| Description | The fallback is correct in principle (Redis only when `status === 'ready'`, else an in-process Map pruned every 60 s). Caveats: (a) the memory buckets are per process, so with >1 instance and Redis down the effective limit multiplies; (b) `countFailuresOnly` limiters peek first and only count on `finish` (:119-136), so a burst of parallel wrong attempts all pass the peek before any failure is counted — a parallel brute-force burst exceeds `max` per window; (c) the one-time OAuth code is redeemed with `GET` then `DEL` (auth.controller.js:86-87), not atomically (`GETDEL`), so two concurrent exchanges of the same code can both succeed; the memory fallback map (:58-69) is per-process, so a code issued by instance A cannot be redeemed on instance B when Redis is down. |
| Steps to reproduce / Evidence | Static code trace at the cited Location lines; the trace is written out in the Description. |
| Expected | Atomic increment-before-check; `GETDEL`. |
| Actual | As described. |
| Impact | Weaker brute-force protection under parallel bursts; low. |
| Suggested fix | Increment first and decrement on success for failure-only limiters; use `redis.getdel`. |
| Effort | S |
| Related IDs |  |
| Audit working IDs | F-E-022 |

### CF-131

**Security-relevant workspace configuration writes have no role check beyond membership (CLIENT == ADMIN)**

| Field | Value |
|---|---|
| Module | Auth / Roles |
| Area | Backend |
| Status | SECURITY |
| Severity | Low |
| Confidence | Confirmed |
| Location | backend/src/routes/crmCustomization.routes.js:12-13, backend/src/authentication/authentication-config.routes.js:54-57, backend/src/routes/apikeys.routes.js, settings.routes.js, whatsapp.routes.js, templates.routes.js, segments.routes.js, whatsappForms.routes.js, workflow.routes.js, integrations.routes.js, widgets.routes.js, aiAgent.routes.js, aiAgents.routes.js, support.routes.js:10, clusters.routes.js, contacts.routes.js, conversations.routes.js, optout.routes.js |
| Description | `grep authorize( backend/src/routes` shows no guard in the listed files. A CLIENT can therefore create/revoke API keys, change webhook URL/events, connect/disconnect WhatsApp numbers, rewrite CRM customization (`PUT /crm-customization/:sectionKey`, `POST .../reset` — confirmed no `authorize`, controller passes body straight to `service.updateSection`), rewrite the OTP authentication config, deploy/undeploy the AI agent, and manage integrations. authorize.js:21-24 documents this as intended for CLIENT, so this is a design observation with the two lead-flagged endpoints confirmed open to CLIENT. |
| Steps to reproduce / Evidence | `PUT /api/v1/workspaces/W/crm-customization/lead_pipeline` as CLIENT → 200 (crmCustomization.routes.js:12). |
| Expected | Money/security-affecting configuration gated to ADMIN or an explicit decision recorded. |
| Actual | Any CLIENT can change them. |
| Impact | In-tenant config tampering by non-admin members; a member-created API key is a long-lived credential. |
| Suggested fix | `authorize('ADMIN')` on api-keys create/revoke, settings webhook fields, whatsapp connect/disconnect, crm-customization PUT/reset, authentication-config PATCH. |
| Effort | S |
| Related IDs | Lead 7 |
| Audit working IDs | F-A2-003 |

### CF-132

**`/auth/exchange` and `/auth/refresh` consume their single-use secret with a non-atomic read-then-delete**

| Field | Value |
|---|---|
| Module | Auth / Sessions |
| Area | Backend |
| Status | RELIABILITY |
| Severity | Low |
| Confidence | Confirmed |
| Location | backend/src/controllers/auth.controller.js:85-91, backend/src/services/auth.service.js:153-161 |
| Description | `exchangeOneTimeCode` does `redis.get(key)`, then `redis.del(key)`, as two round-trips. Two concurrent requests with the same code can both read it before either deletes, so both receive the same token pair. The in-memory fallback is synchronous and safe. `refresh()` does `findUnique({ token })`, then `delete({ where: { token } })`. The SPA single-flights refresh within one tab (frontend/src/lib/api.js:37) but not across tabs. When two tabs refresh at once, the loser's `delete` throws Prisma `P2025` with no `status`, so it gets a generic 500 instead of 401, and that tab shows "Could not refresh your session (500)" (api.js:67). |
| Steps to reproduce / Evidence | Fire two `POST /auth/refresh` calls with the same refresh token in parallel: one returns 200 and the other returns 500 `Something went wrong...`. |
| Expected | `GETDEL` (Redis 6.2+) for the code; `deleteMany({ where: { token } })` and check `count === 1` for the refresh token. |
| Actual | A race window, and a 500 on the losing request. |
| Impact | Minor: a duplicate token pair from one code, and spurious logouts when tabs race. |
| Suggested fix | As above; on the frontend, single-flight the refresh promise. |
| Effort | S |
| Related IDs | CF-042 |
| Audit working IDs | F-A1-015 |

### CF-133

**Access-token revocation fails open when Redis is unavailable, and there is no user-level disable**

| Field | Value |
|---|---|
| Module | Auth / Sessions |
| Area | Backend |
| Status | SECURITY |
| Severity | Low |
| Confidence | Confirmed |
| Location | backend/src/lib/tokenDenylist.js:37-45, backend/src/middleware/authenticate.js:22-24, backend/src/services/auth.service.js:105-141,143-187, backend/prisma/schema.prisma:134-135 (only `Workspace.suspended`; `User` has no suspended/disabled field) |
| Description | `isAccessTokenRevoked` returns `false` on any Redis error ("allowing token"), so a logged-out access token keeps working for up to 15 min whenever Redis is down. The same applies to `revokeAccessToken` (returns false, logout still 200). More significantly, there is no way to disable a user account: `login`, `refresh` and `authenticate` never check a user-level flag, and nothing revokes a user's refresh tokens except password reset (auth.service.js:586). A super admin can suspend a workspace, but a compromised user can still log in and hold a session for their other workspaces and for claim-scoped endpoints (CF-025). |
| Steps to reproduce / Evidence | As quoted. `grep suspended prisma/schema.prisma` shows only the Workspace model (lines 134-135). |
| Expected | Fail closed for revocation when Redis is down (or fall back to a short in-memory list). Add `User.disabledAt`, checked in login, refresh and authenticate. Add an admin "sign out everywhere" action. |
| Actual | Fail-open; no account disable. |
| Impact | Limited, but the incident-response toolkit is missing. |
| Suggested fix | As above. |
| Effort | M |
| Related IDs | CF-042, CF-032 |
| Audit working IDs | F-A1-016 |

### CF-134

**`pages/stepChange.test.mjs` tests a hand-copied `applyStepChange` that has drifted from the real one; no frontend test script**

| Field | Value |
|---|---|
| Module | Automation |
| Area | Frontend |
| Status | TECH-DEBT |
| Severity | Low |
| Confidence | Confirmed |
| Location | frontend/src/pages/stepChange.test.mjs:1-30, frontend/src/pages/AutomationView.jsx:1345-1371, frontend/package.json:9-13 |
| Description | The test holds its own copy of the function. The real one now handles `type:'condition'` (default `equals`, `skipIfFalse`) and defaults for buttons, wait_reply, template, contains, equals, is_new_contact, has_tag, field_equals, field_set; the copy has none. `node --test` passes 6/6, but only against the copy. |
| Steps to reproduce / Evidence | Local `node --test frontend/src/pages/stepChange.test.mjs` → 6 pass. |
| Expected | Function in a JSX-free module imported by both component and test. |
| Actual | False confidence; the condition path is untested. |
| Impact | Regressions in the workflow builder go unnoticed. |
| Suggested fix | Move to `src/lib/automationSteps.js`; add `"test": "node --test src"`. |
| Effort | S |
| Related IDs |  |
| Audit working IDs | F-H-020 |

### CF-135

**Two parallel AI workflow generators; `/workflows/compile` (+ `/vocabulary`) has no frontend caller**

| Field | Value |
|---|---|
| Module | Automation / Workflows |
| Area | Both |
| Status | TECH-DEBT |
| Severity | Low |
| Confidence | Confirmed |
| Location | backend/src/routes/workflow.routes.js:22-28 (`/vocabulary`, `/compile`), backend/src/services/workflowCompiler.service.js:235-270, backend/src/services/automation.service.js:414-521 (`generateWorkflowPreview`), frontend/src/pages/AutomationView.jsx:799 (only `/automation/workflows/ai-preview` is called; `grep -n "/compile\\|/vocabulary" AutomationView.jsx` returns nothing) |
| Description | `workflowCompiler.service` (validated graph, saved inactive, own TRIGGERS/ACTIONS/CONDITIONS vocab) is the safer generator but is unreachable from the UI; the UI uses `generateWorkflowPreview`, which has its own prompt and its own `fallbackWorkflowPreview` keyword template (:185) and whose result the UI saves with `isActive: true` (AutomationView.jsx:836). |
| Steps to reproduce / Evidence | Static code trace at the cited Location lines; the trace is written out in the Description. |
| Expected | One generator; drafts saved inactive. |
| Actual | Duplicate logic; AI drafts go live immediately. |
| Impact | Divergent behaviour; an AI-generated workflow with a broad keyword starts messaging customers on save. |
| Suggested fix | Point the UI at `/workflows/compile` (or merge) and default `isActive:false` for AI drafts. |
| Effort | M |
| Related IDs | Lead 13 |
| Audit working IDs | F-CAI-010 |

### CF-136

**`verifyPaymentSignature` uses `===` instead of `crypto.timingSafeEqual`**

| Field | Value |
|---|---|
| Module | Billing |
| Area | Backend |
| Status | SECURITY |
| Severity | Low |
| Confidence | Confirmed |
| Location | backend/src/lib/razorpay.js:29-34; backend/src/lib/razorpay.js:29-34, callers backend/src/services/wallet.service.js:236, backend/src/services/subscription.service.js:268, backend/src/services/addons.service.js:76 |
| Description | HMAC comparison is a plain string equality; a timing side channel is theoretical over the network but trivially fixed. Also throws a raw TypeError if `RAZORPAY_KEY_SECRET` is unset (createHmac with undefined key) instead of the 503 that `getRazorpayClient` raises — verify is called before `getRazorpayClient` in all three verify functions. |
| Steps to reproduce / Evidence | Static code trace at the cited Location lines; the trace is written out in the Description. |
| Expected | `timingSafeEqual` on equal-length buffers; explicit 503 when unconfigured. |
| Actual | `expected === signature`. |
| Impact | Low. |
| Suggested fix | Compare with `timingSafeEqual`; guard missing secret. |
| Effort | S |
| Related IDs | CF-009 |
| Audit working IDs | F-B-017, F-A1-018 |

### CF-137

**PAST_DUE workspaces keep sending on wallet overage; EXPIRED block exempts wallet/subscription only by baseUrl suffix**

| Field | Value |
|---|---|
| Module | Billing |
| Area | Backend |
| Status | TECH-DEBT |
| Severity | Low |
| Confidence | Confirmed |
| Location | backend/src/services/subscription.service.js:62, backend/src/middleware/workspaceContext.js:318-324 |
| Description | By design PAST_DUE still consumes quota/wallet. The EXPIRED/CANCELLED block is matched via `req.baseUrl.endsWith('/subscription'\|'/wallet')`; the public API and webhook-triggered automations do not pass through `workspaceContext` at all, so an EXPIRED workspace still auto-replies and sends via API key (see CF-002). Sequences and workflow workers also never consult subscription status. |
| Steps to reproduce / Evidence | Static code trace at the cited Location lines; the trace is written out in the Description. |
| Expected | Status enforced at the send helper, not only at the HTTP layer. |
| Actual | HTTP-only. |
| Impact | Expired workspaces keep generating Meta charges. |
| Suggested fix | Check `subscription.status` inside the shared metered-send helper. |
| Effort | S |
| Related IDs | CF-002, CF-007 |
| Audit working IDs | F-B-022 |

### CF-138

**`consumeMessageCredit` opens an interactive transaction per message with a 30s timeout**

| Field | Value |
|---|---|
| Module | Billing |
| Area | Backend |
| Status | PERF |
| Severity | Low |
| Confidence | Likely |
| Location | backend/src/services/subscription.service.js:52-106, backend/src/workers/campaign.worker.js:451 |
| Description | Each campaign recipient runs a 4–6 statement interactive transaction (subscription fetch, counter upsert, conditional update, re-read) even when `prepaid: true`. With `CAMPAIGN_WORKER_CONCURRENCY` > 1 and the `FOR UPDATE` wallet lock only in the overage branch this is acceptable, but at 10k recipients it is ~50k extra round trips on a remote pooled Postgres. |
| Steps to reproduce / Evidence | Static code trace at the cited Location lines; the trace is written out in the Description. |
| Expected | Batch quota increment per campaign or a single `updateMany` for prepaid sends. |
| Actual | Per-message transaction. |
| Impact | Throughput. |
| Suggested fix | Short-circuit prepaid sends to one `updateMany` increment. |
| Effort | S |
| Related IDs |  |
| Audit working IDs | F-B-023 |

### CF-139

**`Invoice.amount` is Float with default currency "USD"; all other money is Decimal and INR**

| Field | Value |
|---|---|
| Module | Billing / Data model |
| Area | Backend |
| Status | DATA |
| Severity | Low |
| Confidence | Confirmed |
| Location | backend/prisma/schema.prisma:883-884 |
| Description | Invoice has `amount Float` and `currency String @default("USD")`. `Workspace.walletBalance` (:137), `WalletTransaction.amount` (:1082) and `Plan.priceMonthly` (:1223) are Decimal, and the plan catalog is INR (server.js:59). Any invoice created without an explicit currency is recorded as USD, and totals carry float rounding. |
| Steps to reproduce / Evidence | Static code trace at the cited Location lines; the trace is written out in the Description. |
| Expected |  |
| Actual |  |
| Impact |  |
| Suggested fix | `Decimal(12,2)` with default `INR`. |
| Effort | S |
| Related IDs |  |
| Audit working IDs | F-F-006 |

### CF-140

**`react-is@^19.2.7` alongside React 18.3.1; esbuild in dev-server advisory range; dependency audit inconclusive offline**

| Field | Value |
|---|---|
| Module | Build / Dependencies |
| Area | Frontend |
| Status | TECH-DEBT |
| Severity | Low |
| Confidence | Likely |
| Location | frontend/package.json:15-17, frontend/package-lock.json; frontend/package.json:17, frontend/package-lock.json (`node_modules/react-is` 19.2.7, `node_modules/recharts` 3.8.1 with peer `react-is` `^16.8 \|\| ... \|\| ^19`), consumers frontend/src/components/dashboard/ChatAnalytics.jsx, frontend/src/pages/CrmDashboardView.jsx |
| Description | react-is 19 detects elements via `Symbol.for('react.transitional.element')` while React 18 creates `react.element`, so `isFragment()`/`isElement()` return false for React 18 elements (fragment children in Recharts wouldn't flatten). Only ChatAnalytics and CrmDashboardView use Recharts and no fragments were found in chart children, so it is latent. esbuild 0.21.5 is in the known dev-server CORS advisory range (<=0.24.2), dev only. `npm audit --offline` printed "0 vulnerabilities" but has no advisory data. |
| Steps to reproduce / Evidence | Lockfile versions: react 18.3.1, react-is 19.2.7, recharts 3.8.1, vite 5.4.21, esbuild 0.21.5. |
| Expected | Matching react-is; online audit in CI. |
| Actual | Mismatch; unverified advisories. |
| Impact | Latent chart bug; dev-server exposure. |
| Suggested fix | Pin `react-is` to `^18.3.1`; run `npm audit` online in CI; bump Vite to a release shipping esbuild ≥0.25. |
| Effort | S |
| Related IDs |  |
| Audit working IDs | F-H-032, F-A1-025 |

### CF-141

**Campaign settlement can refund before late retries finish (refundedAt is one-shot)**

| Field | Value |
|---|---|
| Module | Campaign billing |
| Area | Backend |
| Status | RELIABILITY |
| Severity | Low |
| Confidence | Likely |
| Location | backend/src/services/campaigns.service.js:815-845,1096-1120, backend/src/services/retry.service.js:56-66, backend/src/workers/campaign.worker.js:145-148 |
| Description | `settleCampaignRefund` sets `refundedAt` once. Cancel (:1076) refunds `paidFor − billedCount` immediately while retry jobs may still be in the delayed queue; the retry path skips CANCELLED campaigns (worker :145) so no double-send — fine. But for AUTHENTICATION campaigns the retry guard is `status !== 'RUNNING'`, and `checkAndCompleteCampaign` only counts PENDING/RETRYING, so ordering is safe. Residual risk: a manual status edit or a recipient stuck in SENDING (paused/crashed mid-loop, later reset to PENDING) after a refund would be sent without reservation coverage — `prepaid: true` still bypasses the wallet (`subscription.service.js:91`), so the platform eats the cost. No money is double-refunded thanks to the `campaign_refund_<id>` key. |
| Steps to reproduce / Evidence | Static code trace at the cited Location lines; the trace is written out in the Description. |
| Expected | Settlement only in terminal states with no in-flight recipients. |
| Actual | Mostly guarded. |
| Impact | Low. |
| Suggested fix | In `settleCampaignRefund`, refuse if any recipient is SENDING/RETRYING/PENDING unless status is CANCELLED/FAILED. |
| Effort | S |
| Related IDs |  |
| Audit working IDs | F-B-021 |

### CF-142

**Campaign advanced-config blobs accepted as `z.any()` with `.passthrough()`**

| Field | Value |
|---|---|
| Module | Campaigns |
| Area | Backend |
| Status | DATA |
| Severity | Low |
| Confidence | Confirmed |
| Location | backend/src/validators/index.js:101-112, :117-131 |
| Description | `replyRules`, `retryConfig`, `trackingConfig`, `fallbackConfig` are `z.any()` and the object is `.passthrough()`, so arbitrary JSON of any size is written to the Campaign row (retryConfig is normalised by lib/retry.js, the others are stored verbatim). Unknown top-level keys are also forwarded but ignored by the service. |
| Steps to reproduce / Evidence | Static code trace at the cited Location lines; the trace is written out in the Description. |
| Expected |  |
| Actual |  |
| Impact |  |
| Suggested fix | Explicit sub-schemas with size limits. |
| Effort | S |
| Related IDs |  |
| Audit working IDs | F-core-007 |

### CF-143

**Wizard "Select Segment" audience tab is hard-disabled; pause/resume hidden for non-OTP campaigns**

| Field | Value |
|---|---|
| Module | Campaigns |
| Area | Frontend |
| Status | PARTIAL |
| Severity | Low |
| Confidence | Confirmed |
| Location | frontend/src/pages/CreateCampaign.jsx:478 (`{ id: 'segment', label: 'Select Segment', disabled: true }`); frontend/src/pages/Dashboard.jsx:1098-1101 |
| Description | (a) Segment-based audiences are shown as a tab but disabled, even though `/segments/:id/contacts` exists and ContactDetailsPanel uses it. (b) `pausable`/`resumable` in CampaignDetailModal are gated on `template.category === 'AUTHENTICATION'`; backend `pauseCampaign`/`resumeCampaign` accept any campaign (campaigns.service.js:1004-1054), so regular campaigns cannot be paused from the UI (routes `PATCH /campaigns/:id/pause\|resume` appear in contract-diff (c) only because the UI builds the path dynamically). |
| Steps to reproduce / Evidence | Static code trace at the cited Location lines; the trace is written out in the Description. |
| Expected |  |
| Actual |  |
| Impact |  |
| Suggested fix | Enable the segment tab (fetch `/segments/:id/contacts`), show Pause for RUNNING/SCHEDULED regardless of category. |
| Effort | S |
| Related IDs |  |
| Audit working IDs | F-core-008 |

### CF-144

**No campaign report export / recipients export endpoint**

| Field | Value |
|---|---|
| Module | Campaigns |
| Area | Both |
| Status | MISSING |
| Severity | Low |
| Confidence | Confirmed |
| Location | backend/src/routes/campaigns.routes.js (no export route); frontend/src/pages/Dashboard.jsx:1043-1312 (detail modal has no export button); docs/QA-TESTING-GUIDE.md (see Docs section) |
| Description | The campaign detail modal shows at most 100 recipients (`take: 100`, campaigns.service.js:844) and there is no CSV/report download; `wDownload` is only used for contacts/blocked numbers/crm-data. |
| Steps to reproduce / Evidence | Static code trace at the cited Location lines; the trace is written out in the Description. |
| Expected |  |
| Actual |  |
| Impact |  |
| Suggested fix | Add `GET /campaigns/:id/export` streaming recipients with status/failReason. |
| Effort | S |
| Related IDs |  |
| Audit working IDs | F-core-009 |

### CF-145

**OTP campaigns cannot be created from the campaign wizard although the campaign list has an "Authentication" type**

| Field | Value |
|---|---|
| Module | Campaigns / Authentication |
| Area | Frontend |
| Status | PARTIAL |
| Severity | Low |
| Confidence | Confirmed |
| Location | frontend/src/pages/CreateCampaign.jsx:1554 (`t.category !== 'AUTHENTICATION'` filter); backend/src/controllers/campaigns.controller.js:5-7 (`type=authentication` list filter); frontend/src/pages/Dashboard.jsx:1323 (`/campaigns?type=${campaignType}`) |
| Description | The list supports `type=authentication` and the detail modal renders an OTP report, but the only way to create an AUTHENTICATION-template campaign is the public API / onboarding chat, since the wizard hides AUTHENTICATION templates. The "New Campaign" button is hidden on the authentication tab (Dashboard.jsx:1380). Consistent, but the tab is effectively read-only and undocumented as such. |
| Steps to reproduce / Evidence | Static code trace at the cited Location lines; the trace is written out in the Description. |
| Expected |  |
| Actual |  |
| Impact |  |
| Suggested fix | Add an Authentication (OTP) campaign type to the wizard, or remove that type from the campaign list filter. |
| Effort | S |
| Related IDs |  |
| Audit working IDs | F-core-024 |

### CF-146

**FAILED status overrides READ; late `delivered`/`read` overrides a RETRYING/FAILED recipient**

| Field | Value |
|---|---|
| Module | Campaigns / Inbox |
| Area | Backend |
| Status | DATA |
| Severity | Low |
| Confidence | Confirmed |
| Location | backend/src/services/webhook.service.js:956-958, :996-1000, :1008-1011 |
| Description | A stale or redelivered `failed` after `read` moves the message row backwards to FAILED. Recipient updates are guarded only by `deliveredAt`/`readAt` null checks and set `status` unconditionally, so a recipient already moved to RETRYING/FAILED by an earlier attempt's `failed` is flipped to DELIVERED/READ by a late receipt for that earlier message; counters diverge until `reconcileCampaignCounters` at completion — which may never come (CF-057). |
| Steps to reproduce / Evidence | Static code trace at the cited Location lines; the trace is written out in the Description. |
| Expected | monotonic states vs. overwrite. |
| Actual |  |
| Impact | Wrong campaign report figures. |
| Suggested fix | Treat READ as terminal for messages; scope recipient updates to `status in (SENT, DELIVERED)`. |
| Effort | S |
| Related IDs | CF-057 |
| Audit working IDs | F-D-011 |

### CF-147

**Retry recovery gaps — boot-only, excludes PAUSED campaigns**

| Field | Value |
|---|---|
| Module | Campaigns / Retry |
| Area | Backend |
| Status | RELIABILITY |
| Severity | Low |
| Confidence | Confirmed |
| Location | backend/src/services/retry.service.js:127-170; backend/src/server.js:342-347; backend/src/services/campaigns.service.js:1034-1038 |
| Description | `recoverPendingRetries` runs only at boot and only for campaigns `RUNNING\|SCHEDULED` (:131). A retry job lost while the process stays up (Redis flush without app restart) is never re-queued. RETRYING rows of a PAUSED campaign are excluded; on resume only PENDING rows are counted (:1034) and nothing re-enqueues RETRYING rows, so after a restart those recipients are never retried and — because `checkAndCompleteCampaign` counts RETRYING as pending (retry.service.js:57-62) — the campaign cannot complete. `handleRecipientFailure` sets RETRYING before `campaignQueue.add` (:287-310); if the add throws, the row is RETRYING without a job until the next boot. |
| Steps to reproduce / Evidence | Static code trace at the cited Location lines; the trace is written out in the Description. |
| Expected | Periodic DB sweep for `RETRYING AND nextRetryAt < now() - grace` across all non-terminal campaigns. |
| Actual | Boot-only, partial. |
| Impact | Stuck campaigns in edge cases. |
| Suggested fix | Turn recovery into a repeat job; include PAUSED on resume. |
| Effort | S |
| Related IDs | CF-057, CF-058 |
| Audit working IDs | F-E-019 |

### CF-148

**Dangerous or misleading defaults in env.js**

| Field | Value |
|---|---|
| Module | Config |
| Area | Backend |
| Status | RELIABILITY |
| Severity | Low |
| Confidence | Confirmed |
| Location | backend/src/config/env.js:7,8,23,160,176 |
| Description |  - `NODE_ENV` defaults to `development`. If a host (e.g. the PM2 ecosystem on the VPS) forgets to set it, then: - boot migrations are skipped (server.js:221), - Redis failure no longer exits (server.js:284) and Redis gives up reconnecting immediately (lib/redis.js:62), - errorHandler returns `detail: err.message` for 500s (middleware/errorHandler.js:64), leaking Prisma and internal messages to clients, - Prisma logs warnings. - `CLIENT_URL` defaults to `http://localhost:5173`. If it is unset in production, CORS allows only localhost and email links point at localhost. - `APP_URL` is optional and falls back to `http://localhost:${PORT}` (env.js:176). That fallback builds `GOOGLE_CALLBACK_URL`, `META_REDIRECT_URI`, `INSTAGRAM_REDIRECT_URI` and the Twilio signature URL, so a missing APP_URL silently breaks OAuth and Twilio signature validation. render.yaml marks it `sync: false`, but it isn't required. - `REDIS_URL` defaults to localhost. |
| Steps to reproduce / Evidence | Static code trace at the cited Location lines; the trace is written out in the Description. |
| Expected |  |
| Actual |  |
| Impact |  |
| Suggested fix | Require `APP_URL`/`CLIENT_URL` when `NODE_ENV=production`. Refuse to boot with NODE_ENV unset unless `ALLOW_DEV=1`, or default it to `production`. |
| Effort | S |
| Related IDs |  |
| Audit working IDs | F-I-004 |

### CF-149

**DB-backed platform-credential overrides are per-process and loaded once, so instances silently disagree**

| Field | Value |
|---|---|
| Module | Config / Platform settings |
| Area | Backend |
| Status | RELIABILITY |
| Severity | Low |
| Confidence | Likely |
| Location | backend/src/config/settingsStore.js:14-64, backend/src/services/platformSettings.service.js:19-38,85-130, backend/src/server.js:256 |
| Description | 17 keys can be overridden from `SystemSetting` rows: Gemini/OpenAI keys, Meta app, WABA and system-user token, Twilio, SMTP, Razorpay key id and secret. The rows are AES-encrypted with ENCRYPTION_KEY and decrypted into an in-memory cache at boot (`loadPlatformSettings`). The cache is refreshed only in the process that serves the admin `updateSettings`. The other deployment (CF-020) and any second instance keep the old credentials until they restart. A row that cannot be decrypted (e.g. after ENCRYPTION_KEY rotation) falls back to env with only a console error (platformSettings.service.js:35). The allow-list design (DATABASE_URL, JWT and ENCRYPTION_KEY cannot be overridden) is sound. |
| Steps to reproduce / Evidence | Static code trace at the cited Location lines; the trace is written out in the Description. |
| Expected |  |
| Actual |  |
| Impact |  |
| Suggested fix | Poll SystemSetting.updatedAt (or use Redis pub/sub) to reload the cache, and surface decrypt failures on the admin screen. |
| Effort | S |
| Related IDs |  |
| Audit working IDs | F-I-005 |

### CF-150

**WhatsApp `connect-own`, `onboard` and `embedded-signup` are documented as admin-only but have no `authorize`**

| Field | Value |
|---|---|
| Module | Connect / Number setup |
| Area | Backend |
| Status | SECURITY |
| Severity | Low |
| Confidence | Confirmed |
| Location | backend/src/routes/whatsapp.routes.js:11-17 (no `authorize`), :33-37 (comment: "Connecting and onboarding a new number stay admin-only"), backend/src/controllers/whatsapp.controller.js:8-45 (no role check), backend/src/middleware/roleCapabilities.js:56-81 (blocks VIEWER/AGENT only) |
| Description | Any CLIENT member can provision a pool number (`POST /whatsapp/onboard`, billable per the comment), attach their own Meta credentials (`connect-own`, no Zod schema on the body) or complete Embedded Signup. Also `GET /whatsapp/numbers/pool` exposes the platform-wide pool listing to every member (`listPool()` takes no workspace argument, whatsapp.controller.js:13-16). |
| Steps to reproduce / Evidence | Static code trace at the cited Location lines; the trace is written out in the Description. |
| Expected | `authorize('ADMIN')` on the three provisioning routes + pool listing; Zod on `connect-own`. |
| Actual | Members can provision. |
| Impact | In-tenant escalation over billable resources; pool numbers (platform inventory) visible to all tenants' members. |
| Suggested fix | Add `authorize('ADMIN')`; scope/limit pool output. |
| Effort | S |
| Related IDs |  |
| Audit working IDs | F-CCON-005 |

### CF-151

**Settings → Security "Rate Limit Monitor" shows a fabricated 10,000/day limit**

| Field | Value |
|---|---|
| Module | Connect / Settings |
| Area | Frontend |
| Status | FAKE/STUB |
| Severity | Low |
| Confidence | Confirmed |
| Location | frontend/src/pages/SettingsView.jsx:180-187 (`sentToday / 10000`), :519-533 |
| Description | The gauge divides today's sent count by a hard-coded 10,000 and labels it "Daily Usage ... / 10,000" with "Connect your WhatsApp number to track live usage". Meta messaging tiers (250/1k/10k/100k/unlimited) are per-number and are available from the number health endpoint; the UI never reads them. Rest of Security tab is links only (password/sessions → Profile, BlockedNumbers component is real: optout.routes.js:13-18). |
| Steps to reproduce / Evidence | Static code trace at the cited Location lines; the trace is written out in the Description. |
| Expected | Real tier from Meta or remove the card. |
| Actual | Decorative number. |
| Impact | Misleading. |
| Suggested fix | Read `messaging_limit_tier` from `/whatsapp/numbers/:id/health` or drop the card. |
| Effort | S |
| Related IDs |  |
| Audit working IDs | F-CCON-004 |

### CF-152

**Cluster edit/delete and manual "block a number" have no UI**

| Field | Value |
|---|---|
| Module | Contacts / Blocked numbers |
| Area | Frontend |
| Status | MISSING |
| Severity | Low |
| Confidence | Confirmed |
| Location | backend/src/routes/clusters.routes.js:14-16 (PUT/PATCH/DELETE), backend/src/routes/optout.routes.js:16,18 (POST `/blocked-numbers`, DELETE `/:id`); frontend: no call to `/clusters/:id` with a write method (`grep -rn 'clusters/\${' frontend/src` -> only GET in CreateCampaign.jsx:434), BlockedNumbers.jsx only calls list/keywords/unblock/export |
| Description | Once created a cluster can only be viewed; a number can only be blocked by inbound STOP keyword or the contact `optedOut` flag, not from the Blocked Numbers screen. |
| Steps to reproduce / Evidence | Static code trace at the cited Location lines; the trace is written out in the Description. |
| Expected |  |
| Actual |  |
| Impact |  |
| Suggested fix | Add edit/delete actions to the cluster list and a manual 'Block number' form to Blocked Numbers, or remove the unused endpoints. |
| Effort | S |
| Related IDs |  |
| Audit working IDs | F-core-026 |

### CF-153

**N+1 loops on user-triggered paths**

| Field | Value |
|---|---|
| Module | CRM import / misc |
| Area | Backend |
| Status | PERF |
| Severity | Low |
| Confidence | Confirmed |
| Location | backend/src/services/crmImport.service.js:170-171, backend/src/services/sequences.service.js:164-193, backend/src/services/retry.service.js:140-145, backend/src/services/campaigns.service.js:1143-1150, backend/src/services/templates.service.js:132-134 |
| Description | The findmany.mjs heuristic ("await prisma inside for loop") flagged these and each was read. CRM CSV import runs `contact.findFirst` plus a create per row (crmImport.service.js:170), so a 10k-row import makes more than 20k sequential queries inside one HTTP request. Sequence bulk enrol creates rows one at a time (sequences.service.js:164). Boot recovery updates campaigns one by one (campaigns.service.js:1143). The rest (server.js plan upserts, admin number-pool imports) are small or admin-only. |
| Steps to reproduce / Evidence | Static code trace at the cited Location lines; the trace is written out in the Description. |
| Expected |  |
| Actual |  |
| Impact |  |
| Suggested fix | Import should prefetch existing phones with one `findMany({ where: { phoneNumber: { in } } })` and then `createMany({ skipDuplicates: true })`. Do the same for enrolments. |
| Effort | S |
| Related IDs |  |
| Audit working IDs | F-G-003 |

### CF-154

**Customize Your Business sections are only partly enforced: Document Categories is dead config, Lead Tags is UI-only, lifecycle/sources/prospecting apply only to manually created leads, outcome matching is fuzzy**

| Field | Value |
|---|---|
| Module | CRM-Customize (tabs not covered by CF-014/011) |
| Area | Both |
| Status | PARTIAL |
| Severity | Low |
| Confidence | Confirmed |
| Location | backend/src/services/crmCustomization.service.js:543-612 (deal_mode auto-task), :615-640 (`autoGenerateOutcomeTask`, `o.name?.toLowerCase()?.includes(outcome.toLowerCase())` at :627-629); consumers of `getSection`: leads.service.js:257, :315, :337, :449; tickets.service.js:116; frontend/src/pages/LeadsView.jsx:107, :481, :1166 (lead_tags); frontend/src/components/LogInteractionModal.jsx:42, :47; frontend/src/pages/CustomizeBusinessView.jsx:57-134 |
| Description | Per tab: (1) lead_lifecycle -- used by `createLead`/`updateLead` only; bypassed by public forms, import, campaign-reply leads, bulk-status (CF-158). (2) prospecting_criteria -- required phone/email/company enforced only in `createLead`/`updateLead`; public forms and import ignore it. (3) lead_sources -- validated only in `createLead` (:315); forms use `form.source \|\| 'Form: <name>'`, import uses the CSV value verbatim. (4) lead_tags -- consumed only by the LeadsView tag picker; the backend accepts any tag string (`leadSchemas.*.tags`), so the configured list is advisory. (5) deal_mode -- consumed on stage change (auto-task with duplicate-window guard); `defaultPriority` survives only as text in the task description (see CF-017). (6) call_outcomes / visit_outcomes -- consumed via LogInteractionModal -> activities.service.js:244; matching uses substring `includes`, so an outcome typed "No" triggers the follow-up of "Not interested" / "No answer" whichever is first. (7) ticket_customization -- stages used; `slaHours` ignored (CF-081). (8) document_categories -- defined only as a backend section default (crmCustomization.service.js:139) and accepted by GET/PUT; it is not one of the 9 tabs in CustomizeBusinessView.jsx:14-24 and has no consumer; there is no CRM documents feature, so it is dead configuration. (9) deal_setup / lead_lifecycle deletion and role issues are CF-014/011. |
| Steps to reproduce / Evidence | grep `document_categories` -> only crmCustomization.service.js:139 and its test. `PATCH /leads/:id {tags:['anything']}` -> 200 though not configured. |
| Expected | Each tab either enforced server-side on every entry path or labelled as a UI preset; decorative tab removed. |
| Actual | As described. |
| Impact | Admins believe rules are enforced when they are not. |
| Suggested fix | Centralise lead intake (createLead) and route forms/import/campaign leads through it; exact-match outcomes; remove or build Document Categories. |
| Effort | M |
| Related IDs | CF-014, CF-064, CF-081, CF-070, CF-069 |
| Audit working IDs | F-CRM-033 |

### CF-155

**Deal line items: no record-visibility scope, deleting the last line leaves a stale deal value, Decimal overflow 500s, inactive products and foreign-currency products accepted**

| Field | Value |
|---|---|
| Module | CRM-Deals / Line items / Products |
| Area | Backend |
| Status | PARTIAL |
| Severity | Low |
| Confidence | Confirmed |
| Location | backend/src/services/dealLineItems.service.js:7-34, :39-45, :47-50, :103-111; backend/src/validators/index.js:449-456, :807-808; backend/src/services/lineItems.js:12-40; backend/prisma/schema.prisma:1915-1921 (`subtotal/total Decimal(14,2)`), :2233 (`Deal.value Decimal(12,2)`); backend/src/services/products.service.js:62-77 |
| Description | Positive: totals are computed server-side only (lineItems.js, client cannot post totals), product lookups are workspace-scoped, line edits merge over stored values, and `syncDealValue` runs in the same transaction. Gaps: (a) `assertDeal` checks only `workspaceId`, not `scopeFilter`, so an OWN/TEAM-scoped CLIENT can list/add/edit/delete lines (and thereby rewrite `Deal.value`) on deals they cannot open. (b) `syncDealValue` returns early when no lines remain (:41), so deleting the last line leaves `Deal.value` at the old itemised total. (c) Zod allows `quantity <= 1e6` and `unitPrice <= 1e9` -> line total up to 1e15, but the column is `Decimal(14,2)` (max ~1e12) and `Deal.value` is `Decimal(12,2)` (max ~1e10): large but valid inputs throw a Prisma numeric-overflow 500. (d) `resolveLine` ignores `product.isActive` (a product "deleted" into deactivated state by products.service.js:70-72 can still be added) and ignores `product.currency` vs `deal.currency` (a USD product is summed into an INR deal). (e) `updateDeal` still lets a user hand-edit `value` on an itemised deal, contradicting the comment at :36-38. (f) `sortOrder = count` (:67) duplicates under concurrent adds (cosmetic). |
| Steps to reproduce / Evidence | Add one line (total 500) -> deal value 500 -> delete it -> deal value still 500. `POST /deals/:id/line-items {name:'x', quantity:1000000, unitPrice:1000000}` -> 500. |
| Expected | Scoped deal lookup; value reset to null/0 when lines are cleared; Zod bounds matching column precision; inactive and currency-mismatched products rejected. |
| Actual | As described. |
| Impact | Pipeline value wrong after item removal; in-tenant scope bypass; 500s. |
| Suggested fix | Pass `user` into the service and use `assertInScope`; set `value: null` when `lines.length === 0`; cap `quantity*unitPrice` <= 1e10; check `isActive` and currency. |
| Effort | S |
| Related IDs | CF-015, CF-079 |
| Audit working IDs | F-CRM-027 |

### CF-156

**CRM docs contradict the code in both directions (features listed "Not built" exist; features listed "Built/DONE" are broken or unenforced)**

| Field | Value |
|---|---|
| Module | CRM-Docs |
| Area | Docs |
| Status | DOCS |
| Severity | Low |
| Confidence | Confirmed |
| Location | docs/ADVANCED_CRM_EXISTING_FEATURES.md:47-88; docs/ADVANCED_CRM_GAP_ANALYSIS.md:12-23, :38-44, :75-82 |
| Description | EXISTING_FEATURES says "6-stage DealStage enum" (:51) and lists as MISSING ("Not built", :79-88) sequences, products, line items, quotes, CRM tickets, forecasting, saved views, custom fields, CRM customization admin, import/export, public lead forms, gamification, command palette, global search, next-best-action, relationship intelligence and deal health -- all of which now have routes, services and views. GAP_ANALYSIS, conversely, marks as Built/DONE: Saved views "7 tests" (broken over HTTP, CF-018); Custom fields "validated JSON values" (8 of 12 types cannot be created, CF-063); Teams "server-enforced on leads, deals and tasks" (bypassed by filtered lists, convert, task by-id, activities, analytics, line items: CF-015/021/022/004/029/027); "Lead -> Deal conversion atomic, re-conversion refused 409" (not under concurrency, CF-071); CRM tickets "stored SLA" (category SLA ignored, first response never stamped, CF-081); Workflow CRM triggers "Builder UI not extended -- API-configurable only" (:79) while AutomationView offers `lead_created`, `lead_status`, `deal_stage`, `score_above` triggers and CRM actions (AutomationView.jsx:1345-1357). Public forms "dedupe" (:80) is check-then-act (CF-070). |
| Steps to reproduce / Evidence | Compare the listed claims with the cited findings. |
| Expected | Docs reflect current state including known defects. |
| Actual | Stale and over-claiming. |
| Impact | Misleads reviewers/ops about what is shipped and safe. |
| Suggested fix | Regenerate a single status table from this audit; delete the obsolete "Not built" list. |
| Effort | S |
| Related IDs | CF-018, CF-063, CF-015, CF-071, CF-081 |
| Audit working IDs | F-CRM-034 |

### CF-157

**Gamification: XP is farmable despite the "reward outcomes" claim; four achievements can never unlock; leaderboard has no opt-in switch**

| Field | Value |
|---|---|
| Module | CRM-Gamification |
| Area | Backend |
| Status | PARTIAL |
| Severity | Low |
| Confidence | Confirmed |
| Location | backend/src/services/gamification.service.js:5-19, :33-40, :56-74, :193-199; backend/src/services/tasks.service.js:44-62, :93-97; backend/src/services/deals.service.js:208-214; backend/src/services/leads.service.js:469-473; backend/src/routes/gamification.routes.js:11-14; frontend/src/components/ProgressPanel.jsx |
| Description | Dedupe is per record id, so points are capped per record, but records are free to create: (a) `cleared_overdue` (5 XP) is earned by creating a task with a past `dueDate` (no lower bound in `taskSchemas.create`) and completing it, unlimited; (b) `won_deal` (50 XP) by creating a zero-value deal owned by self and moving it to Closed Won; (c) `qualified_lead` by creating a lead and setting QUALIFIED. Nothing checks record age, value, or actor. (d) Achievements `first_lead`, `first_deal`, `inbox_zero`, `ten_wins` are listed in `ACHIEVEMENTS` and shown locked in ProgressPanel, but no code calls `unlockAchievement` with those keys (only `first_qualified`, `first_win`). (e) The leaderboard comment says "Off unless asked for" but there is no workspace setting; any member can `GET /progress/leaderboard`. (f) XP is not reversed when a deal leaves CLOSED_WON or is deleted. |
| Steps to reproduce / Evidence | `POST /tasks {title:'x', dueDate:'2020-01-01'}` then `PATCH /tasks/:id {status:'COMPLETED'}` -> +5 XP; repeat. |
| Expected | Awards gated on genuine outcomes; achievements wired or removed; leaderboard toggle. |
| Actual | As described. |
| Impact | Gameable leaderboard; unreachable goals shown. No money impact. |
| Suggested fix | Require `task.createdAt < dueDate` for cleared_overdue; deal value > 0 and age > 1 day for won_deal; wire or delete the four achievements; add a workspace toggle. |
| Effort | S |
| Related IDs | CF-079 |
| Audit working IDs | F-CRM-023 |

### CF-158

**Lead bulk endpoints unvalidated; custom lifecycle statuses cannot be bulk-applied (500)**

| Field | Value |
|---|---|
| Module | CRM-Leads |
| Area | Backend |
| Status | PARTIAL |
| Severity | Low |
| Confidence | Confirmed |
| Location | backend/src/routes/leads.routes.js:17-21 (no `validate()`), backend/src/services/leads.service.js:585-645 |
| Description | `bulk-status` writes `data:{status}` directly -- a custom lifecycle key (single update maps to `customFields.statusKey`, 436-445) hits the Prisma enum and throws (500). `bulk-category` likewise. `bulk-assign` accepts any `ownerUserId` without membership check. `bulk-task` ignores `scopeFilter`. |
| Steps to reproduce / Evidence | `POST /leads/bulk-status {ids:[...], status:'MY_CUSTOM_STAGE'}` -> PrismaClientValidationError. LeadsView.jsx:1235 sends whatever the lifecycle dropdown holds. |
| Expected | Zod schemas; custom statuses handled like single update. |
| Actual | 500s / silent mis-assignment. |
| Impact | Bulk actions broken for custom-lifecycle workspaces. |
| Suggested fix | Add bulk schemas; reuse statusKey logic. |
| Effort | S |
| Related IDs | CF-074 |
| Audit working IDs | F-CRM-007 |

### CF-159

**LeadsView search fetches on every keystroke with no debounce or cancellation — results can arrive out of order**

| Field | Value |
|---|---|
| Module | CRM-Leads |
| Area | Frontend |
| Status | PERF |
| Severity | Low |
| Confidence | Likely |
| Location | frontend/src/pages/LeadsView.jsx:1182-1198,1287,1477 |
| Description | `search` is a dependency of `load`, and `useEffect(() => load(), [load])` fires per keystroke with no AbortController or sequence guard; a late "ab" response can overwrite "abc". ContactsView already debounces 300 ms (ContactsView.jsx:655). |
| Steps to reproduce / Evidence | Code trace above. |
| Expected | Debounce + abort. |
| Actual | N requests, possibly stale results. |
| Impact | Wrong list shown; extra load. |
| Suggested fix | Copy ContactsView's `debouncedSearch`; abort previous request. |
| Effort | S |
| Related IDs |  |
| Audit working IDs | F-H-027 |

### CF-160

**Quotes: concurrent creation collides on the number (500), no send/PDF/expiry automation despite SENT/EXPIRED states**

| Field | Value |
|---|---|
| Module | CRM-Quotes |
| Area | Both |
| Status | PARTIAL |
| Severity | Low |
| Confidence | Confirmed |
| Location | backend/src/services/quotes.service.js:25-35 (comment claims the transaction prevents duplicates; Prisma interactive transactions run READ COMMITTED so two concurrent `findFirst` see the same last number), schema.prisma Quote `@@unique([workspaceId, quoteNumber])` (turns the race into P2002 -> 500), :152-180 (SENT only stamps `sentAt`); frontend/src/pages/QuotesView.jsx (no PDF/print/share action). Same pattern for tickets (tickets.service.js:38-48). |
| Description | Numbering relies on `orderBy createdAt`; the unique index prevents duplicates but the loser gets an unhandled 500. "Send" delivers nothing; "Expired" is never applied automatically when `validUntil` passes. |
| Steps to reproduce / Evidence | two parallel `POST /quotes` -> one 500 `Unique constraint failed`. |
| Expected | Retry on P2002 / counter; expiry sweep; share mechanism. |
| Actual | As described. |
| Impact | Occasional failed creates; misleading lifecycle. |
| Suggested fix | Retry on P2002; cron to mark EXPIRED; document that "Sent" is manual. |
| Effort | S |
| Related IDs |  |
| Audit working IDs | F-CRM-019 |

### CF-161

**24 native `alert()`/`confirm()` calls for success, error and destructive confirmations**

| Field | Value |
|---|---|
| Module | CRM-SalesInbox / AI-Agents / Engagements / Campaigns / Numbers / SuperAdmin |
| Area | Frontend |
| Status | UX |
| Severity | Low |
| Confidence | Confirmed |
| Location | frontend/src/pages/AiAgentsView.jsx:177,180,192,216,244,274,281,288,363; frontend/src/pages/CrmSalesInboxView.jsx:545,547,564,571,602,631,633,656,700; frontend/src/pages/EngagementsView.jsx:216,247; frontend/src/pages/CreateCampaign.jsx:469; frontend/src/pages/NumberSetupView.jsx:336; frontend/src/pages/SuperAdminView.jsx:917,922 |
| Description | Blocking browser dialogs — including success messages ("Template message sent successfully!", "Successfully enrolled N lead(s)") and `confirm()` for deleting an AI agent and for impersonation — instead of the app's toast/inline patterns (e.g. CustomizeBusinessView toast at :174). |
| Steps to reproduce / Evidence | grep listing above. |
| Expected | Inline/toast feedback and a confirm Modal. |
| Actual | Native dialogs, inconsistent and unstyled. |
| Impact | UX inconsistency; blocks the main thread; not localisable. |
| Suggested fix | Replace with existing toast + a shared ConfirmModal. |
| Effort | M |
| Related IDs | CF-087 |
| Audit working IDs | F-H-012 |

### CF-162

**Sequence enrolment: concurrent enrol 500s mid-loop, segment enrol of >1000 leads fails, out-of-scope/foreign lead ids silently dropped, unenroll ignores the sequence id in the URL**

| Field | Value |
|---|---|
| Module | CRM-Sequences |
| Area | Both |
| Status | PARTIAL |
| Severity | Low |
| Confidence | Confirmed |
| Location | backend/src/services/sequences.service.js:124-190, :192-203; backend/src/validators/index.js:654-657 (`leadIds max(1000)`); backend/prisma/schema.prisma:1833 (`@@unique([sequenceId, contactId])`); frontend/src/pages/CrmSalesInboxView.jsx:609-633; backend/src/routes/sequences.routes.js:17-18 |
| Description | Positive: only PUBLISHED sequences enrol, steps are snapshotted per enrolment, opted-out contacts and `OptOut` numbers are skipped, the 1000 cap is enforced both in Zod and in the service. Gaps: (a) `existing` is read once (:150-153) then enrolments are created one by one (:164-184); a concurrent enrol of an overlapping set (double-click, or Sales Inbox + Sequences view) hits P2002 on `(sequenceId, contactId)` and the request 500s after having enrolled part of the list, with no report of which. (b) Sales Inbox "Enroll segment" posts every lead id of the reviewed audience (`enrollTarget.leadIds`) -> any segment over 1000 leads is a 400 from Zod with no chunking in the UI. (c) Lead ids not in the workspace are dropped silently (`leadRows` only contains matches, :132-135); `skipped` only reports missing contact ids. No record-visibility scope on the lead lookup. (d) `DELETE /sequences/:id/enrollments/:enrollmentId` calls `unenroll(workspaceId, enrollmentId)` without checking the enrolment belongs to `:id`. (e) The FE success alert says "enrolled N lead(s)" even when most were skipped. |
| Steps to reproduce / Evidence | Segment of 1,500 HOT leads -> Enroll in sequence -> "Sequence enrollment failed: ... Array must contain at most 1000 element(s)". |
| Expected | `createMany({skipDuplicates:true})` or per-row P2002 catch; UI chunks by 1000; skipped report includes unknown lead ids. |
| Actual | As described. |
| Impact | Partial enrolments, confusing errors on large segments. |
| Suggested fix | Use `createMany({ data, skipDuplicates: true })`; chunk in the UI; include `sequenceId` in the unenroll `where`. |
| Effort | S |
| Related IDs | CF-080 |
| Audit working IDs | F-CRM-028 |

### CF-163

**CRM tests call services directly or assert fabricated values, so they pass while the HTTP feature is broken**

| Field | Value |
|---|---|
| Module | CRM-Tests |
| Area | Backend |
| Status | TECH-DEBT |
| Severity | Low |
| Confidence | Confirmed |
| Location | backend/src/services/savedViews.service.test.js:38-62; backend/src/services/customFields.service.test.js:36-57, :100-178; backend/src/services/integrationHealth.service.test.js:47-70 (asserts `meta.status === 'HEALTHY'`, `apiVersion === 'v20.0'`); backend/src/services/crmPermissions.service.test.js:12-60 (tests unmounted middleware); backend/src/services/leadsDeals.transactions.test.js:62-78 (sequential 409 only); backend/src/services/leadScoring.service.test.js (pure function only); frontend/src/pages/stepChange.test.mjs |
| Description | (a) Saved views: service called with `'leads'`, which the route Zod enum rejects (CF-018). (b) Custom fields: DROPDOWN/MULTISELECT/URL/EMAIL/PHONE/USER covered at service level, all rejected by the route's 5-value enum (CF-063). (c) Integration health: the test locks in the hard-coded `HEALTHY` / `v20.0` values (CF-077), i.e. it asserts the fabrication. (d) CRM permissions: tests a middleware never mounted (CF-078). (e) Convert: only the sequential re-convert path is tested, not the concurrent one (CF-071). (f) No test covers `bulkCreateTask` (CF-017, 500 on every call) or record-visibility combined with status/stage filters (CF-015), task by-id scope (CF-079), or contact-limit enforcement on CRM paths (CF-016). (g) stepChange.test.mjs tests a stale copy (CF-180). The service-level tests that exist are otherwise reasonable (DB-backed, workspace-isolation cases in tasksActivities.isolation.test.js and search.scope.test.js). |
| Steps to reproduce / Evidence | as cited. |
| Expected | At least one supertest-level test per route that runs `validate()` + `authorize()`. |
| Actual | Service-only tests with divergent inputs. |
| Impact | False confidence; regressions ship. |
| Suggested fix | Add HTTP tests for saved views, custom fields, bulk task, filtered-scope lists, convert concurrency; rewrite the integration-health test after fixing CF-077. |
| Effort | M |
| Related IDs | CF-017, CF-018, CF-063, CF-077, CF-078, CF-180 |
| Audit working IDs | F-CRM-035 |

### CF-164

**Root-level schema, validator and service copies are merge scratch artefacts; backend/prisma/schema.prisma is canonical**

| Field | Value |
|---|---|
| Module | Data model / Repo hygiene |
| Area | Infra |
| Status | TECH-DEBT |
| Severity | Low |
| Confidence | Confirmed |
| Location | schema_master.prisma (54 models/14 enums), schema_crm.prisma (64/22), merge_prisma.py, val_master.js, val_crm.js, cfs_master.js, cfs_crm.js, MIGRATION_AUDIT.md |
| Description | `backend/prisma/schema.prisma` (82 models/27 enums) is the canonical schema. It is the only one read by `ensure-prisma-client.js`, `prisma-cli.js` and `prisma-schema-canonical.js`. The root-level files are leftovers: - The root `schema_*.prisma` files are old master-branch and CRM-branch snapshots. - `merge_prisma.py` is a block-level merger that was used once to combine them. - `val_*.js` are UTF-16LE copies of `backend/src/validators/index.js`, one per branch. - `cfs_*.js` are UTF-16LE copies of the custom-fields service, one per branch. - No import, script or CI step references any of them. `MIGRATION_AUDIT.md` is not about DB migrations. It is a 2026-08-12 UI-migration audit ("old React frontend -> Spandan design set"). Its lines 24-25 record that `.env` held real Meta/Twilio/Google/Gemini/OpenAI/JWT/encryption credentials; the file contains no values. |
| Steps to reproduce / Evidence | Static code trace at the cited Location lines; the trace is written out in the Description. |
| Expected |  |
| Actual |  |
| Impact |  |
| Suggested fix | Delete the root copies (they stay in history). Move MIGRATION_AUDIT.md to docs/ui-migration-audit.md. |
| Effort | S |
| Related IDs |  |
| Audit working IDs | F-F-010 |

### CF-165

**Build and runtime quirks in render-build.js, ensure-prisma-client.js, logger and uploads**

| Field | Value |
|---|---|
| Module | Deploy / Logging |
| Area | Infra |
| Status | RELIABILITY |
| Severity | Low |
| Confidence | Confirmed |
| Location | backend/scripts/render-build.js:104-140, backend/src/lib/logger.js:6-10, backend/src/app.js:137-147, DEPLOY.md:199-202 |
| Description |  - `render-build.js` skips the SPA build whenever `frontend/dist/index.html` exists. A Render build cache or a VPS redeploy can therefore ship a stale UI. deploy-vps.sh works around this with `rm -rf frontend/dist`; Render relies on a clean checkout. - The build runs as **postinstall**, so every `npm ci` with `RENDER=true` also runs a nested frontend `npm ci` and a Vite build. - `lib/logger.js` writes `backend/server_error.log` (gitignored via `*.log`) with 5 MB rotation. On Render that disk is ephemeral, and the file only captures uncaught exceptions and fatal startup errors. There is no structured logging or request-id logging; everything else is `console.*`. - Static assets are served with `maxAge: '1y'` for *every* file in dist (app.js:141), including non-hashed ones such as a favicon or manifest. - Uploads (multer) go to local disk, which is wiped on each deploy (DEPLOY.md:199-202). |
| Steps to reproduce / Evidence | Static code trace at the cited Location lines; the trace is written out in the Description. |
| Expected |  |
| Actual |  |
| Impact |  |
| Suggested fix | Key the SPA skip on the git SHA, apply the immutable cache only to `/assets/*`, and move to a JSON logger (pino) writing to stdout. |
| Effort | S |
| Related IDs |  |
| Audit working IDs | F-I-009 |

### CF-166

**QA guide instructs testers to pause a regular campaign from the UI, which is impossible**

| Field | Value |
|---|---|
| Module | Docs |
| Area | Docs |
| Status | DOCS |
| Severity | Low |
| Confidence | Confirmed |
| Location | docs/QA-TESTING-GUIDE.md:133 ("No pause" listed under *Fixed here*), :142 ("Pause mid-flight on a large audience"); frontend/src/pages/Dashboard.jsx:1099-1100 (Pause only when template category is AUTHENTICATION) |
| Description | The doc claims pause is fixed and testable; the UI only exposes Pause/Resume for OTP campaigns. `TEST_EVIDENCE.md` contains no inbox-pagination, campaign-pause or reply-rule evidence; `docs/TESTING_WALKTHROUGH.md` UTM claims refer to lead-form attribution (implemented), not campaign "Conversion Tracking" (not implemented, CF-054). |
| Steps to reproduce / Evidence | Static code trace at the cited Location lines; the trace is written out in the Description. |
| Expected |  |
| Actual |  |
| Impact |  |
| Suggested fix | Update the QA guide after pause/resume is fixed (see the campaign resume finding). |
| Effort |  |
| Related IDs | CF-143, CF-054 |
| Audit working IDs | F-core-029 |

### CF-167

**AGENT_ROADMAP.md and ADVANCED_CRM_GAP_ANALYSIS.md give the Copilot "11 read tools"; the code has 9 read + 5 write**

| Field | Value |
|---|---|
| Module | Docs / AI agent and Copilot |
| Area | Docs |
| Status | DOCS |
| Severity | Low |
| Confidence | Confirmed |
| Location | docs/AGENT_ROADMAP.md:6-7, docs/ADVANCED_CRM_GAP_ANALYSIS.md:115, docs/ADVANCED_CRM_GAP_ANALYSIS.md:70, backend/src/services/copilot.tools.js:55-136,147-257; backend/src/services/copilot.tools.js:52-266 (`kind: 'read'` x9, `kind: 'write'` x5), docs/ADVANCED_CRM_GAP_ANALYSIS.md:115, docs/AGENT_ROADMAP.md:7 |
| Description | The tool count is stale; the rest of the roadmap status matches the code. |
| Steps to reproduce / Evidence | `copilot.tools.js` defines 9 tools with `kind: 'read'` (lines 55,63,73,83,93,103,118,125,136; line 25 is a comment) and 5 with `kind: 'write'` (147,161,196,248,257). Both docs say "11 read tools" and never mention the write/proposal tools. Checked against the code, AGENT_ROADMAP's status is accurate: `backend/src/services/agent.tools.js:199-240` `ACTIONS` has exactly `schedule_followup` and `advance_contacted` ("2 autonomous actions"); the sweep in `backend/src/services/agent.service.js:118-147` covers stale deals and NEW leads only; Phase 2 items 2.10 (on/off switch) and 2.11 (queue UI) are still unbuilt (CF-046); item 5.1 (compiler UI) still has no caller (CF-135). ADVANCED_CRM_GAP_ANALYSIS.md:70 says the remaining UI gaps are "lead-form builder, ticket views", but `frontend/src/pages/Dashboard.jsx:33-34` lazy-loads `LeadFormsView` and `TicketsView`. |
| Expected | Counts and gap lists match the code. |
| Actual | Tool count and one gap line are stale. |
| Impact | Minor; misleads planning. |
| Suggested fix | Update the counts (or generate them from `READ_TOOLS`/`WRITE_TOOLS`, `copilot.tools.js:268-269`); strike the UI-gaps line. |
| Effort | S |
| Related IDs | CF-046, CF-135 |
| Audit working IDs | F-J-005, F-CAI-014 |

### CF-168

**Historical audit docs at the repo root (issue_sheet, STABILIZATION_REPORT*, BUGS*) claim "all 75 issues resolved" while several are regressed or were never fixed as described**

| Field | Value |
|---|---|
| Module | Docs / Audit history |
| Area | Docs |
| Status | DOCS |
| Severity | Low |
| Confidence | Confirmed |
| Location | issue_sheet.md:3-18, issue_sheet.md:104-106, issue_sheet.md:130, STABILIZATION_REPORT.md:3, README.md:323 |
| Description | `issue_sheet.md` states every issue is "Resolved / Addressed", and README section 11 tells readers to rely on these files. The cross-check above finds: BUG-031, BUG-032, BUG-059 regressed or never fixed as claimed (no `authorize('ADMIN')` on `templates.routes.js:29,34`, `whatsapp.routes.js:13,15,17`, `workflow.routes.js:17`); BUG-008 partially regressed (agent worker not closed, `backend/src/server.js:396-403`); BUG-025 and BUG-054 partial; V2-01 onboarding chat unreachable (CF-180); V2-05/V2-07/V3-04 partial. Several "Resolution" texts describe code that was never written: React Router `<BrowserRouter>` (BUG-037), Redis-validated OAuth state (BUG-029), `$queryRaw` analytics (BUG-021), auto-created workspace (BUG-027), Plus Jakarta/Syne fonts (BUG-052). The docs also tell operators to run `npx prisma migrate dev` (issue_sheet.md:148-153, STABILIZATION_REPORT.md:9, AI_FEATURES_REPORT.md:15), which can prompt to reset a shared or hosted database. MIGRATION_AUDIT.md:700 keeps these files "on purpose" as history, but none of them carries a "historical" banner. |
| Steps to reproduce / Evidence | section A-D rows above. |
| Expected | Old reports clearly marked historical, with one living issue list. |
| Actual | Old "all resolved" claims read as current status. |
| Impact | False assurance on role enforcement (in-tenant privilege), and a risky DB command. |
| Suggested fix | Add a banner to each; move them to `docs/history/`; keep one living tracker; remove the `migrate dev` instructions. |
| Effort | S |
| Related IDs | CF-131, CF-150, CF-180, CF-175 |
| Audit working IDs | F-J-010 |

### CF-169

**backend/README.md points at a missing `.env.example`, a non-existent `JWT_SECRET`, `migrate dev` on a history that cannot replay, and a one-worker architecture**

| Field | Value |
|---|---|
| Module | Docs / Backend README |
| Area | Docs |
| Status | DOCS |
| Severity | Low |
| Confidence | Confirmed |
| Location | backend/README.md:8-17, backend/README.md:28, backend/README.md:35-41, backend/README.md:60-78 |
| Description | The backend quick start does not work as written. |
| Steps to reproduce / Evidence | "See `.env.example` for all required variables" (backend/README.md:35) - no `.env.example` exists anywhere in the repo (`ls backend/.env.example` and root: not found). The variable table lists `JWT_SECRET` (backend/README.md:40); `backend/src/config/env.js:25-26` requires `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` (min 32) and has no `JWT_SECRET`; it also omits required `ADMIN_EMAIL`, `META_APP_ID`, `META_BUSINESS_ID`, `META_WABA_ID`, `META_SYSTEM_USER_ID`, `META_DISPLAY_NAME`, `META_WEBHOOK_VERIFY_TOKEN`, `GOOGLE_CLIENT_ID/SECRET` (`env.js:30-43,87-88`). It says `ENCRYPTION_KEY` is a 64-char hex string, but `backend/src/lib/encryption.js:7-13` also accepts 32 ASCII chars (render.yaml comment says the same). Step 3 `npm run db:migrate` = `prisma migrate dev` (`backend/package.json:19`) - on an empty database this fails because no migration creates the core tables (see CF-019; `docs/LOCAL_DEV_DATABASE.md:64-78` says to use `db push` instead). "Node.js 20+" (:28) vs engines `>=22 <23`. The architecture tree (:60-78) shows one queue and one worker; there are 6 queues in `backend/src/queues/` and 6 workers. |
| Expected | Copy-paste quick start produces a running backend. |
| Actual | Missing template file, wrong secret names, failing migration step. |
| Impact | New developer setup fails; env validation throws on boot. |
| Suggested fix | Commit a `backend/.env.example` generated from `env.js`, replace step 3 with `db push` (or fix the baseline), update the tree. |
| Effort | S |
| Related IDs | CF-019 |
| Audit working IDs | F-J-002 |

### CF-170

**TEST_EVIDENCE.md claims record-visibility is "enforced on the server, at every path" and that ticket SLA works; other auditors show bypasses**

| Field | Value |
|---|---|
| Module | Docs / CRM evidence |
| Area | Docs |
| Status | DOCS |
| Severity | Low |
| Confidence | Confirmed |
| Location | TEST_EVIDENCE.md:7, TEST_EVIDENCE.md:810-830, TEST_EVIDENCE.md:997-1016 |
| Description | The evidence is honest about what it tested, but its headings overclaim. "Enforced on the server, at every path" covers only list/get/update/delete on leads, deals and tasks. Scope is dropped when a status/stage filter is applied (CF-015), and sibling read surfaces (activities, search siblings, reports) bypass it (CF-079, CF-067, CF-076). "SLA is stored" is true for `dueAt`, but category `slaHours` is ignored, `firstRespondedAt` is never stamped, and there is no breach job (CF-081). The "264/264 passing" line (:7) is dated 2026-08-17 and does not match the current tree (see CF-222). DEF-001..013 fixes were not individually re-run here. |
| Steps to reproduce / Evidence | as cited. |
| Expected | Claims scoped to what was tested. |
| Actual | Overbroad headings. |
| Impact | False assurance on data-visibility controls. |
| Suggested fix | Re-word the headings, and link the open F-CRM findings. |
| Effort | S |
| Related IDs | CF-015, CF-079, CF-081, CF-222 |
| Audit working IDs | F-J-012 |

### CF-171

**No `.env.example`, stale README/Node-version docs, and engines pin vs local Node**

| Field | Value |
|---|---|
| Module | Docs / Deploy |
| Area | Docs |
| Status | DOCS |
| Severity | Low |
| Confidence | Confirmed |
| Location | README.md:13,70,116; backend/README.md:28,34; backend/package.json (`engines`); render.yaml:41-42; deploy-vps.sh:26; backend/package.json:6-8, frontend/package.json:6-8, README.md:13,70, render.yaml:41-42, deploy-vps.sh:12-16,26,72 |
| Description |  - `.env.example` is not tracked. `.gitignore` explicitly whitelists `!backend/.env.example`, and history shows it existed and was later deleted (commits 757dc81, 11bdd29 list a delete). backend/README.md:34 still says "See `.env.example`". README.md:116 admits there is none and has its own table, which still lists META_SYSTEM_USER_ID and META_DISPLAY_NAME as required (CF-059) and omits TRUST_PROXY_HOPS, API_PUBLIC_URL, SMTP_IP_FAMILY, WORKER_* and GEMINI_* models. - Node: `engines` is `>=22 <23`, render.yaml sets NODE_VERSION 22, and the VPS pins v22.23.2. README.md:13,70 and backend/README.md:28 say "Node.js 20+". The unit tests in this audit ran on local **Node v24.19.0**, outside the engines range; npm only warns because engine-strict is off. The `--experimental-test-module-mocks` flag behaves differently across 22 and 24 (otp_test_out.txt shows the `namedExports` deprecation on 24). - `npm start` does not load `.env` (DEPLOY.md:220-225). It relies on `dotenv/config` resolving `.env` from the **cwd**, so running from the repo root silently reads no backend env. |
| Steps to reproduce / Evidence | Static code trace at the cited Location lines; the trace is written out in the Description. |
| Expected |  |
| Actual |  |
| Impact |  |
| Suggested fix | Restore a values-free `backend/.env.example` generated from the zod schema, update README Node to 22, and add `.nvmrc`. |
| Effort | S |
| Related IDs |  |
| Audit working IDs | F-I-007, F-A1-020 |

### CF-172

**DEPLOY.md documents only Render, with service names and queue/worker lists that do not match render.yaml or the real production VPS**

| Field | Value |
|---|---|
| Module | Docs / Deploy |
| Area | Infra |
| Status | DOCS |
| Severity | Low |
| Confidence | Confirmed |
| Location | DEPLOY.md:1-25, DEPLOY.md:108-115, render.yaml (services `chatflow-redis`, `chatflow-pro`), deploy-vps.sh:3-27 |
| Description | DEPLOY.md calls the services `"spandan"` and `"spandan-redis"` (:8,:19); `render.yaml` declares `chatflow-pro` and `chatflow-redis`, so the doc's names never appear in the dashboard. It says Redis backs "campaign / email / billing queues" (:19), and the expected boot log (:112-115) shows 3 workers; there are 6 (`backend/src/server.js:303-313`). Production actually runs on a Hostinger VPS under PM2 via `deploy-vps.sh` (Node 22 by absolute path, system Node 18 for pm2, forced SPA rebuild), and neither DEPLOY.md nor README mentions it (`grep -n vps DEPLOY.md README.md` returns nothing). What matches: `render.yaml` `startCommand: npm run start:prod` = `prisma-cli.js migrate deploy && node src/server.js` (`backend/package.json:17`), `NODE_VERSION 22`, and JWT secrets `generateValue: true`, all as DEPLOY.md says. Note that `migrate deploy` on a fresh Render database will fail (CF-019). |
| Steps to reproduce / Evidence | as cited. |
| Expected | Deploy doc for the environment actually in use, with correct names. |
| Actual | Render-only doc with wrong names; the real prod path is documented only in a shell-script header. |
| Impact | An operator following DEPLOY.md provisions something unlike prod; a fresh Render deploy fails at migrate. |
| Suggested fix | Add a "Production (VPS)" section from the `deploy-vps.sh` header; fix names and worker list. |
| Effort | S |
| Related IDs | CF-019, CF-175 |
| Audit working IDs | F-J-008 |

### CF-173

**backend/docs/PUBLIC_API.md documents 9 of about 20 public endpoints, omits scopes, and claims text messages that the handler cannot send**

| Field | Value |
|---|---|
| Module | Docs / Public API |
| Area | Docs |
| Status | DOCS |
| Severity | Low |
| Confidence | Confirmed |
| Location | backend/docs/PUBLIC_API.md:5-17, backend/docs/PUBLIC_API.md:30-136, backend/src/routes/public.routes.js:33-78 |
| Description | The external API reference is incomplete and partly wrong. |
| Steps to reproduce / Evidence | The doc lists `POST /messages`, `GET/POST /templates`, `GET/POST /campaigns`, `POST /campaigns/:id/launch`, `GET/POST /contacts`, `POST /webhooks`. The router also exposes `GET /me` (:33), `GET /templates/:id` (:48), `GET /campaigns/:id` (:53), `POST` and `PUT /campaigns/:id/recipients` (:54-55), `PUT /contacts/:id` (:61), `GET /analytics/summary` (:64), `GET /wallet/balance` (:67), `GET /ai-agent/config` and `POST /ai-agent/query` (:70-71), `GET /automations` (:74). Every route is gated by `requireScope(...)` (for example `messages:send`, `templates:write`), but the doc never mentions scopes, so a key without the scope gets an unexplained 403 (the doc only describes 401). PUBLIC_API.md:36 says "Sends a template or text message", but the handler requires a `template` object and crashes without one (CF-026). No mention that sends are unmetered and not rate limited (CF-002/005, CF-002). The separate `/api/v1/authentication` OTP API has no documentation at all in the repo. |
| Expected | Complete reference with scopes, error codes and billing notes. |
| Actual | Partial and misleading. |
| Impact | Integrators hit 403s and 500s; the OTP product has no public docs. |
| Suggested fix | Generate the reference from `public.routes.js`; add a scope table and an Authentication API doc. |
| Effort | S |
| Related IDs | CF-026, CF-002, CF-102 |
| Audit working IDs | F-J-003 |

### CF-174

**QA-TESTING-GUIDE.md setup step "`prisma migrate deploy` - 11 are pending on a fresh database" cannot work, and it tells testers to pause regular campaigns**

| Field | Value |
|---|---|
| Module | Docs / QA |
| Area | Docs |
| Status | DOCS |
| Severity | Low |
| Confidence | Confirmed |
| Location | docs/QA-TESTING-GUIDE.md:20-21, docs/QA-TESTING-GUIDE.md:133 |
| Description | On a fresh database `migrate deploy` fails (no migration creates `Workspace`; see CF-019). `docs/LOCAL_DEV_DATABASE.md:64-78` says so explicitly and prescribes `db push`. The "11 pending" figure does not match the 20 migrations in `backend/prisma/migrations/`. The "No pause" fix row and manual checks imply regular campaigns can be paused from the UI; pause/resume is hidden for non-OTP campaigns (CF-143, CF-166). The suite scripts it lists all exist in `backend/scripts/` (auth-check, campaign-check, regression-check, messaging-check, ai-flow-check, addon-check, waba-check, template-payload-check); their assertion counts were not re-run (they need live Meta and spend money). |
| Steps to reproduce / Evidence | as cited; `ls backend/prisma/migrations` shows 20 directories starting at `20260810000000_site_knowledge_index`. |
| Expected | Setup that works on a fresh DB. |
| Actual | Step 2 fails for any new tester. |
| Impact | QA onboarding blocked; false bug reports. |
| Suggested fix | Replace with `node --env-file=.env scripts/assert-local-db.js && npx prisma db push` (as LOCAL_DEV_DATABASE.md does) until a baseline lands. |
| Effort | S |
| Related IDs | CF-019, CF-166, CF-143 |
| Audit working IDs | F-J-006 |

### CF-175

**Root README describes a much older product (2 workers, billing "not implemented", Instagram/Voice stubs, no CRM or OTP product, Node 20+)**

| Field | Value |
|---|---|
| Module | Docs / README |
| Area | Docs |
| Status | DOCS |
| Severity | Low |
| Confidence | Confirmed |
| Location | README.md:13, README.md:43, README.md:70, README.md:170-200, README.md:277-282, README.md:309-318, README.md:321-331, README.md:336-345, README.md:466-470; README.md:336-465 |
| Description | The main onboarding doc is out of date on most runtime facts. |
| Steps to reproduce / Evidence |  - Node: README.md:13 and :70 say "Node.js 20+", but `backend/package.json:6-7` and `frontend/package.json:6-7` require `"node": ">=22 <23"`; `render.yaml` sets `NODE_VERSION "22"`; `deploy-vps.sh:12-13` says "this project needs 22". - Workers: README.md:43 and :277-282 list only `campaign.worker.js` + `email.worker.js` ("Both workers are started from server.js"). `backend/src/server.js:303-313` starts 6 (campaign, email, billing, workflow, sequence, agent). - API surface: the table at README.md:172-199 lists 26 prefixes. `backend/src/routes/` has 65 route files; `backend/src/routes/index.js` also mounts `/oauth`, `/authentication`, `/public`, `/voice`, `/users`, `/notifications`, `/invitations`, `/forms`. None of the CRM routers are listed (leads, deals, tasks, activities, tickets, quotes, products, sequences, lead forms, forecast, custom fields, teams, saved views, crm-analytics, copilot, agent). There is no section on the CRM product or the Authentication/OTP API product. README.md:175 still advertises "Register (legacy single-step)", but `backend/src/routes/auth.routes.js:57` says "POST /register is deliberately gone". - Section 11 (README.md:321-331): "fallback channels explicitly unbuilt (Coming Soon)" - built (`backend/src/services/fallback.service.js`, `backend/src/workers/campaign.worker.js:12`). "Voice AI ... no telephony engine" - `backend/src/services/voice.service.js:62-171` + `backend/src/routes/voice.routes.js` (Twilio call flow). "Instagram is a stub (OAuth redirect only, no token exchange)" - `backend/src/services/instagram.service.js:75-106` does code-to-token and long-lived exchange. "WhatsApp Forms CRUD but no backend" - real per a verified no-issue note. - Section 12 (README.md:338): "Status: not yet implemented". Billing exists: `backend/src/routes/subscription.routes.js:10-21` (plans, pricing, Razorpay checkout/verify, add-ons), `backend/src/workers/billing.worker.js:12`, `backend/src/lib/razorpay.js`. Section 12.1 (README.md:345) also says roles are "ADMIN or CLIENT" only; there are four (ADMIN/CLIENT/AGENT/VIEWER, `backend/src/middleware/roleCapabilities.js:34-35`). Same as CF-175. - Section 10 (README.md:309-318) names only `tests-e2e*.mjs`; the real unit suite is `npm test` (39 tracked `*.test.js` files, `backend/package.json:14`), plus `test:otp` and `test:prisma-schema`. - Section 13 (README.md:468-470) says "MIT", but root `package.json:15` says `"license": "ISC"` and there is no LICENSE file. |
| Expected | README matches the code a new engineer will run. |
| Actual | About a dozen material mismatches; readers are told billing/Instagram/Voice do not exist and are sent to Node 20. |
| Impact | Onboarding engineers and auditors get the wrong picture of what is live (for example they may treat billing as unbuilt and miss the F-B-* money risks); Node 20 installs fail the engines check. |
| Suggested fix | Rewrite sections 1, 2, 5, 7, 10, 11 and 12 from the current route index and server.js; add CRM and Authentication-API sections; pick one licence and add a LICENSE file. |
| Effort | M |
| Related IDs | CF-167, CF-168 |
| Audit working IDs | F-J-001, F-B-016 |

### CF-176

**Email worker reports success when SMTP is not configured**

| Field | Value |
|---|---|
| Module | Email |
| Area | Backend |
| Status | RELIABILITY |
| Severity | Low |
| Confidence | Confirmed |
| Location | backend/src/lib/mailer.js:62-68; backend/src/workers/email.worker.js:7-11, :22; backend/src/queues/email.queue.js:6-8 |
| Description | Retries are sane (3 attempts, exponential 3 s). But queued emails call `sendMail` without `mustDeliver`, which returns `undefined` when SMTP env vars are missing, so the job completes and logs `[EmailWorker] Job … sent to <address>` for every invite/campaign email that was never sent. OTP emails are not affected: they bypass the queue via `sendOtpEmailNow` with `mustDeliver: true` (email.service.js:506-516) — which also means the DEGRADED START banner's "emails (incl. invites and OTPs)" (server.js:292-293) is inaccurate for OTPs. |
| Steps to reproduce / Evidence | Static code trace at the cited Location lines; the trace is written out in the Description. |
| Expected | Job fails (or is marked skipped) when mail is not configured. |
| Actual | False "sent" logs. |
| Impact | Misleading ops signal. |
| Suggested fix | Return a status from `sendMail` and log "skipped" in the worker; fix the banner text. |
| Effort | S |
| Related IDs |  |
| Audit working IDs | F-E-021 |

### CF-177

**The error handler's `detail: err.message` is gated only on `NODE_ENV`, which defaults to `development`; the VPS deploy path never sets it**

| Field | Value |
|---|---|
| Module | Error handling |
| Area | Both (Backend + Infra) |
| Status | SECURITY |
| Severity | Low |
| Confidence | Likely (render.yaml sets production; the VPS `.env` could not be inspected) |
| Location | backend/src/middleware/errorHandler.js:54-66, backend/src/config/env.js:7, render.yaml:43-44, deploy-vps.sh (no NODE_ENV), README.md:121 |
| Description | The 5xx path is otherwise well designed. Unexpected errors get a generic message plus an 8-char reference, and Prisma, TypeError and driver messages are hidden. ZodError, JWT and Multer errors are mapped to 400 or 401. Stacks are never sent to the client. But `...(env.NODE_ENV === 'production' ? {} : { detail: err.message })` sends the raw message whenever NODE_ENV is anything else, and env.js defaults it to `development`. render.yaml pins `production`. deploy-vps.sh and DEPLOY.md do not, so the VPS instance (chatflow.mannmate.com) depends on a hand-edited `.env`. If that `.env` omits NODE_ENV, Prisma messages (table and column names, constraint names, sometimes values) reach the browser. Deliberate 4xx errors always pass `err.message` and `err.details` (lines 70-73). That is by design, but any library error carrying a `status` (body-parser, passport) is echoed verbatim. |
| Steps to reproduce / Evidence | With NODE_ENV unset, trigger any unexpected Prisma error: the response includes `detail: "Invalid prisma.x.findUnique() invocation: ..."`. |
| Expected | Gate on an explicit `EXPOSE_ERROR_DETAIL=true` (default off), or refuse to boot with `APP_URL` https and `NODE_ENV!=production`. |
| Actual | Relies on NODE_ENV being set correctly. |
| Impact | Schema disclosure on a misconfigured host. |
| Suggested fix | As above, and add `NODE_ENV=production` to the VPS checklist in DEPLOY.md. |
| Effort | S |
| Related IDs | CF-027 |
| Audit working IDs | F-A1-019 |

### CF-178

**Sidebar role badge labels VIEWER and AGENT as "Member"**

| Field | Value |
|---|---|
| Module | Frontend-Shell |
| Area | Frontend |
| Status | UX |
| Severity | Low |
| Confidence | Confirmed |
| Location | frontend/src/pages/Dashboard.jsx:2723-2726; frontend/src/lib/permissions.js:24-29 (ROLE_LABELS exists but is not used here) |
| Description | `const planLabel = isSuperAdmin ? 'Super Admin' : isAdmin ? 'Admin' : 'Member';` — any non-ADMIN role is shown as "Member", the label backend and permissions.js reserve for CLIENT. Same `isAdmin = user?.role === 'ADMIN'` pattern at Dashboard.jsx:147 (profile menu) and :2995. |
| Steps to reproduce / Evidence | Dashboard.jsx:2726. |
| Expected | `ROLE_LABELS[user.role]`. |
| Actual | "Member" for VIEWER/AGENT. |
| Impact | Mislabelled role; user assumes member capabilities. |
| Suggested fix | `ROLE_LABELS[user.role] \|\| 'Member'`. |
| Effort | S |
| Related IDs | CF-089 |
| Audit working IDs | F-H-005 |

### CF-179

**App.jsx carries a fully commented-out copy of the previous router (186 lines)**

| Field | Value |
|---|---|
| Module | Frontend-Shell |
| Area | Frontend |
| Status | TECH-DEBT |
| Severity | Low |
| Confidence | Confirmed |
| Location | frontend/src/App.jsx:401-586 |
| Description | The entire previous `App`/`renderPage` implementation is left commented out below the live one. |
| Steps to reproduce / Evidence | App.jsx:401-586 all `//` prefixed. |
| Expected | Removed. |
| Actual | Present. |
| Impact | Reviewer confusion. |
| Suggested fix | Delete. |
| Effort | S |
| Related IDs | CF-191 |
| Audit working IDs | F-H-010 |

### CF-180

**Dead modules: `CrmDashboardWidgets`, `TemplateModuleTabs`, `lib/motion.js` never imported; `AIOnboardingCard` imported but never rendered**

| Field | Value |
|---|---|
| Module | Frontend-Shell |
| Area | Frontend |
| Status | TECH-DEBT |
| Severity | Low |
| Confidence | Confirmed |
| Location | frontend/src/components/CrmDashboardWidgets.jsx:6, frontend/src/components/TemplateModuleTabs.jsx:3, frontend/src/lib/motion.js:18-47, frontend/src/components/AIOnboardingCard.jsx, frontend/src/pages/Dashboard.jsx:21; frontend/src/pages/Dashboard.jsx:21 (import only; `grep -n AIOnboardingCard Dashboard.jsx` returns only the import), frontend/src/components/AIOnboardingCard.jsx:56 (`fetch('/api/v1/onboarding/chat')`), backend/src/routes/onboarding.routes.js:25, backend/src/controllers/onboarding.controller.js:192-415 |
| Description | A scan of all static and dynamic imports finds exactly these three orphans (plus `stepChange.test.mjs`, a test). `AIOnboardingCard` appears only in an import at Dashboard.jsx:21; Home has its own inline copy of the `/onboarding/chat` flow (Dashboard.jsx:782-789), so the card's raw fetch is dead code. |
| Steps to reproduce / Evidence | Import scan over `src`. |
| Expected | Removed or wired in. |
| Actual | Shipped dead code. |
| Impact | Bundle size, reviewer confusion. |
| Suggested fix | Delete the orphans and the unused import. |
| Effort | S |
| Related IDs | CF-088; Lead 19 |
| Audit working IDs | F-H-017, F-core-016, F-CRM-031, F-CAI-009 |

### CF-181

**`lib/format.js` and `lib/formatters.js` export conflicting `fmtDate` functions**

| Field | Value |
|---|---|
| Module | Frontend-Shell |
| Area | Frontend |
| Status | TECH-DEBT |
| Severity | Low |
| Confidence | Confirmed |
| Location | frontend/src/lib/format.js:35-36, frontend/src/lib/formatters.js:1 |
| Description | Same name, different output (date-only vs date+time). `formatters.js` used by Dashboard.jsx:10 and AuthenticationDashboard.jsx:13; `format.js` by CrmDashboardView, ForecastView, LeadFormsView, ProductsView, QuotesView, SequencesView. |
| Steps to reproduce / Evidence | Read of both modules. |
| Expected | One module exporting `fmtDate` and `fmtDateTime`. |
| Actual | Importing the wrong module silently changes output. |
| Impact | Inconsistent date display. |
| Suggested fix | Merge into `format.js`. |
| Effort | S |
| Related IDs | CF-180 |
| Audit working IDs | F-H-019 |

### CF-182

**`PROTECTED_PREFIXES` in api.js omits `/resources` — an expired session on the Resource Center lands on the marketing page instead of `/login`**

| Field | Value |
|---|---|
| Module | Frontend-Shell / API layer |
| Area | Frontend |
| Status | UX |
| Severity | Low |
| Confidence | Confirmed |
| Location | frontend/src/lib/api.js:3,17-20,86-92; frontend/src/App.jsx:374-384 |
| Description | `PROTECTED_PREFIXES = ['/dashboard','/setup']`. App.jsx treats `/resources*` as an authenticated route (guard at 205-214). When refresh fails on `/resources/...`, `logout()` -> `redirectTargetForDeadSession()` -> `'/'`: the user lands on the landing page with no "session expired" message and loses the deep link. Authenticated routes enumerated from App.jsx: `/dashboard*`, `/resources*`, `/setup`, plus session-dependent `/oauth/consent` and `/invite/accept`. |
| Steps to reproduce / Evidence | api.js:19. |
| Expected | `/resources` -> `/login` (ideally with a `next` param). |
| Actual | `/`. |
| Impact | Minor UX. |
| Suggested fix | Add `/resources` to PROTECTED_PREFIXES. |
| Effort | S |
| Related IDs | CF-088 |
| Audit working IDs | F-H-007 |

### CF-183

**Minimal code splitting — App imports every page eagerly and the Recharts chunk loads for every visitor**

| Field | Value |
|---|---|
| Module | Frontend-Shell / Build |
| Area | Frontend |
| Status | PERF |
| Severity | Low |
| Confidence | Likely |
| Location | frontend/src/App.jsx:2-14, frontend/src/pages/Dashboard.jsx:5-56,43, frontend/vite.config.js:13-22 |
| Description | Only 8 `lazy()` calls, all in Dashboard. App.jsx statically imports Landing, Dashboard, SuperAdmin etc., so a marketing visitor downloads the whole app. `manualChunks: { charts: ['recharts'] }` splits Recharts, but Dashboard imports `ChatAnalytics` eagerly, making the chunk a static entry dependency. `frontend/dist` is not committed (`.gitignore:22`). |
| Steps to reproduce / Evidence | Code trace above. |
| Expected | Lazy top-level routes and lazy ChatAnalytics. |
| Actual | One large entry bundle. |
| Impact | Slower first paint on the landing page. |
| Suggested fix | `lazy()` top-level pages and heavy Dashboard views, inside an error boundary (CF-086). |
| Effort | S |
| Related IDs | CF-086 |
| Audit working IDs | F-H-031 |

### CF-184

**`Btn` silently drops `variant="sec"`, `variant="danger"`, `size="xs"` and the `outline` boolean — buttons render unstyled**

| Field | Value |
|---|---|
| Module | Frontend-Shell / Components |
| Area | Frontend |
| Status | UX |
| Severity | Low |
| Confidence | Confirmed |
| Location | frontend/src/components/Btn.jsx:4,11-13,18-30; frontend/src/components/CrmIntegrationHealthModal.jsx:83,189; frontend/src/components/LeadDistributionModal.jsx:137; frontend/src/pages/CrmSalesInboxView.jsx:998,1018,1037,1581,1722,1783,1833; frontend/src/pages/CustomizeBusinessView.jsx:402; frontend/src/components/CrmDashboardWidgets.jsx:64; frontend/src/pages/DealsView.jsx:305; frontend/src/pages/CrmSalesInboxView.jsx:1021,1024,1042 |
| Description | `Btn` supports only `variant` ∈ {primary, ghost, outline} (Btn.jsx:18-30 — anything else falls to `{}`) and `size` ∈ {sm, lg, md-default} (Btn.jsx:11-13). 10 call sites pass `variant="sec"`, 1 passes `variant="danger"` (the destructive "Reset" in CustomizeBusinessView:402 renders with no background/colour — indistinguishable from plain text), 7 pass `size="xs"` (renders at md size, larger than the surrounding `sm` buttons), and CrmDashboardWidgets:64 passes a bare `outline` boolean that is not a prop. |
| Steps to reproduce / Evidence | grep `variant="sec"` → 10 hits; `variant="danger"` → 1; `size="xs"` → 7. Btn.jsx line 4 destructures only `children, variant, size, onClick, style, disabled, type`. |
| Expected | Either the component supports those variants/sizes or the call sites use supported ones. |
| Actual | Buttons render with no background, no border, inherited colour (`sec`/`danger`), and wrong padding (`xs`). |
| Impact | Visual inconsistency; the danger reset button lacks destructive affordance. |
| Suggested fix | Add `sec`→`ghost` alias, `danger` red variant and `xs` size to Btn.jsx; or replace at call sites. |
| Effort | S |
| Related IDs | CF-187 |
| Audit working IDs | F-H-001 |

### CF-185

**13 icon usages reference names that `Icons.jsx` does not define — they render as empty SVGs**

| Field | Value |
|---|---|
| Module | Frontend-Shell / Components |
| Area | Frontend |
| Status | BROKEN |
| Severity | Low |
| Confidence | Confirmed |
| Location | frontend/src/components/Icons.jsx:68 (`d[n] \|\| null`); undefined names at: frontend/src/components/CrmIntegrationHealthModal.jsx:92 (`loader`), frontend/src/pages/CrmSalesInboxView.jsx:709 (`loader`), :721 (`messageSquare`), :788 (`barChart`), :1259 (`info`), :1424 (`layers`), frontend/src/pages/CrmDashboardView.jsx:321 (`layout`), frontend/src/pages/CustomizeBusinessView.jsx:1002,1897 (`layout`), frontend/src/pages/LeadsView.jsx:770 (`tag`), frontend/src/pages/TasksView.jsx:156 (`check-circle`), frontend/src/pages/ContactsView.jsx:287 (data `icon:'edit'`), frontend/src/pages/Dashboard.jsx:2540 (data `icon:'layout'` for the CRM Overview nav item) |
| Description | `I` looks up `d[n]` and returns `null` when missing, so the `<svg>` renders a blank box of size `s`. Every listed site renders an invisible icon: the loading spinners in CrmIntegrationHealthModal and CrmSalesInboxView are blank (the "loading" state has no visual indicator at all), the CRM Overview nav tab and the "Contact Tags" heading show an empty square, the Tasks empty-state 32px icon is blank, and the "Enter Manually" import option has no icon. |
| Steps to reproduce / Evidence | Node script comparing all `<I n="…">` literals + `icon:'…'` data fields against the keys of `d` in Icons.jsx: 8 distinct undefined literal names (13 sites) + 2 undefined data-driven names. |
| Expected | Every referenced name exists (or `I` warns in dev). |
| Actual | Empty SVGs; no dev warning. |
| Impact |  |
| Suggested fix | Add the 10 missing glyphs (`layout, loader, tag, messageSquare, layers, info, check-circle, barChart, edit`) or map to existing ones (`msg`, `chart`, `alertc`, `checkc`, `pencil`, `rotate`, `columns`); add `if (import.meta.env.DEV && !d[n]) console.warn(...)`. |
| Effort | S |
| Related IDs | CF-184 |
| Audit working IDs | F-H-003 |

### CF-186

**Ten Avatar implementations; the nine local copies crash on a `null` name**

| Field | Value |
|---|---|
| Module | Frontend-Shell / Components |
| Area | Frontend |
| Status | RELIABILITY |
| Severity | Low |
| Confidence | Likely |
| Location | frontend/src/components/Avatar.jsx:3 (shared, null-safe), frontend/src/pages/Dashboard.jsx:72, ProfileView.jsx:58, InboxView.jsx:15, ContactsView.jsx:9, SettingsView.jsx:81, AnalyticsView.jsx:23, UserAnalyticsView.jsx:46, components/ContactDetailsPanel.jsx:13, components/dashboard/ChatAnalytics.jsx:61 |
| Description | Local copies call `name.split(' ')` with a default parameter that guards `undefined` but not `null`. Call sites pass nullable fields directly (InboxView.jsx:552,617 `contact.name`; ContactsView.jsx:1038; SettingsView.jsx:667; ContactDetailsPanel.jsx:201). A `null` throws and, with no error boundary (CF-086), blanks the app; an empty string yields `background: "undefined18"`. |
| Steps to reproduce / Evidence | Code trace above. |
| Expected | One null-safe Avatar. |
| Actual | Nine divergent copies. |
| Impact | Possible white screen in Inbox/Contacts; inconsistent visuals. |
| Suggested fix | Import `components/Avatar.jsx` everywhere; add a `ring` variant. |
| Effort | S |
| Related IDs | CF-086 |
| Audit working IDs | F-H-018 |

### CF-187

**`Btn` drops `title`, `aria-*`, `className`, `id` and every other pass-through prop**

| Field | Value |
|---|---|
| Module | Frontend-Shell / Components / Accessibility |
| Area | Frontend |
| Status | UX |
| Severity | Low |
| Confidence | Confirmed |
| Location | frontend/src/components/Btn.jsx:4,31; frontend/src/components/ImportExport.jsx:90; frontend/src/pages/CrmSalesInboxView.jsx:1021,1024,1042 |
| Description | `Btn` destructures a fixed prop list and does not spread `...rest` onto the `<button>` (Btn.jsx:31). `title="Download as CSV"` (ImportExport.jsx:90) and the three `title=` tooltips in CrmSalesInboxView (1021, 1024, 1042 — the "Simulate lead inbound" / "sync" explanations) never reach the DOM, so the tooltips authors relied on are not shown and no `aria-label` can ever be passed. `type` defaults to `undefined` → browser default `submit`, so any `<Btn>` inside a `<form>` without `type="button"` submits the form. |
| Steps to reproduce / Evidence | Btn.jsx:31 `<button type={type} style={base} onClick={onClick} disabled={disabled} ...>` — no rest spread. |
| Expected | Unknown props are forwarded to the `<button>`; `type` defaults to `"button"`. |
| Actual | Silently discarded. |
| Impact | Missing tooltips/ARIA on icon-ish buttons; latent form-submit bugs. |
| Suggested fix | `({ children, variant, size, style, ...rest }) => <button type="button" {...rest} …>`. |
| Effort | S |
| Related IDs | CF-184, CF-134 |
| Audit working IDs | F-H-002 |

### CF-188

**Sidebar CRM badge is fetched once, runs for super admin, counts a page length, and flips between workspace-wide and "mine"**

| Field | Value |
|---|---|
| Module | Frontend-Shell / CRM |
| Area | Frontend |
| Status | UX |
| Severity | Low |
| Confidence | Confirmed |
| Location | frontend/src/pages/Dashboard.jsx:2730-2741, frontend/src/pages/CrmDashboardView.jsx:60-79 |
| Description | No interval and no `isSuperAdmin` guard (the wallet effect at :2743 has one); count is `tData.data.length` of a paginated response (capped at page size); CrmDashboardView re-emits `crm:badge-updated` with its own count, filtered by `assignedToUserId` when its filter is "me", so the sidebar silently switches to a personal count; for super admin `wFetch` rejects and the error is swallowed. |
| Steps to reproduce / Evidence | Code trace above. |
| Expected | A server `total`, refreshed periodically, skipped for super admin. |
| Actual | Stale, inconsistent count. |
| Impact | Misleading "urgent" count. |
| Suggested fix | Count endpoint polled on the notifications cadence; guard super admin. |
| Effort | S |
| Related IDs | CF-189 |
| Audit working IDs | F-H-015 |

### CF-189

**Polling never pauses in hidden tabs, has no overlap guard, and the wallet is polled twice**

| Field | Value |
|---|---|
| Module | Frontend-Shell / Inbox / Campaigns / Templates / Billing |
| Area | Frontend |
| Status | PERF |
| Severity | Low |
| Confidence | Confirmed |
| Location | frontend/src/lib/useWallet.js:52, frontend/src/pages/Dashboard.jsx:2766,468,1058,1064,1358,1965, frontend/src/pages/InboxView.jsx:272,294, frontend/src/pages/CrmSalesInboxView.jsx:339 |
| Description | All 17 `setInterval`s are cleared on unmount (no leaks). But none skip while `document.hidden`, none guard in-flight requests, and the wallet is polled by both `useWallet` (60 s) and the Sidebar (60 s). Inventory: wallet 60 s ×2; notifications 30 s; campaign detail 8 s (keeps polling after COMPLETED/FAILED); campaigns list 10 s while RUNNING/SCHEDULED; templates 12 s/25 s; inbox list 5 s; inbox thread 4 s (no sequence guard); sales-inbox thread 4 s. The CRM badge is not polled (see CF-188). |
| Steps to reproduce / Evidence | `grep -rn setInterval src` → 17 hits each with `clearInterval`; `visibilityState` used only to trigger a load on focus (Dashboard.jsx:2764, useWallet.js:50). |
| Expected | Visibility-aware polling, one wallet source, one request in flight per poll. |
| Actual | One background Inbox tab makes about 1,620 requests/hour plus 120 notifications and 60 wallet; overlapping 4 s polls can let an older response overwrite a newer one. |
| Impact | Needless API/DB load; flicker of just-sent messages. |
| Suggested fix | Shared `usePolling` hook (visibility + in-flight aware); Sidebar uses `useWallet()`; stop campaign-detail poll on terminal status. |
| Effort | S |
| Related IDs | Lead 19 |
| Audit working IDs | F-H-013 |

### CF-190

**CRM views ignore mobile, and the bottom tab bar has no "More" entry — from a CRM page on a phone the nav drawer cannot be opened**

| Field | Value |
|---|---|
| Module | Frontend-Shell / Mobile |
| Area | Frontend |
| Status | UX |
| Severity | Low |
| Confidence | Confirmed |
| Location | frontend/src/lib/useMediaQuery.js, frontend/src/pages/Dashboard.jsx:345,2680-2685,3024, frontend/src/components/MobileNavButton.jsx, frontend/src/pages/LeadsView.jsx:1473, frontend/src/pages/DealsView.jsx:585, frontend/src/pages/CrmSalesInboxView.jsx:976 |
| Description | `MobileNavButton` is imported by 18 views but no CRM view; CRM views don't use `useIsMobile`. `MOBILE_TABS` offers only Home, Campaigns, Inbox, Analytics — no menu entry. LeadsView's list pane is fixed `width: 380, flexShrink: 0`, wider than a 375 px phone. `openMobileNav` is defined twice. |
| Steps to reproduce / Evidence | Code trace above. |
| Expected | "More" tab opening the drawer; responsive CRM panes. |
| Actual | CRM is desktop-only. |
| Impact | Mobile users are stuck on CRM pages. |
| Suggested fix | Add a "Menu" tab calling `openMobileNav`; `width: mobile ? '100%' : 380`. |
| Effort | S |
| Related IDs |  |
| Audit working IDs | F-H-030 |

### CF-191

**NotificationsBell `toggle` checks a stale `unread` after `await load()`, so newly arrived notifications are never marked read**

| Field | Value |
|---|---|
| Module | Frontend-Shell / Notifications |
| Area | Frontend |
| Status | BROKEN |
| Severity | Low |
| Confidence | Confirmed |
| Location | frontend/src/pages/Dashboard.jsx:455-465,486-497; frontend/src/pages/Dashboard.jsx:486-496 |
| Description | `toggle` runs `await load()` then `if (unread === 0) return;` (:491-492); `unread` is the pre-click render value and `load` returns nothing. If the badge showed 0 and the fresh load finds items, toggle returns early: the badge jumps to N and `POST /notifications/read-all` is never sent. |
| Steps to reproduce / Evidence | Code trace above. |
| Expected | `load` returns the fresh count and toggle branches on it. |
| Actual | Badge stays after opening the bell. |
| Impact | Minor UX; this is the real "NotificationsBell stale closure" from Lead 19. |
| Suggested fix | `const n = await load(); if (!n) return;` |
| Effort | S |
| Related IDs | Lead 19 |
| Audit working IDs | F-H-014, F-core-005 |

### CF-192

**`navigate()` (history push + synthetic popstate + setState) is called during render in `renderPage`; `isAuthed()` mutates localStorage during render**

| Field | Value |
|---|---|
| Module | Frontend-Shell / Router |
| Area | Frontend |
| Status | TECH-DEBT |
| Severity | Low |
| Confidence | Confirmed |
| Location | frontend/src/App.jsx:386-396 (navigate inside renderPage, called from App body at 238); :95 (`clearStoredSession()` inside `isAuthed()`, called from renderPage at 337,352,375,386) |
| Description | `renderPage` runs during App's render. For `path === '/' && isAuthed()` it calls `navigate()`, which does `history.replaceState` and dispatches `popstate`, whose listener calls `setPath`/`setSearch` on the component currently rendering. `isAuthed()` also clears localStorage as a render side effect. Works because React tolerates same-component setState during render, but is double-invoked under StrictMode. |
| Steps to reproduce / Evidence | App.jsx:386-396. |
| Expected | Redirect in the route-guard `useEffect` (174-236). |
| Actual | Redirect in render. |
| Impact | Low. |
| Suggested fix | Move the `/` redirect into the guard effect; return null from renderPage. |
| Effort | S |
| Related IDs | CF-179 |
| Audit working IDs | F-H-009 |

### CF-193

**`Dashboard.renderView` has unreachable duplicate branches for `contacts` and `automation`**

| Field | Value |
|---|---|
| Module | Frontend-Shell / Router |
| Area | Frontend |
| Status | TECH-DEBT |
| Severity | Low |
| Confidence | Confirmed |
| Location | frontend/src/pages/Dashboard.jsx:3105,3115,3106,3127 |
| Description | A second `if` branch for each page further down can never run; the dead `automation` copy renders `<AutomationView />` without `initialTab`, so edits there have no effect. |
| Steps to reproduce / Evidence | Read of the renderView chain. |
| Expected | One branch per page (ideally a lookup map). |
| Actual | Duplicates. |
| Impact | Maintenance trap. |
| Suggested fix | Delete :3115 and :3127; convert chain to a map. |
| Effort | S |
| Related IDs | CF-180; Lead 19 |
| Audit working IDs | F-H-016 |

### CF-194

**Home "Upgrade to Growth plan" banner is hard-coded and shown to every plan**

| Field | Value |
|---|---|
| Module | Home |
| Area | Frontend |
| Status | UX |
| Severity | Low |
| Confidence | Confirmed |
| Location | frontend/src/pages/Dashboard.jsx:849-859 |
| Description | The banner "Unlock AI Smart Replies & A/B Testing — Upgrade to Growth plan" is static JSX with no plan check; Growth/Enterprise customers see it too. "A/B Testing" does not exist anywhere in the codebase (grep `A/B` in frontend/src + backend/src returns only this string). |
| Steps to reproduce / Evidence | Static code trace at the cited Location lines; the trace is written out in the Description. |
| Expected | Hide when the plan already includes the feature; do not advertise a non-existent feature. |
| Actual | Always rendered; promises A/B testing that is not implemented. |
| Impact | Misleading upsell. |
| Suggested fix | Gate on `/subscription` plan features; drop the A/B claim. |
| Effort | S |
| Related IDs |  |
| Audit working IDs | F-core-003 |

### CF-195

**Home Instagram card is a permanent "Coming Soon" placeholder while Instagram routes exist**

| Field | Value |
|---|---|
| Module | Home |
| Area | Frontend |
| Status | FAKE/STUB |
| Severity | Low |
| Confidence | Confirmed |
| Location | frontend/src/pages/Dashboard.jsx:978-993; backend/src/routes/instagram.routes.js:14-21 |
| Description | The card says "Connect Account / Coming Soon" with no click handler, although `/workspaces/:id/instagram/*` connection + flow routes are mounted and nothing in the frontend calls them (see contract diff (c)). |
| Steps to reproduce / Evidence | Static code trace at the cited Location lines; the trace is written out in the Description. |
| Expected |  |
| Actual |  |
| Impact | Dead UI; backend feature unreachable. |
| Suggested fix | Wire the card to the instagram connection endpoints or remove the card. |
| Effort | S |
| Related IDs |  |
| Audit working IDs | F-core-004 |

### CF-196

**Home stats come from three unpaginated list calls, not a stats endpoint**

| Field | Value |
|---|---|
| Module | Home |
| Area | Frontend |
| Status | PERF |
| Severity | Low |
| Confidence | Confirmed |
| Location | frontend/src/pages/Dashboard.jsx:592-594 (`/campaigns`, `/whatsapp/numbers`), :670 (`/conversations`), :758 (`/whatsapp/numbers` again); frontend/src/components/WalletSummaryCards.jsx:12 |
| Description | The home view fires 5 requests (numbers twice) and derives "next best action" from the first 20 campaigns only (server default page). A DRAFT older than the 20 newest campaigns is never suggested. No `/analytics/overview` call is made on Home, so there are no message/delivery stats on the landing dashboard. |
| Steps to reproduce / Evidence | Static code trace at the cited Location lines; the trace is written out in the Description. |
| Expected |  |
| Actual |  |
| Impact |  |
| Suggested fix | Add a single workspace stats endpoint that returns counts instead of fetching three full lists. |
| Effort | S |
| Related IDs |  |
| Audit working IDs | F-core-028 |

### CF-197

**Inbox "realtime" is 5 s / 4 s polling of full lists**

| Field | Value |
|---|---|
| Module | Inbox |
| Area | Both |
| Status | PERF |
| Severity | Low |
| Confidence | Confirmed |
| Location | frontend/src/pages/InboxView.jsx:272, :294; no socket/SSE anywhere (grep `EventSource\|socket.io\|ws://` in frontend/src returns nothing) |
| Description | Every open inbox tab issues GET /conversations (with 2 messages + aiSessions per row) every 5 s and GET /conversations/:id/messages every 4 s regardless of activity. Home `LiveConversations` also fetches /conversations once. No ETag/since parameter. |
| Steps to reproduce / Evidence | Static code trace at the cited Location lines; the trace is written out in the Description. |
| Expected |  |
| Actual |  |
| Impact | DB load scales with open tabs; not real-time under load. |
| Suggested fix | `since` cursor or SSE via the existing Redis. |
| Effort | M |
| Related IDs |  |
| Audit working IDs | F-core-011 |

### CF-198

**Inbox note deletion and bot toggle exist on the backend but have no UI**

| Field | Value |
|---|---|
| Module | Inbox |
| Area | Frontend |
| Status | MISSING |
| Severity | Low |
| Confidence | Confirmed |
| Location | backend/src/routes/conversations.routes.js:18, :23; frontend/src/pages/InboxView.jsx (no call to `/notes/:noteId` DELETE or `/bot` PATCH) |
| Description | Contract diff (c) lists `DELETE /conversations/:id/notes/:noteId` and `PATCH /conversations/:id/bot` as uncalled. A note cannot be removed from the UI; handing a thread back to the automation is only possible by resolving it. |
| Steps to reproduce / Evidence | Static code trace at the cited Location lines; the trace is written out in the Description. |
| Expected |  |
| Actual |  |
| Impact |  |
| Suggested fix | Add note-delete and bot-toggle controls to the Inbox, or remove the unused endpoints. |
| Effort | S <!-- PROGRESS 2: Templates, Contacts, Analytics, Auth-OTP, Admin, Auth screens, API keys --> |
| Related IDs |  |
| Audit working IDs | F-core-014 |

### CF-199

**InboxView has no loading or error state — it shows "No conversations yet" during the first fetch and forever on error**

| Field | Value |
|---|---|
| Module | Inbox |
| Area | Frontend |
| Status | UX |
| Severity | Low |
| Confidence | Confirmed |
| Location | frontend/src/pages/InboxView.jsx:174,270,292,332,422,536-540 |
| Description | `convs` starts as `[]` with no `loading` state; the empty state renders immediately. Every fetch error is swallowed with `.catch(() => {})`, so an expired workspace, 403 or outage looks like an empty inbox. |
| Steps to reproduce / Evidence | `grep -c loading InboxView.jsx` = 0. |
| Expected | Skeleton while loading; error banner with retry. |
| Actual | Misleading empty state. |
| Impact | Users think no messages arrived. |
| Suggested fix | Add `loading`/`error` state around `loadConvs`/`loadMsgs`. |
| Effort | S |
| Related IDs | CF-091 |
| Audit working IDs | F-H-026 |

### CF-200

**Phone matching — fuzzy path is safe; national-format contacts silently duplicate**

| Field | Value |
|---|---|
| Module | Inbox / Contacts |
| Area | Backend |
| Status | DATA |
| Severity | Low |
| Confidence | Confirmed |
| Location | backend/src/services/webhook.service.js:261-280, :296-306 |
| Description | The `contains: tail` query (:276) is post-filtered by an exact digit comparison (:279), so a wrong-contact match cannot happen (lead risk refuted). A contact stored nationally ("9876543210"/"09876543210") never equals Meta's "919876543210", so a second contact is created with bare E.164 digits (:298 `phoneNumber: fromPhone`) → two rows per person; the P2002 recovery (:302) only finds a row stored as bare digits, so a `+`-stored duplicate created concurrently by the UI still throws. |
| Steps to reproduce / Evidence | Static code trace at the cited Location lines; the trace is written out in the Description. |
| Expected | one contact per number vs duplicates. |
| Actual |  |
| Impact | Data quality; opt-out/skip keyed on the wrong row. |
| Suggested fix | Normalise `Contact.phoneNumber` to digits on write; match on that. |
| Effort | M |
| Related IDs |  |
| Audit working IDs | F-D-012 |

### CF-201

**Writes that fail silently: Settings prefs save, invite resend, invoices list, revoke invitation**

| Field | Value |
|---|---|
| Module | Multiple (Settings / Payments / SuperAdmin) |
| Area | Frontend |
| Status | UX |
| Severity | Low |
| Confidence | Confirmed |
| Location | frontend/src/pages/SettingsView.jsx:210-213,313,263, frontend/src/pages/PaymentsView.jsx:139,167,199,264,387,430, frontend/src/pages/SuperAdminView.jsx:1158, frontend/src/pages/CreateCampaign.jsx:532 |
| Description | Sampled state coverage of nine views. LeadsView, DealsView, AutomationView and CreateCampaign have loading/error/empty states. Gaps: Settings prefs save shows nothing on `!r.ok` and swallows exceptions; invite resend `if (!r.ok) return;` silently; invite email has no format check; Payments invoice fetches `.catch(() => {})` so failures look like "no invoices"; SuperAdmin revoke invitation swallowed; CreateCampaign manual phone entry only checks `.trim()`. |
| Steps to reproduce / Evidence | Cited lines. |
| Expected | Every write reports failure. |
| Actual | Silent failures. |
| Impact | Users believe saves/resends worked when they did not. |
| Suggested fix | Show errors on `!r.ok` and in `catch`; validate email/phone format. |
| Effort | S |
| Related IDs | CF-199 |
| Audit working IDs | F-H-028 |

### CF-202

**Long boot path before `listen()` delays the health check**

| Field | Value |
|---|---|
| Module | Ops / Boot |
| Area | Backend |
| Status | RELIABILITY |
| Severity | Low |
| Confidence | Confirmed |
| Location | backend/src/server.js:216-372 |
| Description | Before `app.listen` the server does the following in order: - runs `migrate deploy` (a child process), - makes up to 5 DB connect attempts 2 s apart, - loads platform settings, - upserts plans and backfills every workspace, - pings Redis, - starts workers and schedules, - recovers scheduled campaigns and pending retries, - runs the full billing-cycle sweep (`runBillingCycleSweep`, :360). On Render the health check (`/api/v1/health`) cannot answer until all of this finishes. deploy-vps.sh:77 gives only 20 s. A large overdue billing sweep can make a healthy deploy look failed. `runBillingCycleSweep` also runs even when Redis is down (development-only degraded mode). |
| Steps to reproduce / Evidence | Static code trace at the cited Location lines; the trace is written out in the Description. |
| Expected |  |
| Actual |  |
| Impact |  |
| Suggested fix | Start listening first and run the recovery sweeps after `listen` (fire-and-forget with logging), or report readiness separately (see CF-203). |
| Effort | S |
| Related IDs |  |
| Audit working IDs | F-G-005 |

### CF-203

**Health check is liveness-only and answers "ok" with the DB or Redis down**

| Field | Value |
|---|---|
| Module | Ops / Health |
| Area | Backend |
| Status | RELIABILITY |
| Severity | Low |
| Confidence | Confirmed |
| Location | backend/src/routes/index.js:77-82, render.yaml:32, deploy-vps.sh:28,76-88 |
| Description | `GET /api/v1/health` returns `{status:'ok', ts}` without touching Prisma or Redis. Render (`healthCheckPath`) and deploy-vps.sh both treat it as proof the deploy works. Once `listen()` has run, a lost DB (e.g. a paused Supabase free project, DEPLOY.md) or a lost Redis never flips the check. The route is also mounted only after the whole boot sequence (CF-202). |
| Steps to reproduce / Evidence | Static code trace at the cited Location lines; the trace is written out in the Description. |
| Expected |  |
| Actual |  |
| Impact |  |
| Suggested fix | Keep `/health` as liveness, and add `/health/ready` that runs `SELECT 1` plus a Redis `PING` with a timeout. Point `healthCheckPath` at the readiness route. |
| Effort | S |
| Related IDs |  |
| Audit working IDs | F-I-006 |

### CF-204

**Boot backfill reads every Workspace row in full, then runs 2 sequential queries per missing subscription**

| Field | Value |
|---|---|
| Module | Ops / Seeding |
| Area | Backend |
| Status | PERF |
| Severity | Low |
| Confidence | Confirmed |
| Location | backend/src/server.js:172-208 |
| Description | Every boot runs `prisma.workspace.findMany({ include: { subscription: true } })` with no where, select or take. It loads every Workspace column, including encrypted Instagram tokens and AI prompts. The code only needs `id`, `plan`, and whether a subscription exists. |
| Steps to reproduce / Evidence | Static code trace at the cited Location lines; the trace is written out in the Description. |
| Expected |  |
| Actual |  |
| Impact |  |
| Suggested fix | `where: { subscription: null }, select: { id: true, plan: true }`. |
| Effort | S |
| Related IDs | CF-048 |
| Audit working IDs | F-F-004 |

### CF-205

**`Contact.optedOut` and the `OptOut` table are consulted by disjoint send paths**

| Field | Value |
|---|---|
| Module | Opt-out |
| Area | Backend |
| Status | PARTIAL |
| Severity | Low |
| Confidence | Confirmed |
| Location | backend/src/services/optout.service.js:148-156; backend/src/workers/sequence.worker.js:142; backend/src/services/sequenceEngine.service.js:96 |
| Description | `isOptedOut`/`assertNotOptedOut` (inbox, automated replies, public API, campaign worker, OTP) read only `OptOut.active`. The sequence worker reads only `Contact.optedOut`. The two are kept in sync only by `recordOptOut`/`unblockNumbers` (no other writer of `optedOut: true` exists outside tests), so today's divergence risk is limited to direct DB edits/imports. STOP handling itself is correct: whole-message match, case/punctuation-insensitive, idempotent upsert (`optout.service.js:68-72, :124-128`); `cancel/quit/end` demoted to flow control only while a form/run is open (`webhook.service.js:464-473`); `stop` inside `CONTROL_COMMANDS.cancel` (`conversationControl.service.js:73`) is unreachable because opt-out runs first. |
| Steps to reproduce / Evidence | Static code trace at the cited Location lines; the trace is written out in the Description. |
| Expected | one source of truth vs two. |
| Actual |  |
| Impact | Low today. |
| Suggested fix | Have `isOptedOut` also check `contact.optedOut`; use it in the sequence worker. |
| Effort | S |
| Related IDs | CF-028 |
| Audit working IDs | F-D-010 |

### CF-206

**Per-message price fallbacks disagree between campaign, inbox and wallet-status paths**

| Field | Value |
|---|---|
| Module | Pricing |
| Area | Backend |
| Status | BILLING |
| Severity | Low |
| Confidence | Confirmed |
| Location | backend/src/lib/messagePricing.js:35-62, backend/src/services/campaigns.service.js:514,682, backend/src/services/subscription.service.js:99, backend/src/services/wallet.service.js:43-54, backend/prisma/schema.prisma:142 (`costPerMessage @default(0.92)`) |
| Description | A template with an unrecognised/missing category is priced at `Workspace.costPerMessage` (default ₹0.92) in campaigns, but an inbox send with no category is priced at `plan.overageRatePerMsg` (₹0.02/0.01/0.008). Wallet LOW/EMPTY thresholds (`walletStatus`) use `costPerMessage` (0.92) although the real per-message cost is 1.09/0.16/0.13. Free plan overage template rates are 2x cost (`overageRates`) but Free campaigns are billed at cost (`rateForCategory` ignores plan overrides) — so on Free a template is cheaper as a campaign than as an inbox template send. `Plan.overageRatePerMsg` of 0 would make `debit()` throw a 400 mid-send (`wallet.service.js:194`). |
| Steps to reproduce / Evidence | Static code trace at the cited Location lines; the trace is written out in the Description. |
| Expected | One pricing function used by estimate, launch, overage and status. |
| Actual | Three different fallbacks. |
| Impact | Inconsistent quotes; minor. |
| Suggested fix | Use `overageRateFor(plan, category)` everywhere; derive wallet threshold from the plan's marketing rate. |
| Effort | S |
| Related IDs | CF-008 |
| Audit working IDs | F-B-018 |

### CF-207

**Landing/site pricing copy makes claims the plan catalog cannot honour**

| Field | Value |
|---|---|
| Module | Pricing / Marketing |
| Area | Both |
| Status | DOCS |
| Severity | Low |
| Confidence | Confirmed |
| Location | backend/src/data/siteContent.js:133-150, frontend/src/pages/Landing.jsx:731-737, backend/src/server.js:53-107 |
| Description | Basic "1 WhatsApp number", "10,000 messages per cycle" (see CF-008), Growth "Unlimited numbers and members" (members null = unlimited OK; numbers unlimited on every plan), "Unlimited messages" (campaigns still charge wallet per message). Quarterly Basic ₹3,500 (22% off) vs Growth ₹7,500 (0% off) — inconsistent discount, matches seed so not a bug. Per-message rates on the landing come from `/api/v1/pricing` (routes/index.js:87) = `MESSAGE_CATEGORY_RATES` — consistent with `/subscription/pricing` and campaign billing. |
| Steps to reproduce / Evidence | Static code trace at the cited Location lines; the trace is written out in the Description. |
| Expected | Copy matches enforcement. |
| Actual | Drift on numbers/messages claims. |
| Impact | Misleading marketing. |
| Suggested fix | Align copy or add limits (CF-051). |
| Effort | S |
| Related IDs | CF-008, CF-051 |
| Audit working IDs | F-B-019 |

### CF-208

**Job-id builders: `delayed__` prefix contradicts its own comment; `jobIds.test.js` tests local copies, not the real builders**

| Field | Value |
|---|---|
| Module | Queues |
| Area | Backend |
| Status | TECH-DEBT |
| Severity | Low |
| Confidence | Confirmed |
| Location | backend/src/queues/workflow.queue.js:42, :55-61; backend/src/queues/jobIds.test.js:15-16, :31-35; backend/src/services/retry.service.js:115; backend/node_modules/bullmq/dist/cjs/classes/job.js:1031-1040 (BullMQ 5.76.6, read from the main checkout's node_modules); backend/src/queues/jobIds.test.js:15-29; backend/src/queues/workflow.queue.js:42,48,61,68; backend/src/services/retry.service.js:115; backend/src/queues/sequence.queue.js:31 |
| Description | The comment above `enqueueDelayedResponseCheck` says "The id must not begin with `delayed` … a custom id starting with that word is rejected outright", yet the code builds `jobKey('delayed', conversationId)` = `delayed__<id>`. The test file asserts the delayed-response id is `dresp-<id>` using its *own* `buildDelayedResponseId` (:15) — it never imports `workflow.queue.js`, so it passes while production uses a different shape. Actual BullMQ 5.76.6 rules: reject integer-looking ids and ids containing `:` unless they split into exactly 3 parts; there is no reserved-prefix rule. So `delayed__<id>` **works** (the comment's premise is wrong), and `retry:<id>:<n>` (retry.service.js:115) is accepted only through the legacy 3-segment exception that BullMQ's own TODO says will become `includes(':')` in the next breaking release — at which point every campaign retry enqueue would throw. |
| Steps to reproduce / Evidence | Static code trace at the cited Location lines; the trace is written out in the Description. |
| Expected | One shared id builder module, imported by the queues and the test; no colons. |
| Actual | Drifted comment, test covering dead copies, colon-based retry ids. |
| Impact | False confidence; latent breakage on BullMQ upgrade. |
| Suggested fix | Export the builders from the queue modules and test those; switch `retryJobId` to `retry-<id>-<n>` (with a one-off recovery for in-flight ids). |
| Effort | S |
| Related IDs | Lead 14 |
| Audit working IDs | F-E-017, F-JT-005 |

### CF-209

**Stray tracked files: Redis dump, QA PDF, screenshots, a prompt doc, an API-key minting script, and ad-hoc DB scripts**

| Field | Value |
|---|---|
| Module | Repo hygiene |
| Area | Infra |
| Status | TECH-DEBT |
| Severity | Low |
| Confidence | Confirmed |
| Location | backend/dump.rdb, qa_testing_2.pdf, screenshots/current.png, qa-output/*.png + qa-output/crm-recording-runner.mjs, frontend/MS_Prompt.md (3613 lines, "MASTER EXECUTION PROMPT"), public-api-test/{index.js,package.json,package-lock.json}, backend/test_key_gen.js, backend/check-all-auth-templates.mjs, backend/check-auth-templates.mjs, backend/check-wa-numbers.mjs, backend/tests-qa2-automation.mjs |
| Description | Everything listed is tracked in git (`git ls-files`). `frontend/dist` is **not** tracked (gitignored, and absent in the worktree). Per file: - `backend/dump.rdb` is an 89-byte Redis RDB snapshot (near-empty). - `backend/test_key_gen.js` does the following against whatever DATABASE_URL `.env` points at: - takes `prisma.workspace.findFirst()`, which is an arbitrary real tenant on a shared DB, - mints an API key with `scopes` unset, - prints the raw key to stdout (line ~29). - It has no local-DB guard. - `check-*.mjs` dump every WaNumber and template row across all tenants (check-wa-numbers.mjs:3-12, no workspace filter). - `tests-qa2-automation.mjs` (999 lines) drives services directly against the configured DB. It sets a dummy `env.GEMINI_API_KEY` at :625 (a placeholder, not a real key pattern). - `public-api-test/` is a sample client for localhost:4000 that also posts to webhook.site (index.js:72). - No real secrets were found in any of these (secret-like literals are test placeholders such as `password123`). |
| Steps to reproduce / Evidence | Static code trace at the cited Location lines; the trace is written out in the Description. |
| Expected |  |
| Actual |  |
| Impact |  |
| Suggested fix | Delete the dump, PDF, screenshots and qa-output, and move MS_Prompt.md to docs/. Move the scripts under `backend/scripts/dev/` and make them call `assertLocalDatabase()` (CF-029). Delete test_key_gen.js. |
| Effort | S |
| Related IDs |  |
| Audit working IDs | F-I-008 |

### CF-210

**Sequence worker: short-wait re-enqueue collides with its own job id; at-least-once sends on crash**

| Field | Value |
|---|---|
| Module | Sequences |
| Area | Backend |
| Status | RELIABILITY |
| Severity | Low |
| Confidence | Confirmed |
| Location | backend/src/workers/sequence.worker.js:112-121; backend/src/queues/sequence.queue.js:30-36; backend/src/services/sequenceEngine.service.js:219-226, :286-289 |
| Description | For a wait < 5 min the running `advance-<id>` job calls `enqueueAdvance(enrollmentId, delay)` with the *same* job id. `getJob` returns the active (locked) job, `remove()` fails and is swallowed (queue :33), and `add` with an existing id is a BullMQ no-op — the exact collision the comment at worker :98-101 describes for instant steps. The short wait is therefore only honoured by the next 60 s sweep (≤ 1 min late), not the scheduled delay. Separately, `advanceEnrollment` sends the message (:222-223) before advancing the cursor (:286-289) with no per-enrollment claim, so a crash or DB error between the two resends the same message on the next sweep. Concurrency 5 is otherwise safe because the deterministic job id dedupes sweep duplicates. |
| Steps to reproduce / Evidence | Static code trace at the cited Location lines; the trace is written out in the Description. |
| Expected | Precise short waits; idempotent step execution. |
| Actual | Minute-granularity waits; possible duplicate sends after a crash. |
| Impact | Minor timing/duplicate risk. |
| Suggested fix | Use a cursor-scoped id (`advance-<id>-<cursor>`) for the follow-up job; write the cursor/claim before sending. |
| Effort | S |
| Related IDs | CF-028 |
| Audit working IDs | F-E-020 |

### CF-211

**Unit test results: DB tests skip without a database; 4 AI Agents tests fail because they are not gated**

| Field | Value |
|---|---|
| Module | Tests |
| Area | Backend |
| Status | BROKEN |
| Severity | Low |
| Confidence | Confirmed |
| Location | backend/src/services/aiAgents.service.test.js:5,18,33,41; backend/package.json (`test`) |
| Description | All results come from the artefacts in `C:\Users\thete\.claude\jobs\d1cefbb9\tmp\`, produced on **local Node v24.19.0** (engines says 22). Every run was offline. \| Run \| Env used \| Tests \| Pass \| Fail \| Skipped \| Notes \| \|---\|---\|---\|---\|---\|---\|---\| \| unit_test_out.txt (worktree `backend/`) \| test.env (dummy values) \| 55 \| 18 \| 37 \| 0 \| 37 fails: every file that imports Prisma dies at load with `Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@prisma/client' imported from ...\backend\src\lib\prisma.js`, because the worktree has no node_modules. The 18 passes are pure tests such as jobIds.test.js. Environment artefact, not a code defect. \| \| unit_test_out2.txt (testcopy/ with node_modules symlinked to the main checkout) \| test.env: dummy secrets, DATABASE_URL and REDIS_URL on localhost, nothing listening \| 365 \| 183 \| 4 \| 178 \| The 178 skips are `t.skip('database unavailable')` (e.g. conversations.service.test.js:85). The 4 fails are all in aiAgents.service.test.js. \| \| otp_test_out.txt (`npm run test:otp`, tests/otp-scope.test.mjs) \| module mocks, no DB \| 3 \| 3 \| 0 \| 0 \| Cross-tenant OTP verification is blocked (passes). On Node 24 it prints a DeprecationWarning for `mock.module` `namedExports`. \| \| canon_test_out.txt (`npm run test:prisma-schema`) \| no DB \| 11 \| 10 \| 1 \| 0 \| 1 fail: "current schema.prisma matches the generated client inlineSchema" (CF-226). \| Failing tests in run 2. Each first error line is `PrismaClientInitializationError: Invalid prisma.savedView.findMany() invocation: Can't reach database server at localhost:5432`: 1. `AI Agents Hub - Default starter templates verification` (aiAgents.service.test.js:5, via listAgents at aiAgents.service.js:113) 2. `AI Agents Hub - Guidelines and Actions catalogues` (:18, via listGuidelines at aiAgents.service.js:282) 3. `AI Agents Hub - Conversational simulation testAgent` (:33, via testAgent -> listAgents at aiAgents.service.js:523) 4. `AI Agents Hub - Channels deployment listing` (:41, via listChannels at aiAgents.service.js:431) The file has 0 `dbAvailable`/`t.skip` guards, unlike the other 38 DB-backed test files. It is labelled a "dummy workspace" test but calls `prisma.savedView.findMany`, so it needs a live DB. - Net: with no DB, **0 real failures in DB-independent logic**. Roughly half the suite (178 tests) did not run, so DB-backed behaviour was **not verified** in this audit. |
| Steps to reproduce / Evidence | Static code trace at the cited Location lines; the trace is written out in the Description. |
| Expected |  |
| Actual |  |
| Impact |  |
| Suggested fix | Add the same `dbAvailable` guard, or mock prisma, in aiAgents.service.test.js. Add a CI job with a throwaway Postgres (`docker run postgres`) so the 178 tests actually run. |
| Effort | S |
| Related IDs |  |
| Audit working IDs | F-JT-001 |

### CF-212

**`getWalletSummary.campaignSpend` subtracts all REFUND credits, including message-overage refunds**

| Field | Value |
|---|---|
| Module | Wallet |
| Area | Backend |
| Status | DATA |
| Severity | Low |
| Confidence | Confirmed |
| Location | backend/src/services/wallet.service.js:317-323, backend/src/services/subscription.service.js:132 |
| Description | `releaseMessageCredit` credits refunds with `category:'REFUND'` for inbox overage failures; the summary subtracts every REFUND from CAMPAIGN debits, so inbox refunds reduce "Campaign Spend" and can drive it below the true figure. |
| Steps to reproduce / Evidence | Static code trace at the cited Location lines; the trace is written out in the Description. |
| Expected | Filter refunds by `reference`/reason to campaign refunds. |
| Actual | Mixed. |
| Impact | Dashboard number drift; minor. |
| Suggested fix | Use `reference: campaignId` or a `CAMPAIGN_REFUND` category. |
| Effort | S |
| Related IDs |  |
| Audit working IDs | F-B-024 |

### CF-213

**Meta/Instagram verify handshake echoes `hub.challenge` as text/html with no CSP; token compare not constant-time**

| Field | Value |
|---|---|
| Module | Webhooks |
| Area | Backend |
| Status | SECURITY |
| Severity | Low |
| Confidence | Confirmed |
| Location | backend/src/controllers/webhook.controller.js:5-14, backend/src/controllers/instagram.controller.js:116-119, backend/src/app.js:141-146 |
| Description | `res.status(200).send(challenge)` with a string is served as text/html on the SPA origin, where tokens live in localStorage. Anyone who knows `META_WEBHOOK_VERIFY_TOKEN` (compared with `===`) can reflect script. POST verification itself is correct: HMAC over `req.rawBody`, `timingSafeEqual` with length check, 401 on missing signature; both secrets required at boot so unset fails closed. |
| Steps to reproduce / Evidence | Code trace above. |
| Expected | `res.type('text/plain')`, timing-safe token compare, CSP baseline. |
| Actual | HTML reflection. |
| Impact | Reflected XSS conditional on knowing the verify token. |
| Suggested fix | As expected. |
| Effort | S |
| Related IDs |  |
| Audit working IDs | F-A2-013 |

### CF-214

**Website crawler checks DNS, then `fetch` re-resolves (DNS-rebinding window)**

| Field | Value |
|---|---|
| Module | Website analysis |
| Area | Backend |
| Status | SECURITY |
| Severity | Low |
| Confidence | Likely |
| Location | backend/src/lib/siteCrawler.js:97-120,138-158 |
| Description | `safeFetchHtml` is the best guard in the codebase (scheme, names, literal IPs, all resolved addresses, per-hop redirect re-validation, v4-mapped v6), but it calls `dns.lookup` (:104) then `fetch(url)` (:150), which resolves again. A TTL-0 rebinding domain can pass the check then connect to 127.0.0.1/169.254.169.254. The body reaches user-visible LLM analysis (non-blind). Also misses 198.18/15 (minor). |
| Steps to reproduce / Evidence | Code trace above. |
| Expected | Connect to the vetted IP (undici Agent with custom `lookup`). |
| Actual | TOCTOU gap. |
| Impact | Timing-dependent SSRF read of internal HTML. |
| Suggested fix | Pin the resolved address; reuse the helper for CF-105/010 and CF-117. |
| Effort | S |
| Related IDs | CF-117 |
| Audit working IDs | F-A2-011 |

### CF-215

**Agent and sequence workers have no `error` listener and no drainDelay/stalledInterval tuning**

| Field | Value |
|---|---|
| Module | Workers |
| Area | Backend |
| Status | TECH-DEBT |
| Severity | Low |
| Confidence | Confirmed |
| Location | backend/src/workers/agent.worker.js:55-64; backend/src/workers/sequence.worker.js:126-131; backend/node_modules/bullmq/dist/cjs/classes/queue-base.js:89-99, worker.js:34 |
| Description | Every other worker registers `worker.on('error', logRedisError)` and passes `drainDelay: env.WORKER_DRAIN_DELAY_SEC` (60 s) / `stalledInterval: env.WORKER_STALLED_INTERVAL_MS` (300 s) to cut Redis polling on the metered (Upstash) plan. These two use BullMQ defaults (drainDelay 5 s, stalledInterval 30 s) and have no error listener; BullMQ then falls back to `console.error` of the raw error on every retry (queue-base.js:89-99), the exact log flood billing.worker.js:19-21 documents. All queues also swallow their own errors with `.on('error', () => {})` (e.g. campaign.queue.js:14), hiding enqueue-side connection faults entirely. |
| Steps to reproduce / Evidence | Static code trace at the cited Location lines; the trace is written out in the Description. |
| Expected | Uniform worker options and logging. |
| Actual | Extra Redis commands (~12x the drain polling of the tuned workers) and log spam during outages. |
| Impact | Upstash quota burn; noisy logs. |
| Suggested fix | Apply the same options/listener to both workers; log queue errors through `logRedisError`. |
| Effort | S |
| Related IDs | CF-095 |
| Audit working IDs | F-E-018 |

### CF-216

**WorkflowRunStatus has no CANCELLED, and nothing bulk-cancels runs**

| Field | Value |
|---|---|
| Module | Workflow / Data model |
| Area | Backend |
| Status | TECH-DEBT |
| Severity | Low |
| Confidence | Likely |
| Location | backend/prisma/schema.prisma (enum WorkflowRunStatus RUNNING\|WAITING\|COMPLETED\|FAILED), backend/src/services/workflowEngine.service.js:374-798 |
| Description | `backend/src` never calls `workflowRun.updateMany`; runs are only updated one at a time (workflowEngine.service.js:473-798). Deactivating or editing a workflow leaves its WAITING runs waiting indefinitely. No terminal state separates a cancelled run from a FAILED one. The enum is in no migration (CF-019), so a migration adding a value has no base type to ALTER. |
| Steps to reproduce / Evidence | Static code trace at the cited Location lines; the trace is written out in the Description. |
| Expected |  |
| Actual |  |
| Impact |  |
| Suggested fix | Add `CANCELLED`, and cancel WAITING runs when a workflow is deactivated, deleted or republished. |
| Effort | S |
| Related IDs |  |
| Audit working IDs | F-F-008 |

### CF-217

**Conversation "insights" sentiment/topics are keyword heuristics presented as AI analysis**

| Field | Value |
|---|---|
| Module | Analytics (Chat analytics / Insights) |
| Area | Backend |
| Status | PARTIAL |
| Severity | Info |
| Confidence | Confirmed |
| Location | backend/src/services/analytics.service.js:618-629 (`classifySentiment` = word-list match), :630-700 |
| Description | Sentiment is positive/negative word counting on English word lists; topics are word frequency. No LLM call. Acceptable, but the UI copy ("AI insights") oversells it. |
| Steps to reproduce / Evidence | Static code trace at the cited Location lines; the trace is written out in the Description. |
| Expected |  |
| Actual |  |
| Impact |  |
| Suggested fix | Label the insights as keyword heuristics in the UI, or back them with a real model. |
| Effort | S |
| Related IDs |  |
| Audit working IDs | F-core-022 |

### CF-218

**Segments are static membership lists; no rule evaluation exists (docs already say so)**

| Field | Value |
|---|---|
| Module | Contacts / Segments |
| Area | Both |
| Status | PARTIAL |
| Severity | Info |
| Confidence | Confirmed |
| Location | backend/prisma/schema.prisma:970-980 (Segment: name/desc/color only); backend/src/services/segments.service.js (no rule/criteria code); docs/QA-TESTING-GUIDE.md:154 |
| Description | "Segment rule evaluation" does not exist; segments and clusters are two overlapping manual-list concepts. Segment creation lives in AutomationView.jsx:3631, not the Contacts screen. |
| Steps to reproduce / Evidence | Static code trace at the cited Location lines; the trace is written out in the Description. |
| Expected |  |
| Actual |  |
| Impact |  |
| Suggested fix | Document segments as static lists in the UI, or implement rule-based membership. |
| Effort | — |
| Related IDs |  |
| Audit working IDs | F-core-027 |

### CF-219

**AI_FEATURES_REPORT.md: wrong migration path, stale reply order, `migrate dev` instruction, UI location moved**

| Field | Value |
|---|---|
| Module | Docs / AI features |
| Area | Docs |
| Status | DOCS |
| Severity | Info |
| Confidence | Confirmed |
| Location | AI_FEATURES_REPORT.md:13-17, AI_FEATURES_REPORT.md:34-36, AI_FEATURES_REPORT.md:39 |
| Description | It says to apply `prisma/migrations/manual/003_ai_features.sql`; the file is at `backend/prisma/manual/003_ai_features.sql`. It gives the inbound order "exact trigger -> intent match -> welcome/OOO -> AI agent"; the current contract has 14 layers (opt-out, handoff, control commands, campaign AI, forms, workflows, escalation, exact keyword, intent, fuzzy, welcome/OOO, general intents, AI agent, fallback: `backend/src/services/webhook.service.js:205-224`, `docs/QA-2-FIXES.md:195-215`). It says deploy is blocked without `GEMINI_API_KEY`; `backend/src/lib/llm.js:24,194` also offers Ollama. The agent UI now also lives in the separate AI Agents studio (`frontend/src/pages/AiAgentsView.jsx`, imported at `Dashboard.jsx:28`). The files and endpoints it names do exist (`backend/src/lib/oauthProviders.js`, `GET /campaigns/fallback-capabilities` at `backend/src/routes/campaigns.routes.js:18`). "Google works end-to-end" is Not re-verified (external OAuth). |
| Steps to reproduce / Evidence | as cited. |
| Expected | Mark it as a historical patch note, or update it. |
| Actual | Reads as current instructions. |
| Impact | Minor. |
| Suggested fix | Add a "historical - superseded by QA-2-FIXES" banner. |
| Effort | S |
| Related IDs | CF-168 |
| Audit working IDs | F-J-009 |

### CF-220

**ATTRIBUTION.md is accurate; project licence is inconsistent elsewhere**

| Field | Value |
|---|---|
| Module | Docs / Licensing |
| Area | Docs |
| Status | DOCS |
| Severity | Info |
| Confidence | Confirmed |
| Location | ATTRIBUTION.md:1-82, README.md:468-470, package.json:15 |
| Description | ATTRIBUTION's technical claims check out: `FOR UPDATE SKIP LOCKED` claiming (`backend/src/services/agent.service.js:28,46`), evidence ledger (`backend/src/services/agent.evidence.js`), deny-when-unattended (`backend/src/services/agent.tools.js:178-185` `SENSITIVE` / `assertPermittedUnattended`), and the full MIT notice is reproduced. No issues found in ATTRIBUTION itself. Separately, README says the project is MIT while root `package.json:15` says ISC and no LICENSE file exists; `backend/package.json` and `frontend/package.json` declare none. |
| Steps to reproduce / Evidence | as cited. |
| Expected | One declared licence plus a LICENSE file. |
| Actual | MIT vs ISC, no file. |
| Impact | Legal ambiguity for a commercial product. |
| Suggested fix | Decide (likely "UNLICENSED"/proprietary for a SaaS), then align package.json, README and add LICENSE. |
| Effort | S |
| Related IDs | CF-175 |
| Audit working IDs | F-J-013 |

### CF-221

**backend/docs/local-redis-setup.md says Redis backs only the campaign and email queues**

| Field | Value |
|---|---|
| Module | Docs / Redis |
| Area | Docs |
| Status | DOCS |
| Severity | Info |
| Confidence | Confirmed |
| Location | backend/docs/local-redis-setup.md:3 |
| Description | Only two queues are named; the backend uses six (`backend/src/queues/{agent,billing,campaign,email,sequence,workflow}.queue.js`) plus the Redis-backed rate limiter and OAuth one-time codes. The WSL steps themselves are fine. |
| Steps to reproduce / Evidence | as cited. |
| Expected | A list of what depends on Redis, so a developer knows that without it billing cycles, sequences, workflows and the agent all stall. |
| Actual | Understates the dependency. |
| Impact | Minor. |
| Suggested fix | One-line update. |
| Effort | S |
| Related IDs | CF-175 |
| Audit working IDs | F-J-004 |

### CF-222

**TESTING_WALKTHROUGH.md test count (277) disagrees with TEST_EVIDENCE.md (264) and the tree; `npm test` needs a live local DB**

| Field | Value |
|---|---|
| Module | Docs / Testing |
| Area | Docs |
| Status | DOCS |
| Severity | Info |
| Confidence | Confirmed |
| Location | docs/TESTING_WALKTHROUGH.md:205-208, TEST_EVIDENCE.md:7 |
| Description | The walkthrough says "277 tests"; TEST_EVIDENCE says "264/264 passing"; the tree has 39 tracked `backend/src/**/*.test.js` files with about 365 `test(`/`it(` calls (grep count). `npm test` loads `--env-file=.env` (`backend/package.json:14`) and several suites hit Prisma, so they fail without a running Postgres (the local run in this audit failed with "database server ... localhost:5432"). The walkthrough's product steps are otherwise consistent with the code: `/agent/run` exists, ADMIN-only (`backend/src/routes/agent.routes.js:17`); the agent sweep covers exactly the two cases it describes; Copilot writes are proposal-only. |
| Steps to reproduce / Evidence | as cited; `C:\Users\thete\.claude\jobs\d1cefbb9\tmp\unit_test_out2.txt` (Prisma connection error). |
| Expected | One accurate count, and a note that DB-backed tests need the local DB. |
| Actual | Three different numbers. |
| Impact | Minor. |
| Suggested fix | Drop hard-coded counts or generate them in CI. |
| Effort | S |
| Related IDs | CF-170 |
| Audit working IDs | F-J-007 |

### CF-223

**Client decides super-admin from a `superAdmin` flag persisted in the localStorage `user` object — server re-verifies, so no security impact**

| Field | Value |
|---|---|
| Module | Frontend-Shell / Auth |
| Area | Frontend |
| Status | TECH-DEBT |
| Severity | Info |
| Confidence | Confirmed |
| Location | frontend/src/App.jsx:101-111,123-125; frontend/src/pages/Login.jsx:50; frontend/src/pages/AuthCallback.jsx:35-43; frontend/src/pages/Dashboard.jsx:2656,2668,2952,3089; backend/src/middleware/authorize.js:68-76 |
| Description | `isSuperAdmin()` reads `JSON.parse(localStorage.user).superAdmin === true`, set from the login/exchange response. Tampering it in DevTools renders the Platform Admin shell, but every `/api/v1/admin/*` call is guarded by `requireSuperAdmin` which re-checks the DB email, so nothing leaks. The stored `user` object holds only `{id,name,email,role,superAdmin,workspaceId,workspaceName}`; tokens live in the separate accessToken/refreshToken localStorage keys (standard XSS exposure, no httpOnly cookie — noted, not new). No issue beyond an empty admin shell for a tamperer. |
| Steps to reproduce / Evidence | as above. |
| Expected | n/a (observation). |
| Actual |  |
| Impact | None security-wise. |
| Suggested fix | none required. |
| Effort | S |
| Related IDs | CF-089 |
| Audit working IDs | F-H-006 |

### CF-224

**Media/voice/Instagram inbound: stored, never automated; unsupported types count as unread and reset the window**

| Field | Value |
|---|---|
| Module | Inbox |
| Area | Backend |
| Status | PARTIAL |
| Severity | Info |
| Confidence | Confirmed |
| Location | backend/src/services/inboundMessage.js:115-156, :162-165; backend/src/services/webhook.service.js:43-53, :252-256 |
| Description | Voice notes are stored as `[voice message]` with media ids but `carriesCustomerText` excludes them, so no trigger/intent/AI ever answers one (no transcription). Reactions/system/order messages become UNSUPPORTED rows that increment `unreadCount` and reset `lastInboundAt`. There is no Instagram or voice-call webhook handling; such payloads fall through `value.messages` and are dropped at :253 for an unknown `phone_number_id`. Meta error mapping for sends is reasonable (`conversations.service.js:176-195`, `campaign.worker.js:50-84`); unreachable numbers are flagged only on automated replies (`outbound.service.js:92`), not on inbox or campaign sends. |
| Steps to reproduce / Evidence | Static code trace at the cited Location lines; the trace is written out in the Description. |
| Expected | n/a |
| Actual |  |
| Impact | UX. |
| Suggested fix | n/a |
| Effort | — |
| Related IDs |  |
| Audit working IDs | F-D-014 |

### CF-225

**The OAuth provider token and revoke endpoints are sound; notes: no PKCE, and `/oauth/revoke` is not scoped to keys the calling client issued**

| Field | Value |
|---|---|
| Module | OAuth provider |
| Area | Backend |
| Status | SECURITY |
| Severity | Info |
| Confidence | Confirmed |
| Location | backend/src/services/oauth.service.js:36,161-175,212-253,279-298, backend/src/routes/oauth.routes.js:27-42 |
| Description | `exchangeAuthorizationCode` hashes and `timingSafeEqual`-compares the client secret (lines 221-223), claims the code atomically with `consumedAt: null, expiresAt > now` (line 230) and a 2-minute TTL (line 36), and matches `redirect_uri` exactly. `authorize` is limited to 60 per 15 min, `token`/`revoke` to 30 failures per 15 min, and `decide` to 30 per 15 min (subject to CF-027). There is no PKCE. That is acceptable while every client is confidential with a server-held secret, but it should be required before adding a public or SPA client. `revokeIssuedKey` authenticates the client, then revokes *any* non-revoked ApiKey whose hash matches the presented raw key (lines 289-293), not only keys issued to that client. Exploiting this requires possessing the raw key, and possession already gives full use, so the impact is nil. The consent-step authorization gap is CF-025. |
| Steps to reproduce / Evidence | Static code trace at the cited Location lines; the trace is written out in the Description. |
| Expected |  |
| Actual |  |
| Impact | None today. |
| Suggested fix | Add `oauthClientId` to the ApiKey `where`; require PKCE for any future public client. |
| Effort | S |
| Related IDs | CF-025; Lead 7 |
| Audit working IDs | F-A1-026 |

### CF-226

**prisma-schema-canonical test fails because the main checkout's generated client is stale**

| Field | Value |
|---|---|
| Module | Ops / Prisma client |
| Area | Backend |
| Status | RELIABILITY |
| Severity | Info |
| Confidence | Confirmed (for the environment used) |
| Location | backend/tests/prisma-schema-canonical.test.mjs:114, backend/scripts/prisma-schema-canonical.js, backend/scripts/ensure-prisma-client.js |
| Description | canon_test_out.txt shows 11 tests, 10 pass and 1 fail. The failing test is "current schema.prisma matches the generated client inlineSchema". The generated client lacks `ApiKey.authenticationConfig AuthenticationConfig?`, so it predates the 20260904 authentication_config change. The run resolved `@prisma/client` through a symlink from testcopy/node_modules to `D:\krishna_thete\chatflow-pro\backend\node_modules`. It therefore shows that the main checkout's client is stale, not prod's. `ensure-prisma-client.js` runs on predev, prestart and postinstall precisely to catch this, and the comparator's 10 unit cases pass. |
| Steps to reproduce / Evidence | Static code trace at the cited Location lines; the trace is written out in the Description. |
| Expected |  |
| Actual |  |
| Impact |  |
| Suggested fix | Run `npm run db:generate`. The gate is working as intended. |
| Effort | S |
| Related IDs |  |
| Audit working IDs | F-F-011 |

### CF-227

**Secrets in the tree and in history: no live credentials found; test-fixture `backend/.env.test` recoverable from history; `.env.bak` (OPEN-009) not found; `dump.rdb` empty**

| Field | Value |
|---|---|
| Module | Secrets |
| Area | Infra |
| Status | SECURITY |
| Severity | Info |
| Confidence | Confirmed |
| Location | git 538214e (added `backend/.env.test`, `backend/dump.rdb`), git 6583e26 (deleted `backend/.env.test`), backend/dump.rdb, frontend/src/pages/IntegrationsView.jsx:208, backend/test_key_gen.js |
| Description | `git log --all --name-status -- "*.env*" "*.bak" "*dump.rdb"` shows: `backend/.env.example` added and modified in early commits, then deleted (757dc81 and 11bdd29); `backend/.env.test` added in 538214e and deleted in 6583e26; `backend/dump.rdb` added in 538214e. `.env.test` (key names only, values not printed): PORT, NODE_ENV, CLIENT_URL, JSON_BODY_LIMIT, DATABASE_URL, DIRECT_URL, REDIS_URL, JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, JWT_EXPIRES_IN, JWT_REFRESH_EXPIRES_IN, ADMIN_EMAIL, BCRYPT_SALT_ROUNDS, ENCRYPTION_KEY, META_APP_ID, META_APP_SECRET, META_BUSINESS_ID, META_WABA_ID, META_SYSTEM_USER_ID, META_SYSTEM_USER_TOKEN, META_DISPLAY_NAME, META_WEBHOOK_VERIFY_TOKEN, META_API_VERSION, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, CAMPAIGN_RATE_DELAY_MS. A classifier that printed only lengths and a placeholder flag found: DB/Redis URLs point at localhost; JWT secrets, the Meta secret/token and the Google ID/secret match test/placeholder patterns and are far too short to be real (e.g. the Meta system-user token is 10 chars; real ones are 150+); ENCRYPTION_KEY is a 32-char opaque value. That key is a risk only if it was ever reused in a real environment, which could not be checked. `backend/.env.bak` (OPEN-009) exists in no commit on any ref (`--all`) and not in this worktree. `backend/dump.rdb` is 89 bytes (an empty RDB header) and is still tracked. A working-tree regex scan for Google API keys, `rzp_live\|test_`, Meta `EAA...` tokens, OpenAI `sk-`, Twilio `AC...` and PEM private keys matched only a UI input placeholder of the Razorpay Key ID shape (IntegrationsView.jsx:208; a Key ID is public anyway). `backend/test_key_gen.js` is a dev script that creates a real ApiKey on the first workspace of whatever DATABASE_URL is configured and prints the raw key to stdout. It is harmless locally but dangerous if run against production. |
| Steps to reproduce / Evidence | Static code trace at the cited Location lines; the trace is written out in the Description. |
| Expected |  |
| Actual |  |
| Impact | Low. No rotation is needed unless the fixture ENCRYPTION_KEY was ever used outside tests. |
| Suggested fix | `git rm backend/dump.rdb`, add `*.rdb` to .gitignore, and move `test_key_gen.js` under `scripts/` with a `NODE_ENV!=='production'` guard. History rewrite is optional. |
| Effort | S |
| Related IDs | Lead 18 |
| Audit working IDs | F-A1-024 |

