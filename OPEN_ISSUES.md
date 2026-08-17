# Open Issues

Unresolved items as of 2026-08-16, branch `aditya-advanced-crm`. Nothing here is
hidden or downgraded — anything not verified is listed.

## OPEN-001 — Migration history cannot be replayed from scratch — RESOLVED (2026-08-17)

**Severity:** High · **Area:** `backend/prisma/migrations/`

**Now reproduced from scratch**, not merely inferred. Against a brand-new empty
local database, `npx prisma migrate deploy` fails on the first migration it
tries:

```
Applying migration `20260717073845_add_subscription_models`
Error: P3018   ERROR: relation "Workspace" does not exist
```

There is no baseline migration creating the core tables, so the history only
applies to a database that already has them. A new environment therefore cannot
be provisioned from migrations alone.

**Workaround in use:** `npx prisma db push`, which the repo already expects —
`src/server.js` logs *"Skipped migrate deploy in development (use db push)"*.
This produces a correct 55-table schema but leaves `_prisma_migrations` empty,
so the history stays unreplayable.

**Resolved** by squashing the history into a single verified baseline. The 32
previous migrations moved to `prisma/migrations_archive/` with a README
explaining why; `prisma/migrations/00000000000000_baseline/` replaces them.

Verified on a scratch database rather than asserted:

```
prisma migrate deploy                          → applied, from empty
prisma migrate diff --from-url <scratch>
       --to-schema-datamodel --exit-code       → No difference detected. (exit 0)
```

The baseline is marked applied on the local development database, so
`migrate status` now reports *"Database schema is up to date!"* instead of an
empty `_prisma_migrations`.

**Still to do on the hosted database, by a human:** the baseline must be marked
applied there with `prisma migrate resolve --applied 00000000000000_baseline` —
but only after OPEN-002 is resolved, or the existing drift gets frozen in place
and presented as correct. This branch is under a standing local-database-only
instruction and `scripts/assert-local-db.js` blocks the remote connection, so it
was deliberately not attempted here.

Original symptom, via the shadow database:

```
Error: P3006
Migration `20260717073845_add_subscription_models` failed to apply cleanly to the
shadow database.
Error code: P1014
The underlying table for model `Workspace` does not exist.
```

A pre-existing migration in the history cannot run against an empty database, so
Prisma's shadow-database validation is unusable. The Lead/Deal migration was
therefore generated with `migrate diff` and applied as reviewed SQL.

**Consequence:** a new environment cannot be provisioned with `migrate deploy`
from this history. Existing databases are unaffected.

**Next action:** repair `20260717073845_add_subscription_models` so it is
self-contained, or squash the history into a verified baseline.

## OPEN-009 — A stale production credential sits in `backend/.env.bak`

**Severity:** High · **Area:** repository / secrets

`backend/.env.bak` contains a commented-out `DATABASE_URL` for a Supabase
instance holding **real customer workspaces** (`Labhesh Pahade's Workspace`,
`Radhakrishna Thete's Workspace`, `Aditya Wattamwar's Workspace`,
`Sampada Kulkarni's Workspace`) and live deals.

It was found while restoring `.env` after that file was changed to point at an
unreachable `localhost:5433`. Reconstructing the connection from `.env.bak`
reached that database. Only two read queries were issued — a `count` and one
`findMany` — and the config was reverted immediately on recognising the
workspace names. No writes, no migrations, no tests ran against it.

The file is untracked but present in the working tree, so a broad `git add`
would commit live credentials.

**Next action:** delete `backend/.env.bak`, or move it outside the repo and
rotate the credential. Then confirm `.env*` is covered by `.gitignore`.

**Mitigated by:** `backend/scripts/assert-local-db.js`, which now refuses any
database operation whose URL names a managed provider or a non-loopback host.
See `docs/LOCAL_DEV_DATABASE.md`.

## OPEN-002 — Live database has drifted from `schema.prisma`

**Severity:** High · **Area:** database

The configured Supabase database contains objects absent from this branch's
schema:

- Tables: `Widget`, `WidgetSession`, `WidgetEvent`, `IntentRule`,
  `IntentMatchEvent`, `KnowledgeSource`, `SiteKnowledgeChunk`, `AdminAuditLog`,
  `ConversationNote`
- Columns: `Workspace.aiAgentInstructions`, `aiAgentLanguages`, `aiAgentPurpose`,
  `aiAgentSafetyNote`, `brandColor`, `brandLogoUrl`, `escalationRules`,
  `escalationThreshold`, `industry`, `timezone`; `Campaign.goal`;
  `Contact.updatedAt`
- Enums: `WidgetEventType` and others

These appear to belong to another branch already applied to the shared database.

**Consequence:** any unreviewed `prisma migrate diff --script` against this
database emits `DROP TABLE` / `DROP COLUMN` for all of the above. Running one
would destroy another branch's data.

**Mitigation applied:** only the additive `CREATE TYPE` / `CREATE TABLE` /
index / FK statements were extracted and applied. No drop ever ran.

**Next action:** reconcile the branches before anyone runs a generated migration
unreviewed. Treat `migrate diff` output on this database as unsafe by default.

## OPEN-003 — Browser UI verification — MOSTLY RESOLVED

**Severity:** Low (was Medium) · **Area:** `frontend/src/pages/*`

Verified in the browser against the running app with an authenticated session
on 2026-08-16. Three display defects were found and fixed (DEF-006/007/008 in
`TEST_EVIDENCE.md`).

**Confirmed working:** `CrmDashboardView` (KPIs, six-month chart, stage donut,
deals-in-progress, overdue tasks), `LeadsView` (list, filters, detail panel,
score recalculation with full factor breakdown), `DealsView` (all six kanban
columns, per-stage counts and totals, health indicators, keyboard stage moves
persisting with audit history), `TasksView` (pending/overdue/completed tabs,
overdue badge, related-record links), and the command palette (opens, focuses,
searches, prettified labels, ARIA roles).

**Still not verified:** mouse drag-and-drop specifically (keyboard equivalent
covers the same code path and was verified); the optimistic **rollback** path on
a failed stage change; responsive breakpoints; reduced-motion rendering. The
Browser pane renders at a fixed small size, so responsive checks need a real
browser.

**Next action:** exercise rollback by stopping the API mid-move, and check
breakpoints in a resizable browser.

## OPEN-004 — Accessibility — PARTIALLY RESOLVED

**Severity:** Medium · **Area:** `frontend/src/pages/*`, `components/*`

§73 asks for WCAG 2.2 AA.

**Done:** the pipeline board was drag-and-drop only, with no keyboard path to
move a deal — a hard keyboard-operability failure. Deal cards are now focusable
(`role="button"`, `tabIndex=0`) with `Enter`/`Space` to open and `Alt+←/→` to
move a stage, routed through the same optimistic-with-rollback path as a drop.
Deal-health indicators carry an `.sr-only` text equivalent so the band is not
conveyed by colour alone (WCAG 1.4.1). The command palette is keyboard-first
with `role="dialog"`/`listbox`/`option` and arrow-key navigation.

**Still open:** no contrast audit, focus-order audit, or screen-reader pass has
been run across the CRM screens. Focus is not trapped inside modals, and there
is no visible focus ring style beyond the browser default.

**Next action:** audit contrast ratios against the dark palette, add focus
trapping to `Modal`, and verify with a screen reader.

## ~~OPEN-005 — `prefers-reduced-motion` not implemented~~ — WITHDRAWN, was incorrect

**Filed in error.** `frontend/src/index.css` already carries a correct
`@media (prefers-reduced-motion: reduce)` block that neutralises animation
duration, iteration count and transition duration globally, resets
`scroll-behavior`, and un-hides `.reveal` elements. §71 is satisfied.

This issue was raised without reading the stylesheet. Recorded rather than
deleted so the correction is visible.

## OPEN-006 — No frontend test runner

**Severity:** Medium · **Area:** `frontend/`

`frontend/package.json` has no test framework. Component, form, filter and error
states named in §89 have no automated coverage. Backend coverage is 22 tests via
`node:test`.

## OPEN-008 — Frontend bundle size — PARTIALLY RESOLVED

**Severity:** Low (was Medium) · **Area:** `frontend/`

Was a single 1,302.84 kB entry chunk (gzip 331.31 kB) with no code splitting.

**Done:** Recharts split into its own chunk via `manualChunks`, and
`CrmDashboardView` lazy-loaded behind `React.lazy` + `Suspense`, so charts are
fetched only when that screen is opened.

```
before  index      1,302.84 kB │ gzip 331.31 kB   (everything)

after   index        764.58 kB │ gzip 170.93 kB   (entry, -41%)
        charts       534.37 kB │ gzip 160.31 kB   (deferred)
        CrmDashboard  14.33 kB │ gzip   3.50 kB   (deferred)
```

**Still open:** the 764 kB entry chunk remains above Vite's 500 kB warning
threshold — the other ~20 pages are still eagerly imported by `Dashboard.jsx`.

Splitting React into its own vendor chunk was tried and reverted: it produced a
0.92 kB shim while React stayed in the entry chunk, costing an extra request for
no benefit. React is needed on first paint regardless.

**Next action:** lazy-load the remaining heavy views (`AnalyticsView`,
`SuperAdminView`, `CreateCampaign`, `AutomationView`) the same way.

## OPEN-007 — Uncommitted work and stray files

**Severity:** Low · **Area:** repository

All CRM work is uncommitted (untracked or unstaged). The working tree also holds
debris unrelated to this feature: `backend/query.js`, `backend/query2.js`,
`backend/.env.bak`, `backend/migration.sql`, `open-chrome-profile.mjs`,
`playwright-report/`, `test-results/`.

`backend/.env.bak` is worth attention — verify it holds no live secrets before
anything is staged.

## Deliberately out of scope

Not defects. Agreed with the user and recorded in
`ADVANCED_CRM_GAP_ANALYSIS.md`: the agentic layer, the CRM Chat/Copilot, and
every Tier-2/Tier-3 capability listed there.
