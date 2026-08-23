# UI Migration Audit — old React frontend → "Spandan" design set

Status: **Complete — audited, reskinned, built and verified. Nothing committed or pushed.**
Date: 2026-08-12

---

## 1. What the two sides actually are

### Old app (`frontend/`) — a real, working React SPA
- React 18 + Vite, **~21,300 lines** across 42 source files.
- No router library: a hand-rolled `history.pushState` router in `src/App.jsx`.
- `src/pages/Dashboard.jsx` is **3,542 lines** and acts as a second-level router
  (sidebar sections) plus shell (sidebar, header, wallet balance polling).
- API layer: `src/lib/api.js` (164 lines) — same-origin `/api/v1`, bearer access
  token in `localStorage`, single-flight refresh-token rotation, 401/403-only
  logout, cold-start tolerance.
- State: local `useState`/`useEffect` + `localStorage`. No redux/zustand/react-query.
- Auth: email+password, Google OAuth (`/auth/callback`), invite acceptance,
  forgot-password, workspace gating, super-admin role branch.

### Backend (`backend/`) — untouched, fully working
- Express, **261 route handlers** across 36 route files, 33 controllers.
- Mounted at `/api/v1` (+ `/widget/v1` public widget).
- Prisma/Postgres (Supabase pooler), Redis/BullMQ campaign workers.
- `.env` present with real credentials: Meta/WhatsApp Cloud API, Twilio,
  Google OAuth, Gemini, OpenAI, JWT secrets, encryption key.

### "New UI" (`../Spandan brand scoping (1)`) — **not an application**
This is the critical finding. It is **30 standalone static `.dc.html` mockups**
plus one `support.js` runtime. Specifically:
- No `package.json`, no build, no `src/`, no components, no routing, no state.
- Each file is a single flat HTML page with **fully inlined styles** and a
  Claude-Design template DSL rendered client-side by `support.js`:
  `<x-dc>`, `<sc-for list="{{ tiles }}" as="t">`, `<sc-if value="{{ … }}">`,
  `{{ mustache }}` placeholders, `hint-placeholder-count="6"`.
- All data is placeholder. All links are relative hrefs to sibling `.dc.html`
  files (e.g. `href="Spandan Billing.dc.html"`).
- Design system exists only as repeated inline CSS custom properties:
  `--bg:#0a0b0e --panel:#0c0d11 --bd:rgba(255,255,255,0.07) --t1:#eef0f3
  --t2:#8b909b --t3:#565c66 --cyan:#35e8f2 --violet:#9d6bff --lime:#c4ff46
  --green:#25d366`; fonts Space Grotesk / Manrope / JetBrains Mono.

**There is nothing here to "wire".** There are no components to connect to
endpoints. The mockups must first be *converted* into a React application
(extract the design tokens, build a component library, rebuild each screen as
JSX, add the router), and only then can backend wiring happen. That is a
rebuild of a 21k-line app in a new skin, not an integration task.

---

## 2. Route inventory — old app

| Route | Component | Lines | Auth |
|---|---|---|---|
| `/` | `Landing.jsx` | 1013 | public |
| `/login` | `Login.jsx` | 234 | public |
| `/register` | `Register.jsx` | 258 | public |
| `/forgot-password` | `ForgotPassword.jsx` | 167 | either |
| `/auth/callback` | `AuthCallback.jsx` | 79 | OAuth redirect |
| `/invite/accept` | `InviteAccept.jsx` | 217 | either |
| `/setup` | `WorkspaceSetup.jsx` | 99 | authed, no workspace |
| `/dashboard/*` | `Dashboard.jsx` shell | 3542 | authed + workspace |

### Dashboard sections (workspace users) — `ADMIN_NAV`
`home`, `templates`, `campaigns`, `campaigns-create`, `contacts`, `inbox`,
`widget`, `integrations`, `automation`, `analytics`, `chat-analysis`,
`user-analytics`, `setup` (number setup), `payments`, `api`, `support`,
`settings`, `profile`

### Dashboard sections (super admin) — `ADMIN_TABS`
`admin-overview`, `admin-analytics`, `admin-revenue`, `admin-transactions`,
`admin-payments`, `admin-campaigns`, `admin-workspaces`, `admin-users`,
`admin-numbers`, `admin-plans`, `admin-support`, `admin-api-management`,
plus `settings`

**Total distinct screens to reproduce: 8 top-level + 18 workspace sections +
13 super-admin sections = 39.**

---

## 3. Mapping: old screen → new mockup

### Direct match (mockup exists, still needs full rebuild as React + wiring)
| Old screen | New mockup |
|---|---|
| Landing | `Spandan Landing.dc.html` |
| Dashboard home | `Spandan Dashboard.dc.html` |
| Templates | `Spandan Templates.dc.html` |
| Campaigns | `Spandan Campaigns.dc.html` |
| Create campaign (1829 ln) | `Spandan Campaign Builder` + `Spandan Campaign-AI Page` |
| Contacts (1134 ln) | `Spandan Contacts.dc.html` |
| Inbox | `Spandan Inbox.dc.html` |
| Integrations (965 ln) | `Spandan Integrations.dc.html` |
| Automation (2617 ln) | `Spandan Automation Builder.dc.html` |
| Analytics | `Spandan Analytics.dc.html` |
| Chat Analysis | `Spandan Chat Analysis.dc.html` |
| User Analytics | `Spandan User Analytics.dc.html` |
| Number Setup (786 ln) | `Spandan Numbers.dc.html` |
| Payments (871 ln) | `Spandan Billing.dc.html` |
| API Keys | `Spandan API Keys.dc.html` |
| Support | `Spandan Support.dc.html` |
| Settings | `Spandan Settings.dc.html` |
| Profile (751 ln) | `Spandan Profile.dc.html` |
| Workspace setup | `Spandan Onboarding.dc.html` (approximate) |

### Partial / collapsed — one mockup must become many screens
| Old | New | Gap |
|---|---|---|
| Login + Register + Forgot password | `Spandan Auth.dc.html` (single page) | 2 extra states to design |
| 13 super-admin sections (`SuperAdminView.jsx`, 1434 ln) | `Spandan Admin.dc.html` (single page) | 12 sections to design |

### ⚠️ No equivalent in the new UI — must be built from scratch
- **Website Widget** (`WidgetsView.jsx`, 793 ln) — no mockup at all.
- **`/auth/callback`** OAuth landing.
- **`/invite/accept`** invitation acceptance.
- **`BlockedNumbers`** (231 ln), **`ContactDetailsPanel`** (330 ln),
  **`WalletStatusBanner`** (106 ln), **`AIOnboardingCard`** (326 ln),
  **`SiteAssistant`** (377 ln, global floating assistant on every route),
  **`QuickLinksGrid`**, **`ChatAnalytics`** (290 ln).
- **`ApiManagementTab`** (219 ln) super-admin sub-tab.

### New mockups with no old-app equivalent (backend may or may not exist)
`Spandan AI Agent` (backend `aiAgent.routes.js` exists — UI never built),
`Spandan Intent Matching` (backend `clusters.routes.js` exists),
`Spandan Experiment Plan`, `Spandan Motion Spec`, `Spandan Legal`,
`Spandan Mobile`, `Spandan Index` (mockup gallery index — not a product page).

---

## 4. Wiring contract to preserve (from `src/lib/api.js`)
- Base: same-origin `/api/v1` (Vite proxy in dev, static-served in prod).
- `Authorization: Bearer <accessToken>` from `localStorage`.
- Session keys: `accessToken`, `refreshToken`, `user`.
- Refresh: single-flight `_refreshing` promise → `POST /auth/refresh`.
- **Only 401/403 ends a session.** 5xx and network failures must not log out
  (deliberate: the host cold-starts and was signing everyone out).
- Entry-path awareness: dead session on `/dashboard` → login; on `/` → landing.
- Guards: no workspace → `/setup`; `superAdmin` bypasses the workspace gate.
- Wallet balance refreshes on `wallet:balance-updated`, on tab focus, and on a
  slow poll — not once on mount.

---

## 5. Verification constraints (Phase 3)
Automated end-to-end verification of "every page hits the right endpoint" is
only partly possible here:
- Backend needs Postgres (Supabase pooler) + Redis reachable from this machine.
- Live third-party paths cannot be exercised without side effects: Meta/WhatsApp
  Cloud API message sends, Twilio, payment/wallet recharge, OAuth round-trips,
  Gemini/OpenAI generation.
- The `.env` holds real production-looking credentials; exercising send paths
  would dispatch real messages and spend real credit.

---

# Phase 2 — What was done (reskin approach)

Chosen approach: **reskin the existing working app**, rather than rebuild from
the mockups. Rationale: the mockups are not an app (see §1), the existing
frontend is 21k lines of working logic, and ~78% of its styling already flows
through CSS custom properties whose names map 1:1 onto the Spandan tokens.
Re-pointing the tokens re-skins the whole app with zero functional risk.

## Changes made
1. **`src/index.css` — token values swapped, token names kept.** All ~2,800
   existing `var(--x)` call sites re-skin themselves. `--green` keeps its name
   but now carries the Spandan accent (cyan); `--accent` is the alias for new
   code.
2. **`index.html`** — Plus Jakarta Sans + Syne → Space Grotesk + Manrope +
   JetBrains Mono.
3. **384 hardcoded colour literals** swapped across 32 files.
4. **245 inline `fontFamily` references** swapped (`'Syne'` → `'Space Grotesk'`,
   `'Plus Jakarta Sans'` → `'Manrope'`).
5. **`--success` / `--sbg` / `--sbd` added** and applied to status badges.

## Colour decisions
| Old | New | Note |
|---|---|---|
| `#1EBF5E` green accent | `#35e8f2` cyan | Spandan's lead accent |
| chart series `green,sky,violet,amber,pink` | `cyan,violet,lime,amber,pink` | 5 distinguishable hues, brand-aligned |
| `#f87171` danger, `#fbbf24`/`#F59E0B` warning | unchanged | semantic state colours |
| `#25D366`, `#ECE5DD`, `#53bdeb`, `#e4e0d8` | unchanged | WhatsApp client replicas in message previews — must stay authentic |
| Spandan `--t3:#565c66` | `#7a808c` | **deliberate deviation**, see below |

### The one deliberate deviation
Spandan specifies `--t3: #565c66`, which measures **2.88:1** on a panel — below
the 4.5:1 WCAG AA requires. `--t3` paints 330 labels, most at 10–12px. Lifted
within the same hue to `#7a808c` = **4.90:1**. The previous theme carried an
explicit comment about having fixed this identical bug; re-introducing it would
have been a regression. Every other token is Spandan's literal value.

### Success ≠ accent
With the accent moved to cyan, a "Completed" badge would have lost the
green-good / amber-warn / red-fail convention it sits inside. Spandan's own
palette keeps a green (`#25d366`), so status badges use `--success` while
accents (buttons, active tabs, metric tiles) stay cyan.

# Phase 3 — Verification performed

| Check | Result |
|---|---|
| `npm run build` | ✅ clean, 644 modules |
| Vite dev server | ✅ HTTP 200, no errors in log |
| Backend boot | ✅ Postgres + Redis connected, 23 migrations current, 4 workers up |
| `/api/v1/health` direct | ✅ 200 |
| `/api/v1/health` **through the Vite proxy** | ✅ 200 — frontend→backend wiring intact |
| `POST /auth/login` bad creds | ✅ 400 (correct rejection, not a crash) |
| Final palette contrast audit | ✅ all 9 tokens ≥ 4.9:1, none below 3:1 |
| **Mechanical proof of cosmetic-only diff** | ✅ 32/32 files: after normalising colour/font/status tokens, old and new are byte-identical — no logic, JSX structure, props or control flow changed anywhere |

## Not verified
- **No browser rendering check.** No Chrome extension and no
  puppeteer/playwright in the project, so the reskin was not visually
  inspected. The cosmetic-only proof is the compensating control: behaviour
  cannot have changed, but *visual* results on each page are unconfirmed.
- **Live third-party paths not exercised** — Meta/WhatsApp sends, Twilio,
  payments, OAuth, Gemini/OpenAI. `.env` holds real credentials; exercising
  these would dispatch real messages and spend real credit.
- **The repo's `tests-e2e*.mjs` suites were not run.** They write to the live
  Supabase database in `.env`. Not run without an explicit go-ahead.

## Left alone on purpose
- Product name is still **ChatFlow Pro** (title, package names, README).
  The mockups are branded "spandan"; renaming the product is a business
  decision, not a styling one.
- `backend/` untouched. The pre-existing uncommitted edit to
  `backend/src/server.js` was not modified.
- Nothing committed, nothing pushed.

---

# Round 2 — Legal page + structural UI (not just palette)

Feedback: the first pass only moved colours and gradients. This round adds the
Legal page and the structural/typographic parts of the Spandan design.

## New: Legal centre
- `src/pages/Legal.jsx` + `src/lib/legalContent.js`, from `Spandan Legal.dc.html`.
- All four documents: Terms, Privacy, Refund & Cancellation, Cookies.
- Routes `/legal`, `/legal/privacy`, `/legal/refund`, `/legal/cookies`.
  **Design deviation:** the mockup switched documents with local state, giving
  all four one address. Policy URLs must be separately linkable — Meta's
  WhatsApp onboarding and payment gateways require reachable policy links — so
  the active document is driven by the URL instead. Unknown slug → Terms.
- Public: outside every auth guard, since a signed-out visitor must reach them.
- Landing footer's Terms/Privacy/Security links pointed at `#features` — dead
  anchors. Now wired to Terms/Privacy/Refunds/Cookies.

## Structural changes from `Spandan Dashboard.dc.html`
| Change | Before | After |
|---|---|---|
| Sidebar nav | one flat 16-item list under "Menu" | banded into **COMMAND / GROW / AUTOMATE / UNDERSTAND / CONNECT** under mono eyebrows |
| Super-admin nav | flat 13 items | banded **PLATFORM / REVENUE / OPERATE / ATTEND** (no mockup exists; grouping is my call) |
| Active nav item | gradient fill + inset shadow | 2px cyan left border + `rgba(53,232,242,0.10)` fill |
| Logo mark | rounded square + WhatsApp glyph | pulsing cyan dot (`sp-pulse`), the design set's signature |
| Stat tile labels | uppercase sans | **JetBrains Mono**, 9.5px, `.1em` tracking |
| Channel card labels | uppercase sans | JetBrains Mono |
| Sidebar wallet figure | 13px sans | mono, cyan — numbers read as data |

`NAV_GROUPS` is presentational only: it references the same section ids
`ADMIN_NAV`/`ADMIN_TABS` already define, so routing and `VALID_SECTIONS` are
untouched. Any id not listed falls into a trailing "MORE" band, so a future nav
entry cannot silently vanish. Collapsed sidebar drops eyebrows for hairline
rules — the banding survives, the labels don't.

## Verification
| Check | Result |
|---|---|
| `npm run build` | ✅ clean |
| **SSR render of all 4 legal routes** | ✅ correct `<h1>`, section counts match TOC (9/8/6/4), TOC card present |
| `/legal/nonsense` fallback | ✅ falls back to Terms |
| Nav grouping completeness | ✅ 16/16 workspace + 13/13 super-admin grouped; none missing, duplicated, or phantom |
| Production SPA fallback | ✅ `/`, `/legal`, `/legal/privacy`, `/legal/cookies`, `/dashboard` all 200 text/html from the backend |
| `/api/v1/health` | ✅ 200 |

Still not visually inspected — no browser tooling available. SSR proves the
Legal page produces correct markup; it does not prove it *looks* right.

## Needs your attention
The policy text is adapted from the design set's copy and carries commercial
terms (7-day refund window, 90-day retention, liability cap at 3 months' fees,
Bengaluru jurisdiction). **It needs a legal review before going public.** The
contact addresses are placeholders (`legal@chatflowpro.app`).

---

# Round 3 — Legal integrated as a ChatFlow citizen, with ways in

The page existed but was bolted on: its own standalone shell, reachable only
from the marketing footer. Now it is part of the app.

## Structure
- `src/components/LegalCenter.jsx` — the shared body (policy switcher, TOC
  card, document, cross-links). One implementation, two shells.
- `src/pages/Legal.jsx` — public shell (own header) for `/legal/*`. Must stay
  public: Meta's WhatsApp onboarding and the payment gateway require policy
  URLs that resolve for a signed-out visitor.
- `LegalView` in `Dashboard.jsx` — the same body inside the dashboard shell,
  under `DashHeader`, as a normal section. Signed-in users no longer have to
  leave the app to read a policy.

## Five ways to reach it
| Route in | Where |
|---|---|
| **Sidebar → CONNECT → Legal** | dashboard, workspace users |
| **Sidebar → ATTEND → Legal** | dashboard, super admins |
| **Avatar menu → Legal & Policies** | any dashboard page |
| **Landing footer** | Terms / Privacy / Refunds / Cookies |
| **Signup consent line** | "By continuing you agree to our Terms and Privacy Policy" |
| Direct URLs | `/legal`, `/legal/privacy`, `/legal/refund`, `/legal/cookies` |

In-app, the chosen document rides in `?tab=` — the convention the dashboard
already uses for sub-tab deep links — so `/dashboard/legal?tab=privacy` is
linkable. `history.replaceState` swaps it without a remount.

`legal` was added to `ADMIN_NAV`/`SUPERADMIN_NAV`, so `VALID_SECTIONS` picks it
up automatically and `/dashboard/legal` validates with no routing change.

Signup previously had **no consent line at all**; it now has one, and it points
at pages a visitor can read before committing to an account.

## Verification
| Check | Result |
|---|---|
| `npm run build` | ✅ clean |
| SSR, public `/legal/*` (4 docs + bad slug) | ✅ right `<h1>`, sections 9/8/6/4, bogus → Terms |
| SSR, in-app `LegalCenter` (4 docs) | ✅ right `<h1>`, sections match, TOC present |
| Nav grouping | ✅ 17/17 workspace, 14/14 super-admin; none ungrouped or phantom |
| `legal` in `VALID_SECTIONS` | ✅ |
| `file` icon exists | ✅ |
| Live routes (backend serving dist) | ✅ `/legal`, `/legal/privacy`, `/legal/refund`, `/legal/cookies`, `/dashboard/legal`, `/dashboard/legal?tab=privacy` → all 200 |

---

# Round 4 — remaining reference pages

Re-audited every mockup against the app. The Phase 1 audit was **wrong** on two
of them: AI Agent and Intent Matching were listed as "no old-app equivalent",
but both are fully built and wired — they are tabs 4 and 5 of `AutomationView`,
calling `/ai-agent/config`, `/ai-agent/deploy`, `/ai-agent/test`,
`/ai-agent/intent-matching`. `/clusters` is likewise already used by
`ContactsView` and `CreateCampaign`.

## Added: AI Agent + Intent Matching as first-class pages
The design set's AUTOMATE band lists **AI Agent · Automation · Intent
Matching** as three destinations. In the app both were buried as tabs, hiding
two headline features behind a third page.

- New routes `/dashboard/ai-agent` and `/dashboard/intent-matching`, new
  sidebar entries in the AUTOMATE band, in the reference's order.
- Both render the **existing** `AutomationView` seeded to the relevant tab —
  no duplicated implementation, no second copy of the wiring.
- `AutomationView` gained an optional `initialTab` prop. An explicit `?tab=`
  still wins, so refresh and share links behave exactly as before.

## Deliberately not added
Four mockups are **not application screens**. Adding them to a production app
would be wrong, so they were left out:

| Mockup | What it actually is |
|---|---|
| `Spandan Index` | Gallery index *of the mockup set* — "The complete design program… jump into any surface". A navigation page for the design files. |
| `Spandan Motion Spec` | Design-system documentation — "Motion that reads like a pulse". Belongs in a design doc, not the product. |
| `Spandan Experiment Plan` | Growth/product strategy — hypotheses, primary metrics, ship/kill gates. Internal planning artifact. |
| `Spandan Mobile` | Marketing page — "Run your whole store from your pocket", three phone mock screens. **There is no mobile app in this codebase**, so shipping this would be a product claim that isn't true. |

The first three are design-program artifacts. `Spandan Mobile` is the only
judgement call: it is real marketing copy and could become a Landing section —
say the word if you want it, but it should not claim a mobile app that
doesn't exist.

## Full mockup coverage
| Mockup | Status |
|---|---|
| Landing, Dashboard, Templates, Campaigns, Campaign Builder, Campaign-AI, Contacts, Inbox, Integrations, Automation, Analytics, Chat Analysis, User Analytics, Numbers, Billing, API Keys, Support, Settings, Profile, Auth, Onboarding, Admin | already existed, reskinned |
| **Legal** | **built (round 3)** |
| **AI Agent, Intent Matching** | **surfaced as pages (round 4)** |
| Index, Motion Spec, Experiment Plan, Mobile | not product screens — see above |

## Verification
| Check | Result |
|---|---|
| `npm run build` | ✅ clean |
| Nav grouping | ✅ 19/19 workspace, 14/14 super-admin; none ungrouped or phantom |
| Every nav id has a render branch | ✅ none missing |
| `bot` / `spark` icons exist | ✅ |
| Live routes | ✅ `/dashboard/ai-agent`, `/dashboard/intent-matching`, `/dashboard/automation`, `/dashboard/legal`, `/legal/privacy` → 200 |

---

# Round 5 — endpoint audit

Static cross-check of every frontend API call against every backend route, then
a live probe of the running server.

## Static: frontend → backend
Extracted all call sites (`wFetch`, `wJson`, `adminFetch`, `apiFetch`,
`wDownload`, raw `fetch('/api/...')`), expanded them through the helpers'
prefixes (`wFetch` → `/api/v1/workspaces/:workspaceId…`, `adminFetch` →
`/api/v1/admin…`), and matched method + path against route patterns parsed from
`routes/index.js` and every route file it mounts.

| | |
|---|---|
| Frontend API call sites | **250** |
| Resolved to a real backend route (method + path) | **250** |
| **Unresolved** | **0** |
| Backend route patterns discovered | 277 |

Two earlier "mismatches" were bugs in my extractor, not the app, and both were
fixed before the final run:
- a 260-character lookahead for `method:` bled into the *next* call, labelling
  a plain `wJson('/automation/triggers')` GET as a PATCH;
- the call-span paren matcher latched onto `encodeURIComponent(` inside a
  template literal, losing the real `method: 'POST'`.

## Reverse: backend routes with no frontend caller
5 of 277 — none of them a defect:
`POST /admin/meta/test-calls`, `POST /admin/numbers/request-otp`,
`POST /admin/numbers/verify-otp`, `GET /notifications/unread-count`,
`POST /workspaces/:id/widgets/:id/rotate-key`. Ops tooling and an unused alias.

## Live probe (server running, unauthenticated)
All 109 GET routes probed against the live stack:

| Response | Count | Meaning |
|---|---|---|
| 401 | 95 | mounted and correctly guarded |
| 403 | 2 | mounted, role-gated |
| 200 | 4 | genuinely public: `/health`, `/pricing`, `/assistant/status`, `/auth/google` |
| 404 | 4 | see below |
| **5xx** | **0** | **no route crashed** |

The four 404s were **phantom paths invented by my parser**, not missing routes:
`integrations.routes.js` and `invitations.routes.js` are each mounted twice
(once workspace-scoped, once public), so the parser produced the cross-product.
Verified directly:
- `GET /api/v1/integrations/oauth/google/callback` → **302** (correct redirect)
- `GET /api/v1/invitations/faketoken` → **404** (correct "token not found")
- `/workspaces/1/integrations`, `/workspaces/1/integrations/oauth/providers`,
  `/workspaces/1/invitations` → **401** (mounted and guarded)

Incidentally confirmed working: the Google OAuth callback rejects a request
with missing/invalid state — `[Google OAuth] Rejected callback with
missing/invalid state (possible CSRF)` — so CSRF protection is live.

## Not probed
Non-GET routes were not exercised. POST/PATCH/DELETE against this stack writes
to the live Supabase database in `.env` and can dispatch real WhatsApp messages,
charge wallets, and call Meta/Twilio. Their existence is confirmed statically
(all 250 frontend calls resolve, methods included); their behaviour is not.

---

# Round 6 — visual verification (finally done)

Drove headless Chrome via `puppeteer-core` (installed in a scratch dir, **not**
added to the project). Backend + Vite both running. 12 pages screenshotted and
inspected, with console errors and network calls captured on each.

## Three real bugs found and fixed
1. **No global link reset.** `index.css` had no `a` rule, so anchors fell back
   to the browser's underline — the legal centre's header logo and the landing
   footer's policy links rendered underlined. Every mockup ships
   `a{color:inherit;text-decoration:none}`; added, with `.legal-body a` opting
   back into an underline where it's the right affordance for prose.
2. **`favicon.ico` 404 on every page load.** No icon was ever declared. Added
   an inline SVG data-URI favicon using the cyan pulse mark.
3. **Login's legal links were `href="#"`.** The sign-in screen asked people to
   agree to a Terms of Service and Privacy Policy it gave them no way to read.
   Now wired to `/legal` and `/legal/privacy`.

Also tightened sidebar band spacing: the nav went 16 → 19 items and CONNECT
fell below the fold at 900px. It always scrolled, but the tighter bands bring
API Keys back into view.

## Confirmed working on screen
Grouped sidebar (COMMAND/GROW/AUTOMATE/UNDERSTAND/CONNECT) with mono eyebrows ·
AI Agent / Automation / Intent Matching in AUTOMATE, each landing on its
correct tab with the sidebar item highlighted · pulsing cyan logo mark · active
nav = cyan wash + 2px left border · mono stat-tile eyebrows and wallet figures ·
channel cards · AI composer with chips and Guided Flow · legal centre both
public and in-app · landing, login, register, forgot-password.

**Console errors across all 12 pages after the fixes: zero.**

## How the dashboard was rendered — important
The `.env` database is **live production data**: 22 real user accounts with real
email addresses, 20 workspaces, 378 messages, signups as recent as today. So I
did **not** run `create-test-user.js` (it writes to that database) and did
**not** mint a token for an existing customer.

Instead the dashboard was rendered with **puppeteer request interception** —
every `/api/v1/*` call answered from local fixtures, nothing reaching the
backend or the database. That verifies **layout, styling and routing**, which is
what the reskin changed. It does **not** verify data wiring — that was covered
separately by the round-5 endpoint audit (250/250 calls resolved).

One apparent bug, "Used by undefined campaigns", turned out to be my fixture
returning `[]` where the real endpoint returns `{total, campaigns}` — verified
against `aiAgent.service.js`, not an app defect.

## Still unverified
Signed-in pages against **real data**, and every non-GET flow (sending a
campaign, recharging a wallet, uploading contacts). Both need either a
throwaway database or your go-ahead to create a test account in the live one.

---

# Round 7 — verified against real data (authorised)

Test account created with the repo's own `scripts/create-test-user.js`:
**test@example.com / password123**, in its own new workspace
(`Test User's Workspace`). One user + one workspace + one membership row — it
never touches existing customer data.

Then: real backend, real database, **no request interception, no injected
tokens** — signed in by typing into the actual login form.

## Bug found with real data
**`AnalyticsView` rendered a NaN bar height.** `maxBar` guarded against an
*empty* delivery array but not against a non-empty one whose sends are all
zero — i.e. every workspace that hasn't sent a campaign yet. `0 / 0 * BAR_H`
= NaN, and React warned on every render:
`NaN is an invalid value for the height css style property`.
Fixed: `Math.max(1, ...delivery.map(d => Number(d.sent) || 0))`. Re-verified
clean. This only appears with real empty data — the mocked run never hit it.

## Pages exercised against the live API
Home, Campaigns, Contacts, Templates, Inbox, Analytics, Chat Analysis, User
Analytics, Automation, AI Agent, Intent Matching, Website Widget, Integrations,
Number Setup, Payments, API Keys, Support, Settings, Profile, Legal, Campaign
Builder — **21 pages**.

**Non-2xx API responses: none. Console errors: none** (after the NaN fix).

Every page was confirmed hitting its real endpoints, e.g. Contacts →
`/contacts`, `/clusters`, `/segments`, `/contacts/tags`; Settings →
`/settings`, `/members`, `/invitations`, `/blocked-numbers`,
`/settings/invoices`, `/analytics/chat`.

## Auth flow — end to end
| Step | Result |
|---|---|
| `/dashboard` signed out | → `/login` |
| Wrong password | `401`, "Invalid credentials" shown, stays on `/login` |
| Correct password | → `/dashboard`, tokens stored |
| `/login` while signed in | → `/dashboard` |
| **Real mutation** | **`200 PATCH /workspaces/:id/settings`** |
| Sign out via avatar menu | → `/`, `accessToken` and `user` both cleared |
| `/dashboard` after sign-out | → `/login` |

## Empty states confirmed on screen
Red "Wallet Status: Empty" banner, ₹0.00 rendered in the danger colour, "Last
Recharge —" / "No recharges yet", "No number connected", "No campaign sends in
the last 7 days yet". All correct for a fresh workspace.

## Cleanup — done
The test account has been **deleted**. Before deleting, the safety conditions
were re-asserted by id (email matches `test@example.com`, workspace has zero
other members) so the delete could not reach anything else. Workspace then user,
both by explicit id.

| | before | after |
|---|---|---|
| users | 23 | **22** |
| workspaces | 21 | **20** |
| contacts | 57 | **57** (untouched) |
| messages | 378 | **378** (untouched) |

22 users / 20 workspaces is exactly the pre-existing state recorded in round 6.
`POST /auth/login` with those credentials now returns `Invalid credentials`, and
the email lookup returns null. The database is back to how it was found.

## Genuinely still unverified
Flows that spend money or message real people: sending a campaign (Meta/WhatsApp
Cloud API), wallet recharge (payment gateway), Twilio voice, OAuth round-trips
to third parties. These need a sandbox, not a test row.

---

# Round 8 — gradients, identity marks, colour

The reskin had moved the palette but kept every fill flat. The design set's two
signature gradients were missing entirely.

## Gradient vocabulary (counted from the mockups)
| Gradient | Uses in design set | Role |
|---|---|---|
| `135deg, #c4ff46 → #35e8f2` (lime→cyan) | **31** | primary call to action |
| `135deg, #9d6bff → #35e8f2` (violet→cyan) | **16** | identity marks — avatars, badges |
| `135deg, #25d366 → #0f9d58` | 4 | WhatsApp-specific |

Added as tokens: `--grad-cta`, `--grad-cta-hot`, `--grad-identity`, `--grad-wa`,
and `--ink` (`#06110f`) for text sitting on a gradient.

## Bug found
**Every primary button flashed green on hover.** `Btn`'s primary hover was still
hardcoded `#22d468` — a green from the pre-Spandan theme that the palette
sweep's fixed mapping never covered. Now `--grad-cta-hot`.

Four other survivors from the same class were remapped: `#10b981` and `#22c55e`
→ `--success` green, `#34D399` → lime, `#b8f3b8` → accent. Google's `#34A853`
and WhatsApp's `#25d366` were left alone — those are third-party brand marks.

## Applied
- **`Btn` primary** → lime→cyan gradient, dark ink, lift + glow on hover.
- **`Avatar`** → filled brand gradient with dark ink initials, replacing the
  tinted outline. The pair is picked from the name hash so people in a list stay
  tellable apart rather than every avatar being identical.
- **6 hand-rolled primary CTAs** that bypass `Btn` (AI onboarding, auth
  callback, automation wizard, 2× integrations, super-admin invite) → gradient.
- **AI composer Send** and the login-required modal CTA → gradient.
- Sidebar plan label → mono uppercase.

Deliberately **not** gradiented: count badges, unread pills and "Most popular"
ribbons. A gradient across a 17px pill just reads as mud — those stay flat.

## Contrast of ink on gradient
| Gradient | worst point | ratio |
|---|---|---|
| CTA (lime→cyan) | cyan end | **12.77:1** |
| Identity (violet→cyan) | violet end | **5.46:1** |

Both pass AA across their whole length.

## Verified
Build clean · re-checked on screen with a real signed-in session · Home,
Settings, Payments, Integrations → **no non-2xx, no console errors**.

Test account created for this pass and **deleted again afterwards** — back to
22 users / 20 workspaces / 57 contacts / 378 messages, email lookup returns null.

---

# Round 9 — emoji nav icons (as requested)

I'd argued for keeping the SVG icon set; you asked for the mockups' emoji, so
that's what's shipped. Noting the trade-off here rather than re-arguing it.

## What was done
All 17 sidebar glyphs were extracted programmatically from the design set's own
`navData()` in `Spandan Dashboard.dc.html` — not guessed: Home, Inbox,
Campaigns, Templates, Contacts, AI Agent (U+2726), Automation (U+26A1), Intent
Matching, Analytics, Chat Analysis, User Analytics, Integrations, Number Setup,
API Keys, Payments, Help & Support, Settings.

Fourteen more had no counterpart in the design set and were chosen to sit with
them: Website Widget, Legal, and the twelve super-admin sections.

The two channel tiles on the dashboard also take the design set's emoji.

Written as `\u{...}` escapes in `NAV_EMOJI`, so the source file stays ASCII and
survives any editor or terminal that isn't UTF-8 clean.

## The trade-off, recorded
- **Colour emoji ignore `currentColor`**, so they do not tint with the active
  state. The active row is still unmistakable — fill, left border, bolder label.
- **They render differently per platform.** These screenshots are Chrome on
  Windows; macOS, Android and Linux will each differ. Inherent to emoji, not
  something the code can normalise.
- **Two are text glyphs, not emoji** — U+2726 (AI Agent) and U+26A1
  (Automation). Those *do* follow the text colour and carry less visual mass, so
  they render a size larger to sit level with the bitmap ones.
- The SVG icon set is untouched and still used everywhere else in the app.

## Verified
Build clean · real signed-in session · Dashboard and Legal → no non-2xx, no
console errors · glyphs legible at 14.5/15.5px in an 18px cell.

Test account created for this pass and deleted again — 22 users / 20 workspaces
/ 57 contacts / 378 messages, unchanged.

---

# Round 10 — renamed ChatFlow Pro → Spandan

**107 occurrences across 42 files.**

## Renamed
- **Wordmark** — the two-tone `ChatFlow<span cyan>Pro</span>` lockup collapsed to
  the design set's own treatment: lowercase **`spandan`**, single colour, Space
  Grotesk 700. 8 render sites (landing ×2, login, register, forgot-password,
  workspace setup, dashboard sidebar, legal header).
- **Frontend copy** — page title, wallet banner, analytics, API keys, payments,
  integrations, widgets, campaign builder, site assistant, legal documents.
- **Backend user-facing output** — email templates (14), invoice HTML, help
  content (7), marketing site content (5), widget "Powered by" credit, widget
  loader banner, onboarding, assistant, server boot log.
- **Package identity** — `chatflow-pro-backend` → `spandan-backend`,
  `chatflow-pro-frontend` → `spandan-frontend`, with the matching `name` fields
  in both lockfiles so package and lock agree.
- **Live docs** — README.md, DEPLOY.md, backend/README.md, docs/PUBLIC_API.md.

## Deliberately NOT renamed
| What | Why |
|---|---|
| `render.yaml` service names (`chatflow-pro`, `chatflow-redis`) | Renaming a service in a Render blueprint **provisions a new service** rather than renaming the existing one — the live deploy, its Redis instance and every dashboard env var would be orphaned. `chatflow-redis` is also referenced by `fromService.name` for `REDIS_URL`. This is a deploy-console operation, not a code edit. |
| Historical reports — `BUGS.md`, `BUGS-v2.md`, `STABILIZATION_REPORT*.md`, `AI_FEATURES_REPORT.md`, `issue_sheet.md` | Dated records of what happened at the time. Rewriting them falsifies history. |
| `.env` | Not tracked, and `CHATFLOW_PRO_URL` in it is **dead** — no code reads it. |
| The repo directory name | Filesystem path; renaming it breaks every local path and the git remote. |

## ⚠️ Needs your decision: the domain
The crawler's user agent carried a real domain, and the blanket rename moved it:

```
- 'ChatFlowProBot/1.0 (+https://chatflow.pro/bot; website analysis…)'
+ 'SpandanBot/1.0 (+https://spandan.pro/bot; website analysis…)'
```

This string is **sent to third-party websites** when the widget analyses them.
I do not know whether `spandan.pro` is yours. Also `legal@spandan.app` in the
legal centre came from the design set's copy, not from you. **Both need the real
domain before this ships.** `backend/src/lib/siteCrawler.js:22`,
`frontend/src/components/LegalCenter.jsx:57`.

## Verified
Build clean · backend boots (`[Server] Spandan backend running on port 4000`) ·
real signed-in session, Dashboard + Legal → no non-2xx, no console errors ·
no mangled artefacts (`spandan-pro`, `SpandanPro`, doubled tokens) — checked.

Test account created for this pass and deleted again — 22 users / 20 workspaces
/ 57 contacts / 378 messages, unchanged.

---

# Round 11 — bug: Intent Matching / AI Agent showed the Automation panel

Reported: clicking **Intent Matching** in the sidebar behaved the same as
Automation. Reproduced before touching anything — the URL changed correctly to
`/dashboard/intent-matching` while the panel stayed on **Basic Automations**.

## Root cause
`/dashboard/automation`, `/dashboard/ai-agent` and `/dashboard/intent-matching`
all render `<AutomationView>` **at the same position in the element tree**.
React reconciles by type + position, so moving between them never remounts the
component — and `activeTab` was a `useState` **lazy initialiser**, which runs
only on first mount. It read `'basic'` once and nothing ever changed it again.

The routes I added in round 4 were therefore only ever correct on a fresh page
load. Every in-app navigation between the three silently kept the old tab. The
round-4 verification checked HTTP status and console errors, which were clean —
it never asserted *which panel rendered*, so this slipped through.

## Fix
1. **`AutomationView` follows the prop.** An effect syncs `activeTab` whenever
   `initialTab` changes, which is what actually switches the panel when React
   reuses the instance.
2. **Every branch passes an explicit tab.** `/dashboard/automation` now passes
   `initialSubTab || 'basic'`; leaving it `undefined` meant navigating *back*
   from Intent Matching passed nothing, the effect ignored it, and the AI-intent
   panel stayed up.
3. **Tabs write their owning path.** `TAB_ROUTES` maps `wa-agent` →
   `/dashboard/ai-agent` and `ai-intent` → `/dashboard/intent-matching`; other
   tabs stay on `/dashboard/automation?tab=`. `selectTab` writes that path and
   fires a `popstate`, so URL, panel and sidebar highlight agree in **both**
   directions. It re-renders without remounting, so no fetch repeats.

## Verified — asserting the rendered panel, not just the status code
| Action | URL | Panel | Sidebar |
|---|---|---|---|
| click Automation | `/dashboard/automation` | BASIC AUTOMATIONS | Automation |
| click Intent Matching | `/dashboard/intent-matching` | AI INTENT MATCHING | Intent Matching |
| click AI Agent | `/dashboard/ai-agent` | WHATSAPP AI AGENT | AI Agent |
| click Intent Matching | `/dashboard/intent-matching` | AI INTENT MATCHING | Intent Matching |
| click Automation | `/dashboard/automation` | BASIC AUTOMATIONS | Automation |
| tab "AI Intent Matching" | `/dashboard/intent-matching` | AI INTENT MATCHING | Intent Matching |
| tab "WhatsApp AI Agent" | `/dashboard/ai-agent` | WHATSAPP AI AGENT | AI Agent |
| direct load of all three URLs | correct | correct | — |

No console errors. Test account created for this pass and deleted again —
22 users / 20 workspaces / 57 contacts / 378 messages, unchanged.

---

# Round 12 — swept the rest of the app for the same bug class

Asked to check other pages for the round-11 issue. Found **two more instances
and a deeper root cause** than round 11 had identified.

## Audit method
Enumerated every component rendered by more than one route branch, plus every
component seeding state from a prop or from `window.location` in a `useState`
initialiser. Then reproduced each candidate in a browser before touching it.

| Component | Verdict |
|---|---|
| `AutomationView` ×3 routes | fixed in round 11 |
| `SuperAdminView` (12 admin sections) | **safe** — consumes `tab` directly in render, never seeds state |
| `PaymentsView` | **BUG** — reproduced |
| `LegalView` | **BUG** — reproduced |
| `Login` / `Register` invite token | safe — separate top-level routes, always mount fresh |
| `NumberSetupView` OAuth message | safe — single route, read once on return |
| `CreateCampaign` | safe — already keyed on `editingCampaignId` |

## The real root cause (round 11's fix was incomplete)
`App.jsx` kept **only `window.location.pathname`** in state:

```js
const onPop = () => setPath(window.location.pathname);
```

Navigating `/dashboard/payments?tab=invoices` → `/dashboard/payments` leaves the
pathname **identical**. `setPath` is handed the value it already holds, React
bails out of the re-render, and `Dashboard` never re-runs — so `initialSubTab`
never recomputes and no prop-sync effect can fire. Any navigation that changes
**only the query string** was invisible to the router.

Round 11 appeared fixed only because AutomationView's pathname genuinely changed
(`/automation` → `/intent-matching`).

**Fix:** `App` now tracks the query string as its own state and threads it to
`Dashboard` as `routeSearch`; `Dashboard` reads that instead of
`window.location.search` at render time. Route matching still compares
pathnames, so no guard behaviour changed.

Plus prop-sync effects on `PaymentsView` and `LegalView`, and explicit tab
defaults on both branches so navigating *back* resets.

Also repointed the "Agent Settings" quick link from `automation?tab=wa-agent`
to the `ai-agent` section, so it no longer shows the AI Agent panel with
Automation highlighted in the sidebar.

## Verified
| Case | Before | After |
|---|---|---|
| `payments?tab=invoices` → sidebar Payments | stayed on **Invoices** | resets to **Wallet** |
| `legal?tab=privacy` → sidebar Legal | stayed on **Privacy Policy** | resets to **Terms & Conditions** |
| Automation ↔ AI Agent ↔ Intent Matching | — | still correct (regression checked) |
| Direct loads of all three automation URLs | — | still correct |
| All 15 dashboard pages | — | no non-2xx, no console errors |

## Known remaining edge
A bookmarked `/dashboard/automation?tab=wa-agent` still renders the AI Agent
panel with **Automation** highlighted. Nothing in the app generates that URL any
more; only an old bookmark reaches it. Left alone rather than adding a redirect.

Test account created for this pass and deleted again — 22 users / 20 workspaces
/ 57 contacts / 378 messages, unchanged.
