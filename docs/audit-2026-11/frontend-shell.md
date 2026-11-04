# frontend-shell audit (App shell, Dashboard, Contacts, Engagements, shared components)

Method: Playwright crawl of every App.jsx route + every sidebar section (38 routes) at 1440x900 and 390x844 as ADMIN, plus VIEWER (1440) and AGENT (390) users created via Prisma (`fs-viewer@example.com`, `fs-agent@example.com`, password123, in Test User's Workspace). Then scripted dogfood runs (scratchpad/fs/t1–t5.cjs) that click through Contacts (add/dup/edit/delete/bulk select/cluster/filter/sort/search/pagination/message), Engagements (log, validate, keyboard open), command palette, notifications, not-found routes, guards, back/forward, sign-out, mobile drawer/FAB/overflow, and role gating with backend 403 checks. Screens: scratchpad/screens/ (admin_*, viewer_*, agent_*, fs_*).

Final dogfood run: 24/24 in t1, 27/27 in t2 (after fixes), 16/16 in t5, all passing.

## Findings

| ID | Sev | Area | file:line | Problem (failure scenario) | Status | Test |
|---|---|---|---|---|---|---|
| FS-1 | High | Engagements / API | backend/src/validators/index.js `crmActivitySchemas.create` | `z.object()` stripped `engagementType/status/duration/notes/outcome/sentiment`, so createActivity never saw them: every "Visit"/"Video Call"/"Scheduled" engagement was saved as a plain record with defaults, and lead-touchpoint outcome/sentiment never fed the auto follow-up task | Fixed (fields declared, enums bounded) | validators/crmActivity.test.js (2 tests) |
| FS-2 | High | Engagements | pages/EngagementsView.jsx save | "Note" mapped to `MEETING` → listed as "Video Call"; verified now saved/listed as Note | Fixed (RAW_TYPE map) | browser t2/t4 |
| FS-3 | High | Home AI assistant | pages/Dashboard.jsx HomeView.handleSend | Raw `fetch` with no token refresh: after 15 min (access-token TTL) first prompt failed with "Invalid or expired token" | Fixed (apiFetch) | browser |
| FS-4 | Medium | Shared Modal (used by ~17 CRM screens) | components/Modal.jsx | No role=dialog/aria-modal/label, Escape did nothing, no focus move/trap/restore (Tab walked into page behind) | Fixed: dialog semantics, Escape (top-most only, via stack), Tab trap, first-field focus, focus restore | browser t1 (5 checks) |
| FS-5 | Medium | Contacts | ContactsView.jsx row actions | "Message" button had no onClick (dead) | Fixed → opens `/dashboard/inbox?search=<phone>` (see OUT-1: Inbox must read the param) | browser |
| FS-6 | Medium | Contacts | ContactsView.jsx clusters | Creating a cluster didn't refresh the cluster sidebar (stale until reload); tags/cluster counts stale after add/edit/delete/import | Fixed (refreshAll) | browser |
| FS-7 | Medium | Contacts mobile | ContactsView.jsx | Fixed 240px cluster column left the table ~100px wide at 390px; filter popover (320px) ran off-screen | Fixed: chip row on mobile, fixed-position filter sheet | browser (table 366px, popover inside viewport) |
| FS-8 | Medium | Role UI | ContactsView, EngagementsView, Dashboard HomeView/NextBestAction, AgentTab | Viewer saw Add/Edit/Delete/Import/Create Cluster, Log Engagement, AI assistant, "Create campaign" NBA, Accept/Reject — all 403 server-side. Agent saw Create Cluster (403) | Fixed: gated per permissions.js (mirrors roleCapabilities); read-only note shown; backend 403 verified still enforced | browser t2 |
| FS-9 | Medium | Contacts bulk delete | ContactsView DeleteMultipleModal | Partial failure kept deleted rows on screen and gave no detail | Fixed (always refresh, "N deleted, M failed: reason") | — |
| FS-10 | Medium | Engagements | EngagementsView.jsx | Fabricated display data ("Investor Contact", "Sales Rep", "Enterprise Growth Team") shown as if real; errors never rendered (showed "No engagements found"); `alert()` errors | Fixed: dashes, error row w/ retry, inline modal errors | browser |
| FS-11 | Medium | Engagements | EngagementsView.jsx leads effect | Effect depended on selectedLeadId → refetched 100 leads each time the dropdown changed | Fixed | — |
| FS-12 | Medium | Engagements | EngagementsView.jsx search | Fetch per keystroke, out-of-order responses could show stale rows | Fixed (300ms debounce + request id guard) | — |
| FS-13 | Low | Engagements | EngagementsView.jsx | Select-all/row checkboxes with no bulk action (dead UI) | Removed | — |
| FS-14 | Low | Engagements | EngagementsView.jsx counts | "All" badge used filtered `total` → changed with every tab | Fixed (counts.ALL) | — |
| FS-15 | Medium | Routing | Dashboard.jsx sectionFromPath | Unknown `/dashboard/xyz` silently rendered Home (bad URL, Home highlighted); `/dashboard/admin-*` for workspace users showed fake "Full interface available in the production app"; super admin on workspace sections loaded pages with no workspace | Fixed: NotFoundView + per-account section validity | browser |
| FS-16 | Medium | Mobile drawer | Dashboard.jsx Sidebar | Closed (off-screen) drawer's ~35 links stayed in Tab order/screen reader; focus not moved on open | Fixed (visibility w/ delayed transition, focus close button) | browser |
| FS-17 | Medium | Mobile | Dashboard.jsx "Ask your CRM" FAB | Sat over the bottom tab bar's "Analytics" tab at 390px | Fixed (offset above bar) | browser bbox check |
| FS-18 | Low | Notifications | Dashboard.jsx NotificationsBell.toggle | Used stale `unread` closure after `await load()` → new notifications not marked read, badge stuck; items not keyboard-reachable | Fixed | — |
| FS-19 | Low | Role labels | Dashboard.jsx ProfileMenu/Sidebar | VIEWER and AGENT labelled "Member" (the name of CLIENT role) | Fixed (ROLE_LABELS) | browser |
| FS-20 | Low | Crash | Dashboard.jsx Avatar, ContactsView Avatar | `name=null` (phone-only contact) → `null.split` crash of whole table/list | Fixed (null-safe) | — |
| FS-21 | Low | Contacts CSV | ContactsView CsvTab | Raw fetch w/o refresh → 401 on expired token; re-choosing same file didn't fire onChange | Fixed (wFetch, input reset) | — |
| FS-22 | Low | a11y | ContactsView | Checkboxes were divs, icon buttons unlabeled, tabs/clusters/sort options divs, inputs unlabeled | Fixed (role=checkbox buttons, aria-labels, buttons) | browser (all located by role/label) |
| FS-23 | Low | Double submit | Contacts add/edit/cluster, BulkTaskModal, LogInteractionModal, AgentTab | No in-flight guard on Enter-key submits | Fixed | — |
| FS-24 | Low | Contacts pagination | ContactsView load | Deleting the last rows of last page showed "No contacts found" with contacts remaining | Fixed (step back a page) | — |
| FS-25 | Low | Btn | components/Btn.jsx | Dropped `title`/`aria-*` (e.g. ImportExport "Download as CSV" tooltip lost); `<Btn outline>` rendered primary | Fixed (forward rest props; outline alias). Default `type` deliberately unchanged | build |
| FS-26 | Low | BulkTaskModal | components/BulkTaskModal.jsx | Priority picker whose value the server discards (tasks have no priority) | Removed | — |
| FS-27 | Low | LogInteractionModal | components/LogInteractionModal.jsx | Outcome state not reset when list changes with type → saved outcome ≠ displayed; sending `duration` (now accepted, FS-1) would re-wrap content as JSON | Fixed | — |
| FS-28 | Low | Command palette | components/CommandPalette.jsx | Ticket results had no icon/type chip; Tab escaped dialog; no Tickets/Templates/Payments actions; super admin offered workspace-only destinations | Fixed | browser (ctrl+k → deals) |
| FS-29 | Low | App.jsx | App.jsx renderPage('/') | `navigate()` called during render (setState-in-render) | Fixed (moved into guard effect) | browser t5 guards |
| FS-30 | Low | Engagements | EngagementsView.jsx | No hamburger on mobile header; no "showing N of total" though API caps at 200 | Fixed | screenshot |
| FS-31 | Medium | Form fields (crm-frontend report) | components/Form.jsx FInput/FSelect/FTextarea | A caller's `style` arrived via `...rest` after the theme style and replaced it entirely (CustomizeBusinessView ~840/909/1077, SettingsView ~516/579 lost their field look) | Fixed: `style` merged over the theme in all three; callers unchanged | build |
| FS-32 | Medium | CRM FAB on desktop (crm-frontend report) | Dashboard.jsx main column | "Ask your CRM" FAB covered the last table row's actions; CRM views scroll in inner containers so page padding alone can't clear it | Fixed: 72px strip reserved under the main column on CRM tabs while the FAB is shown (desktop + mobile) | browser t6: last visible row bottom < FAB top on engagements/tasks at 1440 and 390 |

Coordinator follow-ups: Btn rest-prop forwarding (aria-label/title/className/id/data-*) = FS-25; Modal dialog role/Escape/focus trap = FS-4 (both already done).

Verified OK (no change needed): logged-out guard for /dashboard*, /resources, /setup; dead-session → landing/login; authed /login → /dashboard; back/forward across sections; sign-out clears tokens (now server-revoking via signOut — fixed by auth auditor) and back button re-guarded; keyboard sidebar nav; XSS: `<script>` contact names render as text (no dangerouslySetInnerHTML in owned files); intervals in Dashboard/Notifications/Sidebar cleared on unmount.

Not runtime-tested: super-admin shell (auto-mode denied minting a local super-admin token; ADMIN_EMAIL password unknown) — reviewed by code only.

## Route-by-route console/network inventory (whole app)

Backend `node --watch` restarted many times during the run (other auditors' edits); every 500/ERR_ABORTED burst on ~all routes at those moments is the Vite proxy hitting a restarting API, not a route bug. Crawl retries a route until the API is healthy; below is what persists.

| Route | Role/viewport | Persistent issue | Owner |
|---|---|---|---|
| all other /dashboard/* routes, /resources | admin 1440+390, viewer 1440, agent 390 | clean (no console errors, no 4xx/5xx) | — |
| /dashboard/inbox | admin, viewer | `502 GET /conversations/:id/messages/:id/media` (dummy Meta creds — expected) | Inbox |
| /dashboard/intent-matching | viewer, agent | `403 POST /intents/test` fired automatically on page load — page issues a write just by being opened; should not auto-test for read-only roles | Automation |
| /dashboard/chat-analysis | all | Recharts "width(-1) and height(-1) of chart" warning (ResponsiveContainer in 0-size parent, components/dashboard/ChatAnalytics.jsx:210); 2 duplicate requests aborted (StrictMode double fetch w/o dedupe) | Analytics |
| /dashboard/crm-overview | all | same Recharts -1 size warning (CrmDashboardView.jsx:538) | CRM |
| /dashboard/analytics | admin (first crawl) | React duplicate key "Thu/Fri/Sat/Sun" — AnalyticsView.jsx:451 `key={d.iso || d.date}` when server omits `iso` for 14/30-day ranges (intermittent) | Analytics |
| /dashboard/deals | 390 (admin, agent) | horizontal page overflow: scrollWidth ~1100 > 390 | CRM (Deals) |
| /dashboard/tasks | 390 (admin, agent) | horizontal page overflow: scrollWidth ~707 > 390 | CRM (Tasks) |
| /dashboard/nonexistent | all | previously rendered Home silently — now "Page not found" (FS-15) | shell (fixed) |

## Outside my scope (reported, not fixed)

- OUT-1 (Medium, Inbox): InboxView.jsx doesn't read `?search=`; Contacts "Message" now links `/dashboard/inbox?search=<phone>`. Initialise `search` state from `new URLSearchParams(location.search).get('search')` so it lands filtered.
- OUT-2 (Medium, SiteAssistant/landing owner): components/SiteAssistant.jsx:218 launcher `position:fixed; bottom:22` covers the mobile tab bar's "Analytics" tab on every non-CRM dashboard page at ≤860px (see screens/admin_390x844__dashboard.png). Needs `bottom: calc(76px + env(safe-area-inset-bottom))` when inside /dashboard on mobile.
- OUT-3 (Medium, CRM backend): activities.service.js:178-180 — VIDEO_CALL and VISITS counts are both `MEETING` count (and both filters return all meetings), so the Video Calls and Visits tabs show the same rows; engagementType lives only in JSON content. Also service fabricates display data: `teamName || 'Enterprise Growth Team'`, `leadSource ... : 'INSTAGRAM'` for non-call activities, `'Lead Contact'`.
- OUT-4 (Low, Landing/marketing): CampaignAI.jsx:112 logo calls `onNav('landing')`, which in App.jsx means sign out — a logged-in user clicking the logo on /product/campaign-ai is signed out.
- OUT-5 (Low, Automation): /dashboard/intent-matching auto POSTs /intents/test on load (403 for viewer/agent — see inventory).
- OUT-6 (Low, Settings): QuickLinksGrid "Role Permissions" / "Manage Teams" both navigate to `settings` with no sub-tab; SettingsView is rendered without `initialTab`, so they can't deep-link.
- OUT-7 (Low, Campaigns inside Dashboard.jsx): CampaignsView/TemplatesView (Dashboard.jsx ~1000–2500) left untouched for the Campaigns/Templates owner.
- OUT-8 (Low, Deals/Tasks): 390px horizontal overflow (inventory above).
- OUT-9 (Low, Recharts): ResponsiveContainer -1 warnings on chat-analysis and crm-overview.

## Files changed
- frontend/src/components/Modal.jsx, Btn.jsx, Form.jsx, CommandPalette.jsx, BulkTaskModal.jsx, LogInteractionModal.jsx, AgentTab.jsx
- frontend/src/pages/ContactsView.jsx, EngagementsView.jsx, Dashboard.jsx (shell parts only), App.jsx (2 small edits)
- backend/src/validators/index.js (crmActivitySchemas.create — targeted addition)
- backend/src/validators/crmActivity.test.js (new)

## Tests
- `npx vite build`: passes.
- Backend: `npm test` 558/558 pass; new crmActivity.test.js 2/2.
- Browser dogfood scripts (scratchpad/fs/t1.cjs, t2.cjs, t4.cjs, t5.cjs): all checks pass.

## Round 2 — items taken over from other scopes (coordinator request)

| ID | Sev | Area | file | Problem | Status | Test |
|---|---|---|---|---|---|---|
| FS-33 | Medium | Inbox deep link (OUT-1) | pages/InboxView.jsx `search` state | Ignored `?search=`; Contacts → Message landed unfiltered | Fixed: state seeded from `?search=` | browser t10 |
| FS-34 | Medium | SiteAssistant (OUT-2) | components/SiteAssistant.jsx launcher | Covered mobile tab bar "Analytics" | Fixed: on ≤860px inside /dashboard or /resources it sits at bottom 76px+safe-area | browser bbox |
| FS-35 | Low | CampaignAI (OUT-4) | pages/CampaignAI.jsx:112 | Logo `onNav('landing')` signed logged-in users out | Fixed: `navigate('/')`, same as marketing.jsx `home` | browser (session kept, lands on /dashboard) |
| FS-36 | Low | Intent Matching (OUT-5) | pages/AutomationView.jsx intent tester | Prefilled example POSTed /intents/test on load → 403 for viewer/agent | Fixed: tester only runs for canManage; input disabled with reason otherwise | viewer crawl: no request |
| FS-37 | Medium | Mobile navigation (found while checking OUT-8) | pages/Dashboard.jsx MobileTabBar | 14 CRM views (Leads, Deals, Tasks, …) build headers without the hamburger → rest of the nav unreachable on a phone | Fixed: 5th "More" tab opening the drawer, on every screen | browser t10 |
| FS-38 | Info | Deals/Tasks 390px overflow (OUT-8) | — | Re-checked: window cannot scroll horizontally (scrollX stays 0); the reported scrollWidth comes from the kanban board and table, which scroll inside their own containers by design. Not a bug; no change | — | t9 probe |
| FS-39 | Low | Recharts warnings (OUT-9) | components/dashboard/ChatAnalytics.jsx, pages/CrmDashboardView.jsx (6 containers) | recharts 3 starts ResponsiveContainer at -1×-1 → console warning each mount | Fixed: `initialDimension={{width:320,height:200}}` | browser: no warning |
| FS-40 | Low | Analytics duplicate key | pages/AnalyticsView.jsx:451 | `key={d.iso || d.date}` collides on weekday names when `iso` is missing | Fixed: index fallback | browser |
| FS-41 | Low | Settings deep link (OUT-6) | pages/SettingsView.jsx, components/QuickLinksGrid.jsx, Dashboard.jsx | Role Permissions / Manage Teams went to Settings' default tab | Fixed: SettingsView takes `initialTab` (follows `?tab=`), both links use `team` | browser: lands on Team tab |
| FS-42 | Medium | Activities backend (OUT-3) | backend/src/services/activities.service.js | Video Calls and Visits tabs both filtered & counted every MEETING; service invented "Enterprise Growth Team", "INSTAGRAM" source, "Lead Contact" | Fixed: split by stored engagementType (legacy meetings stay Video Call), separate visit count, scoped-AND merge kept; unknown fields now null (UI shows a dash) | services/activities.engagementTypes.test.js (2 tests) |

Coordinator's earlier follow-ups: Form.jsx style merge = FS-31, Btn prop forwarding = FS-25, Modal = FS-4, CRM FAB overlap = FS-32.

Round 2 files: frontend/src/pages/{InboxView,CampaignAI,AutomationView,AnalyticsView,SettingsView,CrmDashboardView,Dashboard}.jsx, components/{SiteAssistant,QuickLinksGrid,dashboard/ChatAnalytics}.jsx, components/Form.jsx; backend/src/services/activities.service.js + activities.engagementTypes.test.js.

Tests after round 2: `npx vite build` passes; backend `npm test` 575/575 pass; activities-related suites 32/32; browser checks t6 and t10 all pass.
