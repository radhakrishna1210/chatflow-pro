# Svann — full audit, security review and rebrand (November 2026)

**Result:** about 250 issues found across every module; about 235 fixed, each with a regression test where practical. Backend suite: **575/575 passing** (up from 411/413 at the start, ~160 new tests). Frontend production build passes. Every module was also clicked through in a real browser (Chromium, 1440px and 390px) as Admin, Member, Agent and Viewer.

Detailed per-module reports, with one row per finding (file:line, failure scenario, fix, test): [`docs/audit-2026-11/`](docs/audit-2026-11/).

## Findings by module

| Module | Report | Critical | High | Medium | Low/Info | Fixed |
|---|---|---|---|---|---|---|
| Auth, identity, middleware | [auth-security](docs/audit-2026-11/auth-security.md) | – | 4 | 9 | 13 | 18 / 26 |
| WhatsApp messaging, inbox, templates | [messaging](docs/audit-2026-11/messaging.md) | 3 | 3 | 10 | 10 | 26 / 26 |
| Messaging follow-up (OAuth state, public API) | [messaging-followup](docs/audit-2026-11/messaging-followup.md) | – | 3 | 8 | 1 | 12 / 12 |
| Campaigns, wallet, billing | [campaigns-billing](docs/audit-2026-11/campaigns-billing.md) | 1 | 5 | 10 | 4 | 20 / 20 |
| Razorpay webhook follow-up | [billing-followup](docs/audit-2026-11/billing-followup.md) | – | 1 | 1 | 2 | 4 / 4 |
| AI, automation, public widget | [ai-automation](docs/audit-2026-11/ai-automation.md) | 1 | 9 | 10 | 6 | 24 / 26 |
| CRM backend | [crm-backend](docs/audit-2026-11/crm-backend.md) | – | 6 | 19 | 8 | 27 / 33 |
| CRM frontend | [crm-frontend](docs/audit-2026-11/crm-frontend.md) | – | 5 | 12 | 9 | 26 / 26 |
| Admin, settings, integrations | [admin-settings](docs/audit-2026-11/admin-settings.md) | – | 3 | 11 | 11 | 24 / 25 |
| App shell, dashboard, contacts | [frontend-shell](docs/audit-2026-11/frontend-shell.md) | – | 3 | 18 | 21 | 41 / 42 |
| Coordinator (deploy, landing, repo) | this file | – | 4 | 4 | 3 | 11 / 11 |

## The ones that mattered most

**Critical**
- **Free wallet money.** `POST /wallet/recharge` (a demo endpoint) let any workspace admin add ₹1,00,000 per call in production.
- **Inbound media was lost.** Every image, voice note, video and document a customer sent was rejected by the webhook and dropped.
- **Receipts never recorded.** No delivery or read receipt was saved, so inbox ticks and campaign delivered/read counters never moved.
- **Media leaked across workspaces.** A member of one workspace could download another workspace's conversation media.
- **Internal network reachable.** The widget knowledge-URL indexer fetched internal hosts (cloud metadata, localhost services) and stored the response for the tenant to read.

**High (selection)**
- **Account takeover through Google sign-in.** It linked accounts by email without `email_verified`; with `ADMIN_EMAIL`, that meant platform super-admin.
- **Viewers and agents could mint API keys** with `messages:send` through the OAuth consent screen.
- **OAuth connect CSRF.** Instagram and integration callbacks could link a victim's account or tokens into an attacker's workspace.
- **One shared rate-limit bucket in production.** `TRUST_PROXY_HOPS` was unset, so 20 wrong passwords from anyone would have locked everyone out.
- **The 24-hour window wasn't enforced** for inbox text; the debug endpoints that reopen it were live in production.
- **Template edits never reached Meta.**
- **Public API and API Playground sends** skipped billing, the 24-hour window, approved-template checks and the inbox record. The Playground button was also never mounted, so it always returned 404.
- **Campaigns:**
  - resume never worked;
  - a worker restart stranded campaigns as RUNNING;
  - the audience could be edited after charging;
  - duplicate numbers were sent twice;
  - replayed Razorpay payments re-activated add-ons for free;
  - there was no Razorpay webhook, so closed-tab payments were never credited.
- **CRM:**
  - lead and deal status filters returned nothing and bypassed record visibility;
  - colleagues' tasks, line items, quotes and reports were readable and editable;
  - owner ids from other workspaces were accepted.
- **AI agent actions could write to other tenants' leads.** Waiting workflows could run twice and send duplicate messages.
- **Stored HTML injection in notification emails** sent to every member.
- **Broken basic flows:**
  - tasks could not be completed;
  - bulk task creation always failed;
  - saved views always failed;
  - the Lead Capture toggle never saved;
  - the Zapier setup pointed at a 404.
- **Fresh deploys were impossible.** The migrations cannot build a database from empty. Fixed with `scripts/migrate-or-bootstrap.js`.
- **Leads required an email by default**, so leads from WhatsApp (phone only) failed to create.
- **Seed scripts** hard-coded a real customer workspace and seeded every workspace. They are now local-only and need an explicit workspace id.

## Security work beyond the module audits
- **Static analysis:** Semgrep ran with the open JavaScript, Node, React, Express, JWT and secrets rules plus the Trail of Bits rules. Every high-signal hit was triaged in a module report, as fixed or as a documented false positive.
- **Dependencies:** `npm audit fix` (non-breaking) closed the critical `proxy-addr` advisory and others. Remaining items needing major upgrades are nodemailer, zod and csv-parse.
- **Route sweep:** a script walked all 475 API routes. Every workspace route checks membership, and every `/admin` route requires super-admin. Cross-tenant requests to each resource return 403/404.
- **Repo hygiene:** `backend/dump.rdb` is no longer tracked; local Redis writes queued email/OTP jobs into it.
- **CI** (`.github/workflows/`):
  - tests against Postgres and Redis, plus the frontend build;
  - Semgrep with SARIF upload;
  - dependency audit;
  - a diff-scoped Strix pentest on pull requests, which runs once the `STRIX_LLM` and `LLM_API_KEY` secrets are added.

## Brand, landing page and SEO
- **Rename:** the product is Svann everywhere a user can see it. Kept as-is on purpose:
  - the `X-ChatFlow-*` webhook headers, which customers verify against;
  - one localStorage key;
  - one resource URL slug.
- **Palette:** defined once as three RGB tokens in `frontend/src/index.css` (`--accent-rgb`, `--violet-rgb`, `--lime-rgb`, plus `--on-accent`), and all rgba() washes derive from them. Hex literals remain where components append alpha digits.
  - **The svann.in colours have not been applied yet:** the session's network policy blocks that domain.
- **Landing page:**
  - new sections: "How it works" in three steps, a comparison table, an industries marquee;
  - new motion: scroll progress, a gradient headline, live-event toasts, all honouring reduced-motion;
  - a mobile menu;
  - fixes:
    - the logo click logged the user out;
    - "Get started" went to login instead of sign-up;
    - every footer link went nowhere.
- **SEO:**
  - description, canonical, Open Graph/Twitter cards and a 1200×630 share image;
  - JSON-LD (Organization, SoftwareApplication, FAQPage) generated at build time from the same copy the page renders;
  - sitemap and robots.txt generated from the list of public routes, with the origin taken from `VITE_SITE_URL` (default `https://svann.in`).

## Needs your decision (not changed)
- **List pagination.** Lead, deal, task, ticket and quote lists aren't paginated; this needs an API and UI change together.
- **CRM permission matrix.** It is saved but never enforced. Agents can't log activities.
- **Mixed currencies.** Pipeline totals add deal values in different currencies.
- **Unmapped campaign variables.** Campaign variables `{{2}}` and up that aren't mapped send the template's sample value to everyone (documented product decision); the API and inbox now refuse instead.
- **Website-suggested workflows** are saved active in one click; saving them inactive would be safer.
- **Sessions after a password reset.** Access tokens stay valid up to 15 minutes afterwards. OAuth codes have no PKCE. Tokens live in localStorage.
- **Payment edge cases.** Cancelling mid-send can let one in-flight message go out unpaid. Razorpay payments created outside the app are acknowledged, not credited.

## Action needed at deploy time
1. **Razorpay webhook.** In the Razorpay dashboard, add a webhook to `https://<api>/api/v1/webhooks/razorpay` for `payment.captured` and `order.paid`. Set `RAZORPAY_WEBHOOK_SECRET`. See DEPLOY.md §6.
2. **Proxy hops.** `TRUST_PROXY_HOPS` is set to 1 in `render.yaml`. Set it on VPS/nginx deployments too, and raise it if a CDN is added.
3. **Schema drift check.** Existing databases have only been changed with `db push` / manual SQL. Check for drift once with `npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma`.
4. **Test data.** The audit created only local test data: workspaces and users with `audit`, `crmbe-`, `as-` or `fs-` in their names.
