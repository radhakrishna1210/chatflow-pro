# ChatFlow Pro — Feature matrix

Coverage proof for the audit. One row per feature, sub-feature, tab, public API or worker. Status is one of Working, Partial, Broken, Stub, Missing or Not verified. Finding IDs point at rows in `BUG_SHEET.md`.

| Status | Rows |
|---|---|
| Working | 247 |
| Partial | 155 |
| Broken | 34 |
| Missing | 22 |
| Stub | 18 |
| Not verified | 16 |
| Other (free-text status, see row) | 7 |
| **Total** | **499** |

## 1. Home, Inbox, Campaigns, Templates, OTP product, Contacts, Analytics, Super admin, Auth screens

| Feature | UI location | Backend endpoint(s) | Status | Notes | Finding IDs |
|---|---|---|---|---|---|
| Home: greeting/date header | Dashboard.jsx:812 | — | Working | client-side | |
| Home: Next best action card | Dashboard.jsx:586-660 | GET /campaigns, GET /whatsapp/numbers | Partial | first 20 campaigns only | CF-196 |
| Home: Upgrade banner | Dashboard.jsx:849 | — | Stub | static, all plans, advertises A/B testing | CF-194 |
| Home: Wallet status banner / summary cards | WalletStatusBanner.jsx, WalletSummaryCards.jsx:12 | GET /wallet/summary | Working | | |
| Home: AI assistant chat (guided/free) | Dashboard.jsx:765-806 | POST /onboarding/chat | Partial | raw fetch; creates DRAFT/PENDING rows via raw prisma; deletes by substring | CF-021, CF-090 |
| Home: AI chat suggestion chips | Dashboard.jsx:876 | — | Working | fill prompt | |
| Home: AI chat "Login required" modal | Dashboard.jsx:769-772 | — | Working | unreachable in practice (dashboard requires login) | |
| Home: Live conversations widget | Dashboard.jsx:664-716 | GET /conversations | Working | first 20 | CF-196 |
| Home: WhatsApp number card | Dashboard.jsx:958-975 | GET /whatsapp/numbers | Working | first number only | |
| Home: Instagram card | Dashboard.jsx:978-993 | — (instagram.routes.js exists) | Stub | "Coming Soon", no handler | CF-195 |
| Home: QuickLinksGrid | components/QuickLinksGrid.jsx (used in Profile/Settings, not Home) | — | Working | nav events only | |
| Notifications: bell list | Dashboard.jsx:457 | GET /notifications | Working | 30 s poll | |
| Notifications: badge / mark all read | Dashboard.jsx:486-497 | POST /notifications/read-all | Partial | stale closure | CF-191 |
| Notifications: per-item read, unread-count | — | POST /notifications/:id/read, GET /unread-count | Not wired | | contract (c) |
| Notifications: click-through link | Dashboard.jsx:500 | — | Working | app:nav | |
| Inbox: conversation list | InboxView.jsx:258 | GET /conversations | Partial | 20 rows, no paging | CF-091 |
| Inbox: search box | InboxView.jsx:490 | (server `search` unused) | Partial | client-side over 20 | CF-091 |
| Inbox: All/Unassigned/AI-handled/Mine filters | InboxView.jsx:480-492, :520 | — | Partial | client-side | CF-091 |
| Inbox: message thread + 24h window state | InboxView.jsx:281 | GET /conversations/:id/messages | Working | 4 s poll; `{messages, window}` | CF-197 |
| Inbox: send text | InboxView.jsx:398 | POST /conversations/:id/messages | Working | credit consumed, opt-out + Meta window enforced | |
| Inbox: send template (window closed) | InboxView.jsx:419-430 | GET /templates?status=APPROVED, POST /conversations/:id/template | Working | | |
| Inbox: send media | InboxView.jsx:459 | POST /conversations/:id/media | Working | multer + verifyFileContents | |
| Inbox: AI suggest reply | InboxView.jsx:339 | POST /conversations/:id/suggest | Working | | |
| Inbox: context panel (contact, AI session) | InboxView.jsx:307 | GET /conversations/:id/context | Working | | |
| Inbox: notes add/list | InboxView.jsx:315,384 | GET/POST /conversations/:id/notes | Working | | |
| Inbox: note delete | — | DELETE /conversations/:id/notes/:noteId | Missing (UI) | | CF-198 |
| Inbox: assign to member | InboxView.jsx:354 | PATCH /conversations/:id/assign | Partial | no membership check | CF-072 |
| Inbox: resolve / reopen status | InboxView.jsx:370,657 | PATCH /conversations/:id/status | Working | | |
| Inbox: bot on/off | — | PATCH /conversations/:id/bot | Missing (UI) | | CF-198 |
| Inbox: reopen-window / inbound-simulate | — | POST …/reopen-window, …/inbound-simulate | Stub-in-prod | | CF-023 |
| Inbox: ContactDetailsPanel view/edit contact | ContactDetailsPanel.jsx:67,89 | GET/PATCH /contacts/:id | Working | | |
| Inbox: ContactDetailsPanel segment add/remove | ContactDetailsPanel.jsx:79,119,135 | GET /segments, POST /segments/:id/contacts, DELETE …/:contactId | Working | | |
| Inbox: realtime | — | — | Missing | polling only | CF-197 |
| Campaigns: list (regular/authentication tabs) | Dashboard.jsx:1323 | GET /campaigns?type= | Working | retried/retrying counts server-derived | |
| Campaigns: list search | Dashboard.jsx:1340 | — | Working | client-side over page (limit 20) | |
| Campaigns: live polling while RUNNING | Dashboard.jsx:1356 | GET /campaigns | Working | | |
| Campaigns: detail modal counters/report | Dashboard.jsx:1043-1312 | GET /campaigns/:id | Working | 100 recipients max | CF-144 |
| Campaigns: retry status per recipient | Dashboard.jsx:1021-1040 | GET /campaigns/:id (report.retry*) | Working | | |
| Campaigns: button-click / reply tracking in report | Dashboard.jsx:1163-1175 | GET /campaigns/:id (buttonClicks) | Working | URL buttons honestly marked UNAVAILABLE | |
| Campaigns: cancel | Dashboard.jsx:1071 | PATCH /campaigns/:id/cancel | Working | refund of unsent via billedCount | |
| Campaigns: pause/resume | Dashboard.jsx:1083,1294-1295 | PATCH /campaigns/:id/pause|resume | Partial | UI only for AUTHENTICATION | CF-143, CF-166 |
| Campaigns: edit draft | Dashboard.jsx:1297 -> CreateCampaign | PATCH /campaigns/:id, PUT /campaigns/:id/recipients | Working | | |
| Campaigns: export/report download | — | — | Missing | | CF-144 |
| Campaigns: recipients list (full) | — | — | Missing | first 100 only | CF-144 |
| Wizard step 1: name/number/template | CreateCampaign.jsx:1546-1554 | GET /contacts, /whatsapp/numbers, /templates | Working | AUTHENTICATION templates hidden | CF-145 |
| Wizard: audience from list | CreateCampaign.jsx:475 | GET /contacts | Working | | |
| Wizard: audience manual entry | CreateCampaign.jsx:458 | POST /contacts | Working | | |
| Wizard: audience CSV upload | CreateCampaign.jsx:389 | POST /contacts/import | Working | | |
| Wizard: audience cluster | CreateCampaign.jsx:419-434 | GET /clusters, /clusters/:id | Working | | |
| Wizard: audience segment | CreateCampaign.jsx:479 | — | Stub | tab disabled | CF-143 |
| Wizard: template variables/media preview | CreateCampaign.jsx:1298 | GET /templates/media/:assetId | Working | | |
| Wizard: cost estimate | CreateCampaign.jsx:1663 | POST /campaigns/estimate | Working | valid/dup/blocked/invalid buckets, category rate | |
| Wizard: scheduling | CreateCampaign.jsx:688-721,1729 | PATCH /campaigns/:id (scheduledAt), POST …/launch | Working | past-date rejected server-side | |
| Wizard: launch (charge + queue) | CreateCampaign.jsx:1777 | POST /campaigns/:id/launch | Working | idempotent via chargedAt claim + ledger key | |
| Wizard: AI agent step | CreateCampaign.jsx:822,1557 | GET /ai-agent/agents; aiAgent in create/update | Working | deployed-agent check server-side | |
| Wizard: reply flows (step 6) | CreateCampaign.jsx:921 | stored in campaign.replyRules | Stub | never executed | CF-054 |
| Wizard: retries (step 7) | CreateCampaign.jsx:1028 | retryConfig -> lib/retry.js, retry.service.js | Working | consumed by retry.service | |
| Wizard: conversion tracking (step 8) | CreateCampaign.jsx:1135 | stored in campaign.trackingConfig | Stub | never used; not restored on edit | CF-054 |
| Wizard: SMS/email fallback (step 9) | CreateCampaign.jsx:1191-1260 | GET /campaigns/fallback-capabilities; fallback.service.js:82 | Working (gated) | capability flags from env | |
| Wizard: review checklist | CreateCampaign.jsx:1870-1910 | — | Working | | |
| CampaignAI.jsx (utility variant helper) | Dashboard.jsx:1473 | POST /templates/:id/utility-variant | Working | | |
| Campaign billing: per-recipient claim/refund | campaignBilling.service.js | — | Working | billedAt idempotent | |
| Templates: list (+deleted tab) | Dashboard.jsx:1846 | GET /templates[?status=DELETED] | Working | | |
| Templates: search | Dashboard.jsx:2389 | — | Working | client | |
| Templates: create (modal) | TemplateModal.jsx:495 | POST /templates | Working | Zod + Meta submit | |
| Templates: edit | TemplateModal.jsx:491 | PUT /templates/:id | Broken for APPROVED/PENDING | Meta not updated | CF-112 |
| Templates: delete / restore | Dashboard.jsx:1820,1876 | DELETE /templates/:id, POST …/restore | Working | tombstone + Meta delete best-effort | |
| Templates: duplicate | — | POST /templates/:id/duplicate | Missing (UI) | | contract (c) |
| Templates: Meta sync | Dashboard.jsx:1942 | POST /templates/sync-from-meta | Working | | |
| Templates: library browse/install | Dashboard.jsx:1901,1920 | GET /templates/library, POST …/:libId/install | Working | static data/templateLibrary.js | |
| Templates: AI draft / suggestions | TemplateModal (seed) / Dashboard | POST /templates/ai/draft, GET /templates/ai/suggestions | Working | | |
| Templates: AI header image | TemplateModal.jsx:294-320 | POST /templates/ai/image, POST /templates/media (assetId) | Working | | |
| Templates: media upload | TemplateModal.jsx:405 | POST /templates/media | Working | uploadGuard | |
| Templates: header image fetch | TemplateModal.jsx:181, TemplatePreviewModal.jsx:28 | GET /templates/media/:assetId | Working | | |
| Templates: utility variant | Dashboard.jsx:1473 | POST /templates/:id/utility-variant | Working | | |
| Templates: status webhook | — | webhook.service.js:30 `message_template_status_update` | Working | | |
| Templates: TemplateModuleTabs | components/TemplateModuleTabs.jsx | — | Dead code | | CF-180 |
| Authentication: config get/save | AuthenticationDashboard.jsx:768,811 | GET/PATCH /authentication | Working | template+number required | |
| Authentication: API key view/rotate | AuthenticationDashboard.jsx:857,901 | GET /api-keys/authentication, POST …/rotate | Working | | |
| Authentication: analytics KPIs | AuthenticationDashboard.jsx:348 | GET /authentication/analytics | Partial | all-time | CF-043 |
| Authentication: transactions table + filters + search | AuthenticationDashboard.jsx:337-440 | GET /authentication/analytics (recent 20) | Partial | | CF-043 |
| Authentication: generate/verify API | — (external) | POST /authentication/generate|verify (API key) | Not verified here | area B/D | |
| Authentication: OTP campaign creation | — | — | Missing (UI) | | CF-145 |
| Authentication: WhatsAppAuthOtp model | schema.prisma:1206 | — | Dead | | CF-180 |
| Authentication: check-*auth*-templates.mjs scripts | backend/check-auth-templates.mjs, check-all-auth-templates.mjs | — | Not verified | dev scripts, not wired to npm | |
| Authentication: tests/otp-scope.test.mjs | backend/tests | — | Not verified | not executed (read-only run) | |
| Contacts: list/paging/sort/filters | ContactsView.jsx:688 | GET /contacts?… | Working | limit=all -> 10 000 cap | |
| Contacts: create/edit/delete | ContactsView.jsx:81,321,375 | POST/PATCH/DELETE /contacts[/:id] | Working | Zod strict update | |
| Contacts: bulk delete | ContactsView.jsx:425 | DELETE /contacts/:id (loop) | Working | N requests | |
| Contacts: tags | ContactsView.jsx:710 | GET /contacts/tags | Working | | |
| Contacts: CSV import | ContactsView.jsx:143 | POST /contacts/import | Working | raw fetch; plan-limit checked | CF-088 |
| Contacts: CSV export | — | GET /contacts/export | Missing (UI) | | contract (c) |
| Contacts: sample CSV | ContactsView.jsx:160 | — | Working | client blob | |
| Contacts: clusters create/list | ContactsView.jsx:514,706 | POST/GET /clusters | Working | | |
| Contacts: cluster edit/delete | — | PUT/PATCH/DELETE /clusters/:id | Missing (UI) | | CF-152 |
| Contacts: segments list | ContactsView.jsx:708 | GET /segments | Working | static lists | CF-218 |
| Blocked numbers: list/keywords/unblock/export | BlockedNumbers.jsx:37-101 | GET /blocked-numbers, /keywords, POST /unblock, GET /export | Working | | |
| Blocked numbers: manual block | — | POST /blocked-numbers | Missing (UI) | | CF-152 |
| ImportExport.jsx (CRM entities) | ImportExport.jsx:28-65 | GET /crm-data/export/:entity, POST /crm-data/import/leads[/preview] | Working | area C-crm | |
| Analytics: overview | AnalyticsView.jsx:57 | GET /analytics/overview | Partial | opt-out denominator | CF-124, CF-125 |
| Analytics: delivery chart | AnalyticsView.jsx:58 | GET /analytics/delivery | Partial | server-TZ buckets | CF-125 |
| Analytics: campaigns table | AnalyticsView.jsx:59 | GET /analytics/campaigns | Working | last 8 | |
| Analytics: agents | AnalyticsView.jsx:60, UserAnalyticsView.jsx:140 | GET /analytics/agents | Partial | messages not chats | CF-126 |
| Analytics: performance funnel/resolution | AnalyticsView.jsx:127 | GET /analytics/performance | Partial | mixed populations | CF-127 |
| Analytics: insights | AnalyticsView.jsx:133, ChatAnalytics.jsx:120 | GET /analytics/insights | Working | heuristic | CF-217 |
| Analytics: chat analytics | ChatAnalytics.jsx:97 | GET /analytics/chat | Working | IST hard-coded | CF-125 |
| Analytics: audience (user analytics) | UserAnalyticsView.jsx:139 | GET /analytics/audience?weeks= | Working | | |
| Analytics: paid messages | — | GET /analytics/paid-messages | Not wired (this area) | | |
| Analytics: workspace scoping | analytics.service.js | all queries `workspaceId` filtered | Working | | |
| Super admin: stats | SuperAdminView.jsx:1314 | GET /admin/platform/stats | Working | | no issue |
| Super admin: workspaces list/analytics/suspend | :1315,796,1340 | GET …/workspaces, …/workspaces/analytics, PATCH …/:id/suspend | Working | | |
| Super admin: workspace members/invitations | :1130-1158 | GET …/:id/members, DELETE …/invitations/:id | Working | invite-create endpoints unused | no issue |
| Super admin: tickets | :1316,1347 | GET/PATCH /admin/platform/tickets | Working | | |
| Super admin: plans CRUD | :108,1317,1353 | GET/POST/PATCH/DELETE /admin/platform/plans | Working | validated in service | |
| Super admin: audit log | :293-295 | GET /admin/platform/audit[/actions|/summary] | Working | | |
| Super admin: revenue / transactions / payments | :401,462,1034 | GET …/revenue, …/transactions, …/payments | Working | | |
| Super admin: campaigns (all) | :565 | GET /admin/platform/campaigns | Working | | |
| Super admin: users + impersonate | :911,920 | GET …/users, POST …/users/:id/impersonate | Working | audited | |
| Super admin: number pool (assign/reset/ban/unban/sync/reset-all) | :650-702 | /admin/numbers/* | Working | add/request-otp/verify-otp unused | no issue |
| Super admin: API management (settings) | ApiManagementTab.jsx:82,107 | GET/POST /admin/platform/settings | Working | key whitelist + masking | |
| Super admin: webhooks inspect/repair, credential-check | — | GET/POST /admin/platform/webhooks[/repair], GET …/credential-check | Missing (UI) | | no issue |
| API keys: send test message | ApiKeysView.jsx:398 | POST /api-keys/test-message | Broken | 404 | CF-040 |
| Auth: login | Login.jsx:41 | POST /auth/login | Working | | no issue |
| Auth: register start/verify/resend | Register.jsx:85-122 | POST /auth/register/* | Working | | |
| Auth: invite token preview | Register.jsx:41, InviteAccept.jsx:32 | GET /invitations/:token | Working | | |
| Auth: invite accept | InviteAccept.jsx:70 | POST /invitations/:token/accept | Working | | |
| Auth: forgot/reset password | ForgotPassword.jsx:42-71 | POST /auth/forgot-password, /auth/reset-password | Working | | |
| Auth: OAuth exchange callback | AuthCallback.jsx:25 | POST /auth/exchange | Working | | |
| Auth: workspace setup | WorkspaceSetup.jsx:97-111 | PATCH /settings, POST /ai-agent/config, POST /workspaces | Working | | |
| Auth: OAuth consent screen | OAuthConsent.jsx:101,128 | GET /oauth/consent-info, POST /oauth/consent/decide | Working | | |
| Public form | PublicForm.jsx:70,87 | GET/POST /forms/:workspaceId/:slug | Working | | |
| Landing pricing | Landing.jsx:393 | GET /pricing | Working | | |
| Token refresh | lib/api.js:48 | POST /auth/refresh | Working | | |

## 2. Messaging correctness (WhatsApp / Meta)

| Feature | UI location | Backend endpoint(s) | Status | Notes | Finding IDs |
|---|---|---|---|---|---|
| Inbound message routing chain (opt-out → … → AI agent → auto-reply) | — | POST /api/v1/webhook/meta → webhook.service.js handleInboundMessage | Working | Priority order matches the documented chain | CF-094, CF-116 |
| Meta webhook HMAC + fast 200 ACK | — | POST /api/v1/webhook/meta | Partial | Verified correctly; processing after ACK is fire-and-forget, failures lose the event | CF-116 |
| Inbound idempotency (metaMessageId unique) | — | webhook.service.js message create | Working | P2002 on redelivery short-circuits the automation chain | — |
| Campaign reply attribution (CTA payload / reply context) | Campaign analytics | webhook.service.js:356-368 | Broken | `workspaceId` referenced before its declaration; ReferenceError swallowed | CF-024 |
| Status webhooks (sent/delivered/read/failed) | Campaign detail, Inbox ticks | webhook.service.js handleStatusUpdate | Partial | FAILED overrides READ; late delivered/read overrides RETRYING/FAILED | CF-146 |
| Retry and fallback trigger on failure | Campaign wizard retries/fallback | retry.service.js, fallback.service.js | Partial | Retries claim-guarded; SMS fallback unmetered and ignores opt-out | CF-056, CF-057, CF-058 |
| 24h customer-service window enforcement | Inbox composer | conversations.service.js, outbound.service.js, messagingWindow.js | Partial | Inbox sends fabricate a new window; debug endpoints forge one | CF-022, CF-023 |
| Template sends outside the window | Inbox template, campaigns | templatePayload.service.js, lib/templateParams.js | Working | Parameter building and button limits verified | — |
| Opt-out (STOP) handling and checks | Settings → Blocked numbers | optout.service.js; Contact.optedOut vs OptOut table | Partial | Disjoint sources; sequences and SMS fallback miss the OptOut table | CF-205, CF-028, CF-056 |
| Closed conversation reopening on inbound | Inbox | webhook.service.js | Broken | CLOSED/RESOLVED never reopen; OOO fires on closed threads | CF-092 |
| Phone normalisation / contact match | Inbox, Contacts | webhook.service.js:270-305 | Partial | Fuzzy path safe; national-format contacts duplicate | CF-200 |
| Token decryption failure handling | all sends | lib/encryption.js callers | Partial | Credit leaked when decrypt throws after consume | CF-093, CF-104 |
| Media / voice / Instagram inbound | Inbox | inboundMessage.js | Partial | Stored but never automated; unsupported types reset window | CF-224 |
| Public API send | — | POST /api/v1/public/messages | Broken | Crashes without `template`; unmetered; no Message row | CF-026, CF-002 |
| Sequences send | Sequences | workers/sequence.worker.js | Broken | Meta failures recorded as DELIVERED; no window/credit check | CF-028 |

## 3. CRM

| Feature | UI location | Backend endpoint(s) | Status | Notes | Finding IDs |
|---|---|---|---|---|---|
| CRM Overview KPI cards | CrmDashboardView.jsx:59-88 | GET /crm-analytics | Partial | No visibility scope; range affects only lead metrics | CF-079 |
| Overview "My / All" toggle | CrmDashboardView.jsx:60 | GET /crm-analytics?userId= | Partial | Client-supplied userId; leads not filtered by user | CF-079 |
| Overview 6-month chart, stage donut, top deals | CrmDashboardView | GET /crm-analytics | Partial | Custom stages counted as Qualification | CF-079, CF-068 |
| Overview overdue tasks panel | CrmDashboardView.jsx:65 | GET /tasks?isOverdue=true | Working | List is scoped | CF-079 (by-id only) |
| Overview NBA badge/widget | NextBestActions.jsx:39 | GET /insights/recommendations | Working | scopeFilter applied (nextBestAction.service.js:43-45) | - |
| Custom report builder / run | CrmDashboardView.jsx:102 | POST /crm-analytics/reports/query | Partial | Unvalidated filters 500; no scope | CF-076 |
| Saved custom reports (save/delete) | CrmDashboardView.jsx:141-166 | GET/POST/DELETE /crm-analytics/reports/saved | Partial | Any CLIENT deletes anyone's report | CF-076, CF-062 |
| Integration Health modal | CrmIntegrationHealthModal.jsx | GET /crm-analytics/integration-health | Stub | Hard-coded HEALTHY/latency/uptime | CF-077, CF-163 |
| CrmDashboardWidgets component | (none) | GET /crm-analytics, /tasks | Stub (dead code) | Not imported anywhere | CF-180 |
| Sales Inbox conversation pane / polling | CrmSalesInboxView.jsx:320-341 | conversations endpoints | Not verified | 4 s polling; inbox internals owned by Inbox auditor | - |
| Sales Inbox "Sync Window" / "+ Inbound Hii" | CrmSalesInboxView.jsx:448-483 | conversations reopen-window / simulate-inbound | Broken (security) | Forges 24h window and fake inbound in prod | CF-023 |
| Sales Inbox segment counts (HOT/WARM/COLD) | CrmSalesInboxView.jsx:172 | GET /crm-sales-inbox/segments | Partial | Stale categories; null category not counted | CF-075 |
| Segment audience review | CrmSalesInboxView.jsx:344-362 | GET /crm-sales-inbox/audience-review | Partial | Unbounded, unscoped, custom status 500 | CF-080 |
| Launch bulk segment campaign | CrmSalesInboxView.jsx:568-603 | POST /crm-sales-inbox/launch-bulk-campaign | Partial | Opt-out/phone filtered, billing via campaign engine; orphan drafts on failure; no Zod | CF-080 |
| Segment campaign analytics | CrmSalesInboxView.jsx:238 | GET /crm-sales-inbox/campaign-analytics | Partial | All campaigns, skipped labelled opted-out | CF-080 |
| Recalculate lead category | CrmSalesInboxView.jsx:557 | POST /crm-sales-inbox/leads/:id/recalculate-category | Partial | No role check | CF-080, CF-075 |
| Enrol lead/segment in sequence (Sales Inbox) | CrmSalesInboxView.jsx:609-633 | POST /sequences/:id/enroll | Partial | >1000 leads -> 400 | CF-162 |
| Leads list, search, sort, filters | LeadsView.jsx | GET /leads | Partial | Status filter drops visibility scope | CF-015 |
| Add lead | LeadsView.jsx | POST /leads | Partial | Bypasses contact plan limit | CF-016, CF-073 |
| Edit lead / custom lifecycle status | LeadsView.jsx | PATCH /leads/:id | Working | statusKey mapping, XP on QUALIFIED | CF-157 |
| Delete lead / bulk delete | LeadsView.jsx | DELETE /leads/:id, POST /leads/bulk-delete | Working | CLIENT allowed (contradicts permission matrix) | CF-078 |
| Bulk assign | LeadsView.jsx | POST /leads/bulk-assign | Partial | No Zod, no membership check | CF-158 |
| Bulk status / bulk category | LeadsView.jsx:1235 | POST /leads/bulk-status, /bulk-category | Broken (custom statuses) | Prisma enum 500 | CF-158 |
| Bulk create task | BulkTaskModal.jsx | POST /leads/bulk-task | Broken | `priority` column missing -> 500 | CF-017 |
| Lead score, breakdown, recalculate | LeadsView.jsx:79, :548 | POST /leads/:id/recalculate-score | Partial | Never auto-refreshed | CF-075 |
| Convert lead to deal | LeadsView convert modal | POST /leads/:id/convert | Partial | Unscoped, race -> duplicate deals | CF-071 |
| Lead distribution rules | LeadsView distribution panel | GET/POST /lead-distribution/rules | Partial | Unvalidated JSON, foreign pool ids | CF-073, CF-074 |
| Batch auto-distribute | LeadsView | POST /lead-distribution/distribute | Partial | Round-robin race | CF-073 |
| Saved views (Leads & Deals) | SavedViews.jsx | GET/POST/DELETE /saved-views | Broken | Enum mismatch 400; list leaks config rows | CF-018, CF-062 |
| Lead CSV import (preview + run) | ImportExport.jsx:44, :65 | POST /crm-data/import/leads/preview, /import/leads | Partial | Sync loop, no row cap, owner unchecked, no contact limit | CF-016, CF-069 |
| CRM CSV export (leads/deals/tasks/products) | ImportExport.jsx:88 (Leads, Deals) | GET /crm-data/export/:entity | Partial | Formula-safe; custom stage lost; button shown to non-admins (403) | CF-069, CF-078 |
| Deals Kanban drag/drop + keyboard nudge | DealsView.jsx:491-519, :578 | PATCH /deals/:id/stage | Working | Optimistic with rollback; history in same tx; any string accepted as stage | CF-068 |
| Deals stage-filtered list / table | DealsView.jsx | GET /deals?stage= | Broken | Drops deals with custom fields; drops scope | CF-065, CF-015 |
| Create deal | DealsView | POST /deals | Partial | Owner not membership-checked; stage unvalidated | CF-068 |
| Deal detail / edit | DealsView detail modal | GET/PATCH /deals/:id | Working | Scoped; custom fields validated | CF-063 (field types) |
| Deal stage history timeline | DealsView detail | GET /deals/:id | Working | Converted deals lack toStageKey | CF-071 |
| Deal line items | DealsView detail | GET/POST/PATCH/DELETE /deals/:id/line-items | Partial | Unscoped; stale value after last delete; overflow 500 | CF-155 |
| Deal health dots / factor panel | DealsView cards | (computed in GET /deals, /deals/:id) | Partial | Custom stages read as enum | CF-068 |
| Relationship card | RelationshipCard.jsx:40 | GET /insights/relationship/:contactId | Working | Pure banding; polluted by simulated inbound | CF-023 |
| Deal Mode automatic follow-up task | (stage change) | internal autoGenerateDealTaskOnStageChange | Working | Priority stored as text only | CF-017, CF-154 |
| Pipeline stages (label/probability/order) | ForecastView.jsx:56, :140 | GET/PATCH /pipeline-stages, reorder | Partial | Only 6 built-ins drive forecast | CF-068, CF-064 |
| Forecast | ForecastView.jsx:132 | GET /forecast | Partial | Custom stages weighted 10% | CF-068 |
| Custom fields admin | CustomFields.jsx (Forecast view) | /custom-fields, /custom | Broken | 8 of 12 types rejected; SELECT 500 | CF-063 |
| Tasks list (Pending/Completed/Overdue) | TasksView.jsx:60-80 | GET /tasks | Working | Scoped list; no pagination | CF-079 |
| Create task | TasksView.jsx:21 | POST /tasks | Working | Refs + assignee membership-checked | CF-157 (past due farm) |
| Complete / reopen task | TasksView.jsx:93 | PATCH /tasks/:id | Partial | By-id unscoped; XP farmable | CF-079, CF-157 |
| Delete task | (no UI caller) | DELETE /tasks/:id | Partial | Unscoped; no button in TasksView | CF-079 |
| Engagements "Log" modal | EngagementsView.jsx:222 | POST /activities | Broken | Structured fields stripped by Zod | CF-066 |
| Engagements tabs / list | EngagementsView.jsx:145-157 | GET /activities | Partial | Unscoped; Visits == Video Calls; `/leads?limit=100` limit ignored | CF-067 |
| Log interaction (call/visit outcomes) | LogInteractionModal.jsx:42-90 | GET /crm-customization/call_outcomes, visit_outcomes; POST /activities | Partial | Works via content parsing; fuzzy outcome match | CF-066, CF-154 |
| Products list / create / edit | ProductsView.jsx:36-52, :112 | GET/POST/PATCH /products | Working | Server-side validation; SKU check-then-act (P2002 500 on race); currency not editable in UI | CF-155 |
| Product delete / deactivate | ProductsView.jsx:125 | DELETE /products/:id | Working | Deactivates when used; inactive still addable to deals | CF-155 |
| Quotes (CRUD, lines, status) | QuotesView.jsx | /quotes, /quotes/:id/line-items, /quotes/:id/status | Partial | Number race 500; Send/Expired manual; no PDF | CF-160 |
| Sequence builder (create/edit) | SequencesView.jsx:171 | POST/PATCH /sequences | Not verified (engine) | Step Zod present; runner owned by Workflow auditor | - |
| Sequence publish / pause | SequencesView.jsx:444 | PATCH /sequences/:id/status | Working | Enum-validated | - |
| Sequence enrol / unenrol | SequencesView.jsx:260, :344 | POST /sequences/:id/enroll, DELETE .../enrollments/:eid | Partial | P2002 race 500; unenroll ignores :id | CF-162 |
| Lead form builder | LeadFormsView.jsx:580-627 | GET/POST/PATCH/DELETE /lead-forms | Working | Field defs validated; owner unchecked | CF-070 |
| Lead form submission log | LeadFormsView.jsx:504 | GET /lead-forms/:id | Working | Answers (PII) visible to VIEWER | CF-070 |
| Public form page (render) | PublicForm.jsx:70 | GET /api/v1/forms/:workspaceId/:slug | Working | 60/min rate limit; inactive == 404 | - |
| Public form submit (honeypot, consent, dedupe) | PublicForm.jsx:87 | POST /api/v1/forms/:workspaceId/:slug | Partial | Honeypot/consent/hashing OK; P2002 race; no distribution; no contact limit | CF-016, CF-070 |
| Tickets list / views / counts | TicketsView.jsx:108, :367-368 | GET /tickets, /tickets/counts | Partial | Covered in part 2 | CF-081 |
| Ticket status transitions + SLA countdown | TicketsView.jsx:249 | PATCH /tickets/:id/status | Partial | Category SLA ignored; no first-response stamp | CF-081 |
| Teams admin (CRUD + members) | TeamsAdmin.jsx:48-60 | /teams, PUT /teams/:id/members | Working | ADMIN-only; membership validated (teams.service.js:50-70) | - |
| Record visibility ALL/TEAM/OWN | TeamsAdmin.jsx:52 | GET/PATCH /teams/visibility | Partial | Setting works; enforcement bypassed on many paths | CF-015, CF-067, CF-080, CF-071, CF-079, CF-155, CF-079 |
| Progress panel (level, streak, missions, achievements) | ProgressPanel.jsx:280 | GET /progress/me | Partial | 4 achievements unreachable | CF-157 |
| Leaderboard | ProgressPanel.jsx:220 | GET /progress/leaderboard | Partial | No opt-in toggle; farmable XP | CF-157 |
| Command palette navigation | CommandPalette.jsx:11 | (static) | Working | - | - |
| Global CRM search | CommandPalette.jsx:94 | GET /search | Working | Scope correctly AND-ed; custom stage shown as base enum | - |
| Next-best-action list | NextBestActions.jsx | GET /insights/recommendations | Working | Scoped, limit clamped 1-50 | - |
| Customize: Lead Lifecycle | CustomizeBusinessView.jsx:15 | GET/PUT /crm-customization/lead_lifecycle | Partial | No role check; manual create only | CF-014, CF-064, CF-154 |
| Customize: Prospecting Criteria | CustomizeBusinessView.jsx:16 | .../prospecting_criteria | Partial | Enforced only in createLead/updateLead | CF-154, CF-014 |
| Customize: Deal Mode | CustomizeBusinessView.jsx:17 | .../deal_mode | Working | Auto-task on stage change | CF-154, CF-017 |
| Customize: Lead Tags | CustomizeBusinessView.jsx:18 | .../lead_tags | Partial | UI-only; backend accepts any tag | CF-154 |
| Customize: Lead Sources | CustomizeBusinessView.jsx:19 | .../lead_sources | Partial | Forms/import bypass | CF-154 |
| Customize: Call Outcomes | CustomizeBusinessView.jsx:20 | .../call_outcomes | Partial | Substring matching | CF-154 |
| Customize: Visit Outcomes | CustomizeBusinessView.jsx:21 | .../visit_outcomes | Partial | Substring matching; Visits tab == MEETING | CF-154, CF-067 |
| Customize: Deal Setup (stages, probabilities) | CustomizeBusinessView.jsx:22 | .../deal_setup | Partial | Deletes stages in use; any role | CF-014, CF-064, CF-068 |
| Customize: Tickets Customization | CustomizeBusinessView.jsx:23 | .../ticket_customization | Partial | slaHours ignored | CF-081, CF-154 |
| Customize: document_categories section | (no tab) | .../document_categories | Stub | Dead config | CF-154 |
| Customize: reset / check-delete | CustomizeBusinessView.jsx:105, :134 | POST .../reset, GET .../check-delete | Partial | Reset by any role; check advisory only | CF-014, CF-064 |
| CRM permissions endpoint / matrix | (no caller) | GET /crm-permissions/my | Stub | Unused, contradicts route guards | CF-078 |
| Campaign-reply -> lead (campaignLeads) | (automatic) | internal | Not verified | Only scoring/category calls traced | CF-075, CF-016 |
| AI chatbots entry in CRM nav | Dashboard.jsx:2543 | /ai-agents | Not verified | Out of this pass (AI auditor) | CF-062 |
| CRM docs | docs/ADVANCED_CRM_*.md | - | Partial (drift) | Both under- and over-claiming | CF-156 |
| CRM automated tests | backend/src/services/*.test.js | - | Partial | Service-only; assert fabricated values | CF-163 |
| stepChange.test.mjs | frontend/src/pages | - | Stub | Stale copy of AutomationView logic | CF-180 |

## 4. AI, Automation and Connect

| Feature | UI location | Backend endpoint(s) | Status | Notes | Finding IDs |
|---|---|---|---|---|---|
| WhatsApp AI Agent - config (name/persona/purpose/instructions/safety/languages) | AutomationView.jsx `WhatsAppAIAgentTab` :2112 | GET/PATCH /ai-agent/config | Working | Length-capped, readiness recomputed | - |
| WhatsApp AI Agent - Deploy / Undeploy | AutomationView.jsx:2213-2214 | POST /ai-agent/deploy, /undeploy | Working | Refuses empty prompt / no LLM | - |
| WhatsApp AI Agent - knowledge upload (doc) | AutomationView.jsx:2229 | POST /ai-agent/knowledge/upload | Working | Appends to 12k text column, reports truncation | - |
| WhatsApp AI Agent - URL knowledge sources | AutomationView.jsx:2168-2260 | GET/POST/DELETE /widgets/knowledge | Partial | Indexed for widget only; WhatsApp agent never retrieves them; readiness counts them | CF-118, CF-117 |
| WhatsApp AI Agent - Test lab (general + campaign mode) | AutomationView.jsx:2271 | POST /ai-agent/test | Working | Honest `{ok:false}` without LLM; grounding score | - |
| WhatsApp AI Agent - campaign usage panel | AutomationView.jsx:2173 | GET /ai-agent/campaigns | Working | | - |
| WhatsApp AI Agent - escalation rules | AutomationView / AiAgentsView Setup modal | PATCH /ai-agent/config | Working | Read at runtime webhook.service.js:672 | - |
| WhatsApp AI Agent - escalation threshold | AiAgentsView.jsx:200-210 | PATCH /ai-agent/config | Stub | Stored, never read | CF-118 |
| WhatsApp AI Agent - runtime reply on inbound | (webhook) | webhook.service.js:778 → generateAgentReply | Working | History + business + campaign context | - |
| AI Intent Matching toggle + threshold | AutomationView.jsx:1846 | PATCH /ai-agent/intent-matching | Working | LLM classifier or Jaccard fallback | - |
| Intent rules CRUD | AutomationView.jsx:1696-1869 | /intents (CLIENT for writes) | Working | Runtime routeByIntent at webhook.service.js:699 | - |
| Intent test + accuracy | AutomationView.jsx:1816,1837 | GET /intents/accuracy, POST /intents/test | Working | | - |
| AI Agents studio - list/create/edit/delete agents | AiAgentsView.jsx:74-283 | /ai-agents | Partial | Stored in SavedView JSON; no Zod; finance defaults | CF-035, CF-037 |
| AI Agents studio - guidelines / actions catalogue | AiAgentsView.jsx:87,100 | GET /ai-agents/guidelines, /actions | Working | Static lists | - |
| AI Agents studio - test lab | AiAgentsView.jsx:314 | POST /ai-agents/:id/test | Stub | Canned replies w/o LLM; keyword "actions"; errors hidden | CF-035 |
| AI Agents studio - execute action | (no UI) | POST /ai-agents/actions/execute | Broken | qualify_lead crashes; escalate no-op; unscoped ids | CF-003/003/004 |
| AI Agents studio - channel cards (WhatsApp/Website/Instagram) | AiAgentsView.jsx:126-190 | GET/PUT /ai-agents/channels | Stub | Only whatsapp syncs to workspace; status synthetic | CF-036 |
| AI Agents studio - FAQ knowledge add | AiAgentsView.jsx:350 | POST /widgets/knowledge | Working | Feeds widget corpus | CF-118 |
| AI Agents studio - Setup modal (language/sensitivity) | AiAgentsView.jsx:200 | PATCH /ai-agent/config | Partial | threshold unused | CF-118 |
| Copilot - ask | Copilot.jsx:113 (CRM tabs) | POST /copilot/ask | Working | 5-step read-only loop, rate-limited | CF-167 |
| Copilot - confirm proposal | Copilot.jsx:140 | POST /copilot/confirm (CLIENT) | Working | Write registry re-validated | - |
| Autonomous agent - Agent tab history | AgentTab.jsx:108 (Leads/Deals) | GET /agent/history/:type/:id | Working | | - |
| Autonomous agent - accept/reject suggestion | AgentTab.jsx:55 | PATCH /agent/facts/:id (CLIENT) | Working | | - |
| Autonomous agent - pending/queue admin view | none | GET /agent/pending | Missing | No UI | CF-046 |
| Autonomous agent - run now | none | POST /agent/run (ADMIN) | Missing | No UI | CF-046 |
| Autonomous agent - sweeps + tick worker | (worker) | agent.worker.js | Partial | Always-on, all tenants, take 500 | CF-046 |
| Autonomous agent - evidence ledger / SENSITIVE deny | (service) | agent.tools.js / agent.evidence.js | Working | Verified evidence; deny-list enforced | - |
| Campaign AI (product page) | CampaignAI.jsx | none (static marketing) | Working | Static content from siteContent.js | - |
| Campaign AI runtime (CTA sessions, replies) | CreateCampaign.jsx:1557 (agent picker) | /ai-agent/agents; webhook handleCampaignAiInbound | Working | Not deep-traced (Campaigns area) | - |
| Site assistant chat (public) | SiteAssistant.jsx:149 (App.jsx:274) | POST /assistant/chat | Working | Rate-limited, retrieval-grounded, refusals | - |
| Site assistant status / reindex | (Super admin) | GET /assistant/status, POST /assistant/reindex | Working | reindex super-admin only | - |
| Website analysis → recommended workflows | AutomationView.jsx:799 (URL in AI prompt) | POST /automation/workflows/ai-preview | Working | DNS-safe crawler; needs Gemini | - |
| AI workflow preview (text prompt) | AutomationView.jsx:799,836 | POST /automation/workflows/ai-preview | Partial | Fallback template; saved active | CF-135 |
| AI workflow compiler | none | POST /workflows/compile, GET /workflows/vocabulary | Missing (UI) | Unused duplicate | CF-135 |
| AI onboarding chat | AIOnboardingCard.jsx (unmounted) | POST /onboarding/chat | Missing (UI) | Dead | CF-180 |
| AI routes (template/campaign create/update) | none | POST /ai/template/create etc. | Not verified | No frontend caller except workflow/execute | CF-180 |
| Workflow tester | AutomationView.jsx:776 | POST /ai/workflow/execute → simulateWorkflow | Working | Real trace | - |
| Template AI suggestions/draft | TemplateModal (Templates area) | GET /templates/ai/suggestions, POST /templates/ai/draft | Working | Honest fallback flag | - |
| Template AI header image | TemplateModal | POST /templates/ai/image | Working | 503 when no provider | - |
| Basic automations (welcome/OOO/delayed + hours) | AutomationView `BasicAutomationsTab` | GET/PATCH /automation/basic | Working | Plan-gated `automation` | - |
| Keyword triggers CRUD | `CustomAutoReplyTab` | /automation/triggers | Working | CLIENT writes | - |
| Workflows list/create/edit/delete/toggle | `WorkflowsTab` :505-900 | /workflows | Partial | `nodes: z.any()`, 20-step silent cap, edges unused | CF-044 |
| Workflow builder - keyword/welcome triggers | :1122 | engine triggerFires | Working | | - |
| Workflow builder - missed-call trigger | :1122 | none emits | Stub | | CF-045 |
| Workflow builder - CRM triggers (lead_created/lead_status/deal_stage/score_above) | :1125-1128 | workflowCrm.service emitCrmEvent callers | Working | Emitted from leads/deals services | - |
| Workflow builder - conditions (skip-count) | :1090-1186 | workflowConditions.js | Working | Skip semantics, not branches | - |
| Workflow actions message/template/buttons/tag/agent | :1137-1143 | engine actionMessage etc. | Working | | - |
| Workflow actions delay / wait_reply / reminder | :1137-1139,1443 | engine advanceRun :469-540, worker | Working | BullMQ resume; reminder | - |
| Workflow CRM actions task/lead_status/owner/sequence | :1142-1143 | runCrmAction | Working | | - |
| Workflow runs history | :668 | GET /workflows/runs | Working | | - |
| Instagram connect/disconnect | :2757-2782 | /instagram/connection, /auth-url | Working | Needs INSTAGRAM_APP_* | - |
| Instagram quickflows CRUD + runtime | :2801-2818 | /instagram/flows; POST /webhook/instagram | Working | HMAC-verified webhook | - |
| Voice AI settings + call log | :2970-2981 | GET/PATCH /automation/voice, /voice/calls | Working | Twilio webhooks signature-checked | - |
| WhatsApp Forms CRUD/templates/submissions | :3214-3315 | /whatsapp-forms | Working | Conversational runtime via handleFormInbound | - |
| Smart Lists ("interactive" tab) | :3614-3661 | /segments | Working | Segments CRUD, mislabelled | no issue |
| Widgets list/create/edit/toggle/delete/rotate key | WidgetsView.jsx:435-728 | /widgets | Working | | - |
| Widget preview | :76 | POST /widgets/:id/preview | Working | Real assistant | - |
| Widget analytics / sessions | :713-714 | GET /widgets/analytics, /sessions | Working | | - |
| Widget knowledge sources (url/text/upload/refresh/reindex) | :217-265 | /widgets/knowledge/* | Partial | SSRF guard weaker than crawler | CF-117 |
| Widget embed loader + public ask/handoff/lead/event | widgetScript.js | /widget/v1/* | Working | Origin allow-list, rate limits | - |
| Integrations - API-key connect (16 cards) | IntegrationsView.jsx:772 | POST /integrations/:provider | Partial | Stored encrypted, never consumed | CF-060 |
| Integrations - webhook connect (Zapier/Make/Pabbly) | :772 | POST /integrations/:provider | Stub | URL stored, nothing delivers to it | CF-060 |
| Integrations - OAuth Google/HubSpot/Shopify | :798 | POST /integrations/oauth/:p/start, GET callback | Working (flow) | Tokens stored; no sync | CF-060 |
| Integrations - OAuth Facebook/Zoho x4/Salesforce/Calendly | :361 | POST /integrations/:provider (pending) | Stub | Shown CONNECTED | CF-060 |
| Integrations - disconnect | :819 | DELETE /integrations/:provider | Working | | - |
| Integrations - plan lock | :718 | none server-side | Partial | UI-only gate | CF-060 |
| Number setup - list/refresh | NumberSetupView.jsx:267,637 | GET /whatsapp/numbers, POST /numbers/refresh | Working | | - |
| Number setup - Embedded Signup | :462-497 | GET /embedded-signup/config, POST /embedded-signup | Working | FB.login path + /auth/meta/start fallback | CF-150 |
| Number setup - connect own number | :554 | POST /whatsapp/numbers/connect-own | Working | No Zod, no ADMIN gate | CF-150 |
| Number setup - pool onboard | :373-383 | GET /numbers/pool, POST /onboard | Working | Pool visible to all members | CF-150 |
| Number setup - request/verify code | :72,98 | POST /numbers/:id/request-code, /verify-code | Working | Rate-limited | - |
| Number setup - health/reconnect/disconnect | :331 | GET /:id/health, POST /:id/reconnect, DELETE | Working | | - |
| Number setup - admin reset/ban/unban | :302-322 | adminFetch /numbers/* | Not verified | Super-admin area | - |
| API keys - list/create/rotate/revoke/scopes | ApiKeysView.jsx:99-162 | /api-keys | Working | | - |
| API keys - authentication key | ApiKeysView | GET /api-keys/authentication, POST rotate | Working | | - |
| API keys - send test message | ApiKeysView.jsx:191 | POST /api-keys/test-message | Broken | Route missing | CF-040 |
| Super-admin API management (platform keys) | ApiManagementTab.jsx:82-107 | adminFetch /platform/settings | Working | Gemini key verified on save (llm.js:54) | - |
| Support - create/list tickets | SupportView.jsx:19-27 | GET/POST /support | Working | Handled in admin.service | - |
| Resources center/category/detail | ResourceCenter/Category/Detail.jsx | none | Working | Static content | - |
| Settings - Workspace (name/industry/tz) | SettingsView.jsx:120 | PATCH /settings | Working | | - |
| Settings - Team (members role/remove, invites, link, resend, revoke) | :217-311 | /members, /invitations (ADMIN) | Working | | - |
| Settings - Notifications (in-app + email prefs) | :211 | PATCH /settings | Working | | - |
| Settings - Branding (colour/logo) | :400-420 | PATCH /settings | Working | | - |
| Settings - Security (links, blocked numbers) | :450-533 | /blocked-numbers | Working | Rate monitor fake | CF-151 |
| Settings - Lead capture toggle | LeadCaptureSetting.jsx:46 | PATCH /settings | Broken | Field stripped | CF-061 |
| Settings - Billing (invoices, download) | :179 | GET /settings/invoices, /invoices/:id/download | Working | Billing area covers detail | - |
| Settings - Webhook URL + test | :197 | PATCH /settings, POST /settings/webhook/test | Working | | - |
| Legal centre / Legal page | LegalCenter.jsx, Legal.jsx | none | Working | Static | - |
| Profile - edit/password/sessions/revoke/delete | ProfileView.jsx:196-528 | /users/me/* | Working | | - |
| Notifications bell | Dashboard | /notifications/* | Working | | - |

## 5. Billing, wallet, plans, add-ons, pricing

| Feature | UI location | Backend endpoint(s) | Status | Notes | Finding IDs |
|---|---|---|---|---|---|
| Wallet balance + ledger | Payments › Wallet, sidebar banner | GET /wallet | Working | Server-computed LOW/EMPTY | CF-206 |
| Wallet summary cards | Dashboard | GET /wallet/summary | Working | Refund subtraction imprecise | CF-212 |
| Razorpay wallet top-up | Payments › Wallet | POST /wallet/checkout, /wallet/checkout/verify | Working | Idempotent; no webhook fallback | CF-009 |
| Demo wallet recharge | (none — backend only) | POST /wallet/recharge | Broken (security) | Un-gated free credit | CF-001 |
| Track Expenses (ledger list) | Payments › Track Expenses | GET /wallet | Working | Last 50 rows only, no paging | — |
| Paid Messages Insights | Payments › Insights | GET /analytics/paid-messages | Working | Not verified in depth (area D) | — |
| Billing Details | Payments › Billing Details | none | Stub | localStorage only | CF-052 |
| Manage Subscriptions (view) | Payments › Manage Subscriptions | GET /subscription, /subscription/plans | Working | Shows states that can never occur | CF-049 |
| Plan purchase/upgrade | Payments › Manage Subscriptions | POST /subscription/checkout, /verify | Working | Immediate new period; non-transactional verify | CF-009 |
| Plan downgrade / cancel / schedule change | Payments (text "Contact support") | none | Missing | README §12.5 | CF-049 |
| Admin subscription override (comp/extend) | SuperAdmin | none | Missing | README §12.5 | CF-049 |
| Renewal + quota reset | (background) | billing worker daily + boot sweep | Working | Wallet-funded; PAST_DUE 3d grace → EXPIRED | CF-050 |
| EXPIRED/CANCELLED blocking | all workspace routes | workspaceContext | Partial | Not applied to API keys/webhooks/workers | CF-137, CF-002 |
| Add-ons list/buy/cancel | Payments › Manage Subscriptions › Add-ons | GET/POST/DELETE /subscription/addons* | Partial | No renewal/stacking; 2 of 4 purchasable | CF-030 |
| Add-on enforcement (custom fields/events) | Settings › Custom fields | customFields.service | Working | Blocks creation over allowance | CF-030 |
| Invoices list/download | Payments › Invoices, Settings | GET /settings/invoices, /invoices/:id/download | Partial | HTML, no GST/customer details | CF-052 |
| Message pricing display | Landing calculator, Templates, Payments | GET /api/v1/pricing, /subscription/pricing | Working | Consistent with billing rates | CF-207 |
| Campaign cost estimate | Campaign wizard | POST /campaigns/estimate | Working | Same function as launch pricing | CF-008 |
| Campaign launch charge/refund | Campaigns | POST /campaigns/:id/launch, cancel | Working | Reservation + settlement correct; quota ignored in price | CF-008, CF-141 |
| Inbox send metering (text/media/template) | Inbox | POST /conversations/:id/messages, /media, /template | Working | Metered, released on failure | — |
| Public API send metering | Developer API | POST /api/v1/messages | Broken (billing) | Unmetered, unstored, no status check | CF-002, CF-026 |
| OTP API metering | Authentication product | POST …/authentication/otp | Broken (billing) | Unmetered | CF-002 |
| API-key playground send | Settings › API keys | POST /apikeys/test-send (sendTestMessage) | Broken (billing) | Unmetered | CF-002 |
| Automated reply / workflow / sequence metering | Automation, Workflows, Sequences | workers/services | Broken (billing) | Unmetered; sequence fake DELIVERED | CF-007 |
| SMS/email fallback | Campaign wizard step 8 | fallback.service | Partial | No opt-out/metering for SMS | CF-056 |
| Plan limits: contacts | Contacts create/import | assertWithinLimit | Partial | 5 bypass paths | CF-016 |
| Plan limits: members/invites | Team settings | invitations/members.service | Working | Owner exempt; pending invites counted | — |
| Plan limits: API keys (incl. OAuth) | API keys, OAuth connect | apikeys.service:272, oauth.service:249 | Working | — | — |
| Plan limits: campaigns | Campaigns | campaigns.service:246 | Working (no-op) | All plans null | CF-051 |
| Feature flags | Automation/Workflows/Instagram/Integrations/AI onboarding | requireFeature/hasFeature | Partial | Only integrations/aiOnboarding bite on Free | CF-051 |
| Super admin plan catalog CRUD | SuperAdmin › Plans | /platform/plans* | Broken | Edits reverted on boot | CF-010 |
| Super admin revenue/transactions/payments | SuperAdmin | /platform/revenue, /transactions, /payments | Partial | Payments double-counts | CF-031 |
| Reopen window / simulate inbound | CRM Sales Inbox | POST /conversations/:id/reopen-window, /inbound-simulate | Broken (should not exist) | Dev tooling in prod | CF-023 |

## 6. Security controls: authentication, sessions, API keys, OAuth provider, transport

| Feature | UI location | Backend endpoint(s) | Status | Notes | Finding IDs |
|---|---|---|---|---|---|
| Email/password login | frontend/src/pages/Login.jsx:39 | POST /api/v1/auth/login (auth.routes.js:106-111) | Working | bcrypt cost 12 (env.js:31), per-email failure limiter works; the per-IP bucket is global behind the proxy; timing enumeration | CF-027, CF-129 |
| Register + email OTP | frontend/src/pages/Register.jsx:85,99,122 | POST /auth/register/start, /register/verify, /register/resend (auth.routes.js:68-87) | Partial | Flow is correct (hashed CSPRNG code, 5 attempts, atomic consume), but `otpLimiter` 10 per 15 min is platform-wide behind the proxy | CF-027, CF-129 |
| Forgot / reset password | frontend/src/pages/ForgotPassword.jsx:42,55,71 | POST /auth/forgot-password, /auth/reset-password (auth.routes.js:92-104; auth.service.js:530-590) | Partial | Atomic single-use code, revokes all refresh tokens on reset; the 429 cooldown reveals account existence; shared OTP bucket | CF-027, CF-129 |
| Google OAuth sign-in | frontend/src/pages/Login.jsx:163 | GET /auth/google, GET /auth/google/callback (auth.routes.js:146-232) | Working | HMAC state with 10-min TTL, but not browser-bound (login CSRF); invite token readable in state; callback URL logged | CF-128, CF-100 |
| /auth/exchange one-time code | frontend/src/pages/AuthCallback.jsx:25 | POST /auth/exchange (auth.routes.js:131-135; auth.controller.js:77-95) | Working | 64-hex code, 120 s TTL; get+del not atomic; code appears in the SPA request log line | CF-132, CF-100 |
| Token refresh | frontend/src/lib/api.js:36-77 | POST /auth/refresh (auth.routes.js:113-118; auth.service.js:143-187) | Partial | Rotation works; plaintext storage, no reuse detection, re-scopes to the first workspace; race returns 500; global 60/min bucket | CF-042, CF-132, CF-027 |
| Logout | Dashboard shell (apiFetch /auth/logout) | POST /auth/logout (auth.routes.js:123-127) | Working | Deletes the presented refresh token and denylists the access jti; fails open if Redis is down | CF-133 |
| Workspace switch | frontend/src/pages/Dashboard.jsx:126 | POST /api/v1/workspaces/:id/switch (routes/index.js:206; auth.service.js:659-666) | Partial | Membership is checked (workspaceContext + findUnique), but the next refresh silently reverts the claim to the earliest workspace | CF-042 |
| Impersonation | frontend/src/pages/SuperAdminView.jsx:917-934 | POST /api/v1/admin/platform/users/:id/impersonate (admin.routes.js:9,69) | Partial | `requireSuperAdmin` is sound; the session is a full 7-day target session with no `act` claim; audit workspaceId is always null | CF-032 |
| API key CRUD | frontend/src/pages/ApiKeysView.jsx:99,103,147,157,162 | GET/POST /workspaces/:id/api-keys, POST /:id/rotate, DELETE /:id, GET /scopes (apikeys.routes.js:10-40) | Partial | Works functionally; no ADMIN gate; a GET side effect mints the Authentication key for any role | CF-006 |
| API key playground test send | frontend/src/pages/ApiKeysView.jsx:191 | POST /workspaces/:id/api-keys/test-message (unrouted) | Broken | 404: route removed in 15a6912, controller left dangling | CF-040, CF-002 |
| Authentication (OTP) key | ApiKeysView / Authentication settings | GET /api-keys/authentication, POST /api-keys/authentication/rotate (apikeys.routes.js:18-26) | Partial | Raw key returned to VIEWER/AGENT | CF-006 |
| OAuth provider authorize | Third-party app redirect to /api/v1/oauth/authorize | GET /api/v1/oauth/authorize (oauth.routes.js; oauth.controller.js:53-75) | Working | Exact redirect_uri match; unvalidated redirect gets an error page | CF-225 |
| OAuth provider consent | frontend/src/pages/OAuthConsent.jsx:101,128 | GET /oauth/consent-info, POST /oauth/consent/decide (oauth.routes.js:37-38) | Partial | No live membership, role or suspension check; acts on the stale or refresh-rescoped JWT workspace | CF-025, CF-042 |
| OAuth provider token | server-to-server | POST /oauth/token (oauth.routes.js:31; oauth.service.js:212-253) | Working | timingSafeEqual on the client secret, atomic code claim, 2-min TTL; no PKCE (confidential clients only) | CF-225 |
| OAuth provider revoke | server-to-server | POST /oauth/revoke (oauth.routes.js:42; oauth.service.js:279-298) | Working | Not scoped to the calling client's keys (no practical impact) | CF-225 |
| Public API (x-api-key) | external callers | /api/v1/public/* (routes/index.js:110) | Partial | Ignores workspace suspension; no rate limit; unmetered sends; webhook URL unvalidated | CF-101, CF-002, CF-102, CF-103 |
| OTP Authentication API | external callers | /api/v1/authentication/* (routes/index.js:108) | Partial | No rate limit or per-recipient cooldown; works for suspended workspaces | CF-101, CF-102 |
| Platform settings (secrets) | frontend/src/pages/SuperAdminView.jsx (Settings tab) | GET/POST /api/v1/admin/platform/settings (admin.routes.js:22-23) | Working | AES-encrypted at rest, masked `first4...last4` on read (no raw values reach the browser); updates not audited; per-process cache | CF-107, CF-104 |
| Security headers | all responses | middleware/securityHeaders.js | Working | CSP, frame-ancestors 'none', nosniff, XFO, HSTS on https | no issue |
| CORS | all responses | app.js:48-83 | Working | Exact allow-list; public API reflects any origin without credentials | no issue |
| Rate limiting | n/a | middleware/rateLimit.js + limiters in 10 route files | Partial | Redis-backed with a memory fallback, failure-only counting and a per-subject bucket are well designed; per-IP keys collapse to the proxy IP; no limiter on public or OTP APIs | CF-027, CF-102 |
| Error handling | all 5xx | middleware/errorHandler.js | Working | Generic 5xx with a reference, no stacks; `detail` leaks if NODE_ENV is not production | CF-177 |
| Encryption at rest | n/a | lib/encryption.js | Partial | AES-256-CBC without MAC or rotation; decrypt errors become opaque 500s | CF-104 |
| Request logging | n/a | app.js:31-38, lib/logger.js | Partial | 5 MB rotation, git-ignored; logs tokens in URLs | CF-100 |
| Dependencies | n/a | backend/frontend lockfiles | Partial | multer 1.x; react-is 19 with React 18; the rest current | CF-085, CF-140 |

## 7. Security controls: tenant isolation, injection, SSRF, uploads, webhooks, AI

| Feature | UI location | Backend endpoint(s) | Status | Notes | Finding IDs |
|---|---|---|---|---|---|
| Per-record tenant isolation | all workspace views | /workspaces/:id/* | Working | 903 calls swept | CF-110 |
| Cross-reference id validation | Leads/Deals/Tickets/Inbox/Copilot | PATCH leads/deals/tickets, assign, copilot confirm | Partial | Only tasks/activities check refs | CF-072, CF-072 |
| Template asset ownership | Templates, sends | /templates, send paths | Partial | `_assetId` unchecked | CF-110 |
| SQL injection defences | — | all | Working | Tagged `$queryRaw` | — |
| CSV formula guard | Contacts/CRM/Opt-out exports | export endpoints | Working | Apostrophe prefix | — |
| Upload type/content validation | Inbox, Templates, Knowledge, Contacts | uploadGuard routes | Working | Magic bytes | — |
| Upload resource limits | same + CRM import | media/knowledge/import | Partial | 100 MB in memory; docx bomb; crmData bypass | CF-115 |
| Widget loader XSS | customer sites | /widget/v1/* | Working | textContent + shadow DOM | — |
| Frontend HTML sinks | Legal, Analytics PDF | — | Working | Static or escaped | — |
| Outgoing webhook SSRF guard | Settings → Webhooks | PATCH /settings, POST /settings/webhook/test, POST /public/webhooks | Missing | No IP/DNS check; oracle | CF-105, CF-103 |
| Outgoing webhook reliability/signing | Settings → Webhooks | emitWebhook | Partial | In-memory retries; empty key | CF-106 |
| Template handle re-fetch SSRF | send path | template/campaign send | Missing | Arbitrary GET | CF-111 |
| Website crawler SSRF guard | Automation → Website analysis | /automation/website-analysis | Partial | Rebinding TOCTOU | CF-214 |
| Meta webhook HMAC | — | POST /webhook/meta | Working | Raw body, timing-safe, fail-closed | — |
| Meta/IG verify handshake | — | GET /webhook/meta, /webhook/instagram | Partial | text/html echo | CF-213 |
| Instagram webhook HMAC | — | POST /webhook/instagram | Working | — | — |
| Twilio signature | — | /voice/* | Working | validateRequest | — |
| Copilot confirm/injection guard | Copilot | /copilot/ask, /copilot/confirm | Working | Proposals only | CF-072 |
| Copilot PII to LLM | Copilot | /copilot/ask | Partial | Email in prompt | CF-123 |
| WhatsApp AI / campaign AI injection | AI Agent, Campaign AI | inbound path | Working | No tools | — |
| Autonomous agent bounds | background | agent worker | Working | Fixed ACTIONS | CF-046 |
| Super-admin audit trail | Super Admin → Audit | /admin/* | Partial | 8 of 22 writes audited | CF-107, CF-032 |

## 8. Background workers, queues and reliability

| Feature | UI location | Backend endpoint(s) | Status | Notes | Finding IDs |
|---|---|---|---|---|---|
| Campaign queue/worker: launch (immediate) | Campaigns → Launch | `POST /workspaces/:id/campaigns/:cid/launch` → `campaigns.service.js:603` → `campaign.worker.js:344` | Partial | Charge idempotent (`:697-715`); per-recipient claim PENDING→SENDING; opt-out rechecked per send. A charged DRAFT with a lost job is never recovered. Bookkeeping throw after send leads to a duplicate. | CF-012, CF-055, CF-097 |
| Campaign: scheduled launch + boot recovery | Campaigns → Schedule | same; `recoverScheduledCampaigns` `campaigns.service.js:1124` | Working | SCHEDULED rows re-queued when the job is missing; past-due fire immediately; SENDING rows with no sentAt are released. | CF-012 |
| Campaign: pause | Campaigns → Pause | `pauseCampaign` `campaigns.service.js:993` | Partial | Main loop stops within one send (`campaign.worker.js:415`). Non-OTP retries keep sending. | CF-058 |
| Campaign: resume | Campaigns → Resume | `resumeCampaign` `campaigns.service.js:1026` | Broken (non-OTP) / Working (OTP) | Worker refuses RUNNING without `resume:true`. | CF-011 |
| Campaign: cancel + refund | Campaigns → Cancel | `cancelCampaign` `campaigns.service.js:1055` | Working | CANCELLED first, job removal by id + scan, settlement from billed count. | — |
| Campaign retries (retry-recipient jobs) | Campaign detail → retry status | `retry.service.js:212`, `campaign.worker.js:132` | Partial | Atomic claim, charge claimed once. Decrypt outside try can stick a row IN_PROGRESS; boot-only recovery; PAUSED excluded; colon job ids. | CF-057, CF-147, CF-208 |
| Authentication (OTP) campaigns | Campaigns (AUTHENTICATION template) | `campaign.worker.js:498-522` → `authentication.service.js:230` | Broken | Uses the workspace OTP config, not the campaign's template/number. | CF-013 |
| Campaign queue settings | — | `campaign.queue.js:4-12`; worker `campaign.worker.js:641-646` | Working | attempts 3, exp 5 s, keep 100/50; concurrency `CAMPAIGN_WORKER_CONCURRENCY` (default 2); drainDelay 60 s, stalledInterval 300 s (lockDuration 30 s default, maxStalledCount 1). | CF-097 |
| Email queue/worker | (invites, campaign mails, template status mails) | `email.queue.js`, `email.worker.js` | Partial | attempts 3, exp 3 s, concurrency 5. Reports "sent" when SMTP is unset. OTP mails bypass the queue (direct, `mustDeliver`). | CF-176 |
| Billing queue/worker (renewals) | Billing | `billing.queue.js:19` (cron `0 2 * * *`), `billing.worker.js`, `subscription.service.js:369` | Working | Idempotent per cycle via ledger key + tx re-read; also runs once at every boot. | no issue |
| Workflow queue/worker: resume after delay | Automation → Workflows | `workflow.queue.js:47`, `workflow.worker.js:8`, `workflowEngine.service.js:517` | Partial | Works while Redis keeps the job; no DB sweep; no run claim. | CF-120, CF-121 |
| Workflow: reply reminder | Workflow builder → wait_reply reminder | `workflow.queue.js:67`, `workflow.worker.js:61` | Partial | Redis-only schedule, same as resume. | CF-120 |
| Workflow: delayed-response auto-reply | Settings → Basic automation → Delayed response | `workflow.queue.js:60` (`delayed__<conv>`), `workflow.worker.js:17` | Working | Job id accepted by BullMQ; comment/test drift. Skips CLOSED conversations (CF-092). | CF-208 |
| Sequence queue/worker | CRM → Sequences | `sequence.queue.js` (sweep 60 s, `advance-<id>`), `sequence.worker.js` | Partial | DB-backed sweep recovers waits. Short waits are sweep-granular; crash can resend; send correctness issues in CF-028. No error listener. | CF-210, CF-215, CF-028 |
| Agent queue/worker | (no UI; admin run-now) | `agent.queue.js` (tick 5 min, sweep 1 h), `agent.worker.js` | Partial | First 500 workspaces, unordered, suspended included; no error listener; not closed on shutdown. | CF-047, CF-215, CF-099 |
| Boot recovery | — | `server.js:323-367` | Partial | Covers SCHEDULED campaigns, SENDING rows, RETRYING recipients (RUNNING/SCHEDULED only), sequence sweep, billing catch-up. Missing: RUNNING/charged-DRAFT campaigns and WAITING workflow runs. | CF-012, CF-120, CF-147 |
| Graceful shutdown | — | `server.js:384-416` | Partial | Agent worker/queue not closed; campaign jobs cannot finish in 25 s, so it force-exits. | CF-099 |
| Migrations at boot | — | `server.js:216-231`, `package.json:17` | Partial | Failure only logs; skipped entirely when NODE_ENV is unset (defaults to development). | CF-096, CF-095 |
| Redis-down fallback: boot | — | `server.js:277-300`, `redis.js:96` | Working (prod) / Degraded (dev) | Production exits; dev starts with no workers (campaigns, retries, invite/campaign emails, workflows, sequences, agent, billing job all off; launch refunds because `queue.add` rejects). | CF-095 |
| Redis-down fallback: runtime (prod) | — | `redis.js:60-91`, `tokenDenylist.js:37` | Broken | Commands queue forever, so every authenticated request hangs (denylist) and enqueues hang. | CF-098 |
| Redis-down fallback: rate limiting | Login / OTP / auth routes | `middleware/rateLimit.js:68-80` | Working | Memory fallback via `status === 'ready'`; per-process; parallel-burst race. | CF-130 |
| Redis-down fallback: Google OAuth one-time code | Login with Google | `auth.controller.js:60-95` | Working | Memory fallback; single-instance only; GET+DEL not atomic. | CF-130 |
| Redis-down fallback: Instagram OAuth state | Connect → Instagram | `instagram.controller.js:37, :52` | Not verified | No status check (would hang in prod, reject in dev), same pattern as CF-098. | CF-098 |
| DB connection pool | — | `lib/prisma.js:10-15` | Partial | `connection_limit=3` default. | CF-097 |
| Invite seat check | Team → Invite / accept link | `invitations.service.js:78, :295, :365` | Partial | Check-then-act; concurrent accepts bypass `maxUses` and memberLimit. | CF-109 |
| Fire-and-forget promises | — | 102 silent-catch sites | Partial | Notable: wallet invoice, credit release, opt-out sync, retry recovery. | CF-082 |

## 9. Frontend shell, UX and accessibility

| Feature | UI location | Backend endpoint(s) | Status | Notes | Finding IDs |
|---|---|---|---|---|---|
| Sidebar nav | Dashboard.jsx Sidebar | — | Partial | Same nav for every role; broken icons | CF-185, CF-089 |
| Role gating (UI) | lib/permissions.js | backend roleCapabilities.js | Partial | `isReadOnly`/`canHandleConversations` never called; "Member" label | CF-089, CF-178 |
| Notifications bell | Dashboard.jsx:448-520 | GET /notifications, POST /notifications/read-all | Partial | Stale `unread` in toggle | CF-189, CF-191 |
| CRM urgent badge | Dashboard.jsx:2728-2741 | GET /tasks?isOverdue=true, GET /insights/recommendations | Partial | Fetched once; page-length count | CF-188 |
| Sidebar wallet balance | Dashboard.jsx:2742-2777, useWallet | GET /wallet | Working | Polled twice | CF-189 |
| Command palette | components/CommandPalette.jsx | GET /search | Not verified | Has role=dialog | — |
| Copilot slide-over | components/Copilot.jsx | POST /copilot/ask, /copilot/confirm | Not verified | Endpoints exist | — |
| Mobile nav | MobileNavButton.jsx, Dashboard.jsx | — | Partial | No "More" tab; CRM has no hamburger | CF-190 |
| Modals | components/Modal.jsx (49 sites) | — | Partial | No Escape/focus trap/dialog role | CF-087 |
| Icon-only buttons (a11y) | 17 files | — | Partial | 44 of 102 unlabeled | CF-122 |
| Theme | index.css tokens | — | Working | Dark only; not a defect | — |
| Session handling / refresh | lib/api.js | POST /auth/refresh | Partial | Single-flight correct; 3 bypasses; /resources missing | CF-182, CF-088 |
| Impersonation banner | SuperAdminView.jsx, Dashboard.jsx | POST /admin/platform/users/:id/impersonate | Partial | Leaks into other tabs | CF-108 |
| Error boundary | main.jsx | — | Missing | White screen on render error / stale chunk | CF-086 |
| Router | App.jsx | — | Working | navigate during render; dead router copy | CF-192, CF-179, CF-193 |
| Code splitting | vite.config.js | — | Partial | Eager imports | CF-183 |
| Billing details (GST) | PaymentsView.jsx | none | Broken | localStorage only | CF-052 |
| AI Agents channels panel | AiAgentsView.jsx | GET /ai-agents/channels | Stub | Fabricated fallback | CF-039 |
| WhatsApp AI Agent deploy tab | AutomationView.jsx `wa-agent` | /ai-agent/deploy, /undeploy, /knowledge/upload | Partial | Deep link only | CF-038 |
| Inbox loading/error states | InboxView.jsx | GET /conversations | Partial | None | CF-199 |
| Leads search | LeadsView.jsx | GET /leads | Partial | No debounce | CF-159 |
| Deals keyboard DnD | DealsView.jsx:95-112 | PATCH deal stage | Working | Alt+Arrow | — |
| Legal centre | LegalCenter.jsx | — | Working | Placeholder terms | no issue |

## 10. Data, config, deploy, ops and tests

| Feature | UI location | Backend endpoint(s) | Status | Notes | Finding IDs |
|---|---|---|---|---|---|
| Health check (liveness) | n/a (Render healthCheckPath, deploy-vps.sh) | GET /api/v1/health (routes/index.js:77) | Partial | Static "ok" with no DB/Redis probe; only reachable after the full boot sequence | CF-203, CF-202 |
| DB migrations (migrate deploy) | n/a | start:prod + server.js:221 | Broken (fresh DB) / Working (existing DB) | No baseline for 59 models, manual/004 ordering break, failures swallowed at boot | CF-019, CF-096 |
| Manual SQL (prisma/manual) | n/a | none (manual psql) | Partial | 003/004 not applied automatically; 20260907 migration depends on 004 | CF-019 |
| Schema canonicality / client freshness gate | n/a | scripts/ensure-prisma-client.js, prisma-schema-canonical.js | Working | Comparator tests 10/10; main checkout client stale (gate would regenerate) | CF-226, CF-164 |
| Plan seeding at boot | Admin > Plans | server.js:52-214; PATCH /admin/platform/plans/:id | Broken (admin edits reverted) | Upsert overwrites FREE/BASIC/GROWTH on each boot | CF-010, CF-204 |
| Subscription backfill at boot | n/a | server.js:172-208 | Working | Unbounded, N+1 | CF-204 |
| Seed scripts (seed-plans, seed-crm, seed-crm-50, create-test-user, reset-numbers, backfill-subscriptions) | n/a | backend/scripts/* | Not verified | None call assert-local-db | CF-029 |
| Platform settings DB override | Admin > Platform settings | GET/POST /admin/platform/settings | Working (single instance) | Per-process cache; no cross-instance refresh | CF-149 |
| Env validation | n/a | config/env.js | Partial | 2 unused required vars; META_TWO_STEP_PIN dropped | CF-059, CF-148 |
| Logging | n/a | lib/logger.js, console.* | Partial | File log only for fatal errors, ephemeral disk, no structured/request logs | CF-165 |
| Graceful shutdown | n/a | server.js:385-416 | Partial | Agent worker/queue not closed | CF-119 |
| Render deploy (render.yaml + render-build.js) | n/a | render.yaml, scripts/render-build.js | Partial | Missing TRUST_PROXY_HOPS; stale-dist skip; double migrate | CF-027, CF-165, CF-096 |
| VPS deploy (deploy-vps.sh) | n/a | deploy-vps.sh | Working (per script) / Not verified live | Shares the DB with Render; boot migrations contradict its policy | CF-020, CF-096 |
| DEPLOY.md / README env docs | n/a | docs | Partial | No .env.example; Node 20+ vs engines 22; stale register route | CF-171, CF-114 |
| In-process workers (6) | n/a | server.js:302-313 | Working / PERF risk | Shared 3-connection pool; ~19 Redis connections per instance | CF-119, CF-097 |
| Analytics / list query performance | Analytics, CRM Deals board, Tasks | analytics.service, deals.service:44, tasks.service:28 | Partial | Unbounded findMany, heavy include | CF-048, CF-053, CF-153 |
| DB indexes / cascades / enums | n/a | schema.prisma | Partial | Missing indexes on Campaign/Invoice/Conversation/RefreshToken; RESTRICT FKs; no CANCELLED | CF-084, CF-139, CF-083, CF-216 |
| Backend unit tests (`npm test`) | n/a | backend/src/**/*.test.js (39 files) | Partial | 365 tests: 183 pass / 4 fail / 178 skipped (no DB) on Node 24 with test.env; no local-DB guard | CF-211, CF-029 |
| OTP scope test (`test:otp`) | n/a | tests/otp-scope.test.mjs | Working | 3/3 | CF-211 |
| Prisma schema test (`test:prisma-schema`) | n/a | tests/prisma-schema-canonical.test.mjs | Partial | 10/11 (stale client in the env used) | CF-226 |
| Root e2e scripts (tests-e2e*.mjs) | n/a | localhost:4000 | Broken | `POST /auth/register` removed; `/admin/pool` moved | CF-114 |
| Playwright suite (tests/*.spec.js) | n/a | playwright.config.js | Broken/Unsafe | baseURL = production, headless false | CF-114 |
| backend/scripts/*-check.mjs | n/a | 127.0.0.1:4000 + direct prisma | Not verified | Local target, but DB from .env with no guard | CF-029 |
| public-api-test/ | n/a | localhost:4000 public API | Not verified | Sample client; posts to webhook.site | CF-209 |
| Test coverage: billing/wallet, Razorpay, auth/refresh, campaign worker, webhook dispatch | n/a | - | Missing | No tests | CF-113 |
| Stray tracked files | n/a | repo root, backend/ | TECH-DEBT | dump.rdb, PDF, screenshots, MS_Prompt.md, test_key_gen.js, check-*.mjs; frontend/dist NOT tracked | CF-209, CF-164 |

## 11. Documentation artefacts

| Feature | UI location | Backend endpoint(s) | Status | Notes | Finding IDs |
|---|---|---|---|---|---|
| Root README (setup, stack, API surface, gaps, billing spec) | repo root | - | Partial | Node, workers, routes, gaps, billing, licence stale; no CRM/OTP sections | CF-175 |
| backend/README quick start | backend/ | - | Broken | `.env.example` missing, wrong secret names, `migrate dev` fails on empty DB | CF-169, CF-019 |
| backend/docs/PUBLIC_API.md | backend/docs | `/api/v1/public/*` | Partial | 9 of ~20 endpoints, no scopes, wrong "text message" claim | CF-173 |
| Authentication (OTP) API docs | - | `/api/v1/authentication/*` | Missing | no doc anywhere | CF-173 |
| backend/docs/local-redis-setup.md | backend/docs | - | Working | queue list understated | CF-221 |
| docs/AGENT_ROADMAP.md | docs/ | `/agent/*` | Working (minor drift) | status accurate; tool count stale | CF-167 |
| docs/ADVANCED_CRM_GAP_ANALYSIS.md / EXISTING_FEATURES.md | docs/ | CRM routes | Partial | "11 read tools", UI gaps line stale | CF-167 |
| docs/QA-TESTING-GUIDE.md | docs/ | - | Partial | step 2 migrate deploy fails on fresh DB; pause instruction impossible | CF-174, CF-166 |
| docs/TESTING_WALKTHROUGH.md | docs/ | `/agent/run`, copilot | Working (minor drift) | test count conflicts | CF-222 |
| docs/LOCAL_DEV_DATABASE.md | docs/ | - | Working | consistent with code | no issue |
| docs/QA-2-FIXES.md | docs/ | inbound pipeline | Working | all items trace to code | no issue |
| DEPLOY.md / render.yaml / deploy-vps.sh | repo root | - | Partial | Render-only; real prod on VPS undocumented; names wrong | CF-172, CF-019 |
| AI_FEATURES_REPORT.md | repo root | ai-agent, intent, fallback, oauth | Partial (historical) | wrong SQL path, stale reply order | CF-219 |
| TEST_EVIDENCE.md | repo root | CRM | Partial | overbroad visibility/SLA claims; count stale | CF-170, CF-222 |
| ATTRIBUTION.md | repo root | agent.* | Working | accurate; licence inconsistency elsewhere | CF-220 |
| MIGRATION_AUDIT.md | repo root | - | Partial (historical) | 250/250 contract claim no longer true | CF-040 |
| BUGS.md / BUGS-v2.md / issue_sheet.md / STABILIZATION_REPORT*.md | repo root | - | Partial (historical) | "all resolved" overclaims; 3 regressions; unsafe `migrate dev` step | CF-168 |
| OPEN_ISSUES.md | repo root | - | Partial | OPEN-001 falsely resolved on this branch | CF-019 |
| Prisma migration history (fresh-DB provisioning) | - | boot `migrate deploy` | Broken | no baseline on this branch | CF-019 |

