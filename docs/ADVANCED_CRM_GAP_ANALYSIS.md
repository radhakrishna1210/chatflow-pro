# Advanced CRM — Gap Analysis

Companion to `ADVANCED_CRM_EXISTING_FEATURES.md`. Every capability named in
`frontend/MS_Prompt.md`, with what exists today and what building it would actually take.

Effort key: **S** ≈ 1 day · **M** ≈ 2–4 days · **L** ≈ 1–2 weeks · **XL** ≈ 3+ weeks

## Built

| Capability | State | Backend | DB | UI | Tests |
|---|---|---|---|---|---|
| Lead management | Built | `leads.service.js` | `Lead` | `LeadsView` | 8 unit + 5 txn |
| Lead scoring (deterministic, explainable) | Built | `leadScoring.service.js` | `score`, `scoreFactors` | Score card w/ factor bars | 8 unit |
| Lead → Deal conversion | Built | `convertLead` `$transaction` | `convertedDealId` | Convert modal | 2 txn |
| Deal / pipeline management | Built | `deals.service.js` | `Deal` | `DealsView` board + table | 3 txn |
| Stage history / audit | Built | `updateDealStage` | `DealStageHistory` | Timeline in detail modal | 1 txn |
| Task work queue | Built | `tasks.service.js` | `Task` | `TasksView` | 4 isolation |
| Activity log + unified timeline | Built | `activities.service.js` | `CrmActivity` | Deal timeline | covered indirectly |
| Reporting dashboard | Built | `crm-analytics.service.js` | — | `CrmDashboardView` | 5 aggregate |
| Deal health / pipeline intelligence | Built | `dealHealth.service.js` | reuses `DealStageHistory` | Card dots + factor panel | 14 unit |
| Global CRM search | Built | `search.service.js` | — | Command palette | 5 |
| Command palette (⌘K) | Built | — | — | `CommandPalette.jsx` | browser-verified |
| Saved views | Built | `savedViews.service.js` | `SavedView` | `SavedViews.jsx` on Leads + Deals | 7 |

## Deferred during the build — now delivered

| Capability | Why deferred | Effort |
|---|---|---|
| ~~Agentic layer~~ | **DONE** — see the agentic layer section at the end. Built as a Postgres work queue plus a BullMQ schedule rather than a separate deployment | XL |
| ~~CRM Chat / Copilot~~ | **DONE (partial)** — NL Q&A over the CRM with a bounded tool loop. The describe-an-automation → deployable-workflow compiler was **not** built | XL |

## Not built — ranked by value per unit of effort

### Tier 1 — completes what already exists

| Capability | Existing foundation | What's needed | Effort |
|---|---|---|---|
| ~~Saved views~~ | — | **DONE** — `SavedView`, private/shared, author-owned | S |
| ~~Global CRM search + command palette~~ | — | **DONE** — `/search` + `CommandPalette.jsx` | M |
| ~~Deal health / stale detection~~ | — | **DONE** — `dealHealth.service.js` | S |
| ~~Configurable pipeline stages~~ | — | **DONE (partial)** — see note below | M |
| ~~Forecasting~~ | — | **DONE** — `forecast.service.js` + `ForecastView.jsx` | M |
| ~~CRM import/export~~ | — | **DONE** — preview-first lead import; guarded CSV export for leads/deals/tasks/products | M |
| ~~Custom fields~~ | — | **DONE** — `CustomFieldDefinition` + validated JSON values on leads and deals | L |

**Tier 1 is complete.**

### Note on configurable stages — a deliberate partial

`PipelineStage` is a **per-workspace configuration table keyed to the existing
`DealStage` enum**, not a replacement for it. Workspaces can relabel, reorder,
hide and reweight the six built-in stages, and the win probability drives the
forecast.

Replacing the enum with a foreign key would have touched `Deal.stage`,
`DealStageHistory.fromStage`/`toStage`, the deal-health stage-age budgets, the
analytics `CLOSED_STAGES` filters, search, validators and the frontend `STAGES`
constant — a wide blast radius against a shared database that already carries
drift (OPEN-002), for 20 live deals.

**What is still missing:** adding a *new* stage key needs the enum extended and
a migration. The upgrade path is unchanged — move `Deal.stage` to a string FK
referencing `PipelineStage.key` once the drift in OPEN-002 is resolved.
Terminal stages (`CLOSED_WON`/`CLOSED_LOST`) are deliberately fixed at 100%/0%
and cannot be hidden, since the analytics treat those two keys as terminal by
name.

### Tier 2 — genuinely new subsystems

**Tier 2 is complete.** Remaining UI gaps (lead-form builder, ticket views) are
noted per row.

| Capability | Existing foundation | What's needed | Effort |
|---|---|---|---|
| ~~Products & services + line items~~ | — | **DONE** — `Product`, `DealLineItem`, server-side totals | M |
| ~~Quotes / proposals~~ | — | **DONE** — `Quote`, `QuoteLineItem`, status lifecycle. **PDF export not built** | L |
| ~~Sequences / cadences~~ | — | **DONE** — durable engine, queue + worker + recovering sweep, business hours, reply detection, opt-out enforcement, builder UI | L |
| ~~Campaigns → leads integration~~ | — | **DONE** — attributed, scored lead on campaign reply; opt-in per workspace, opt-out respected | M |
| ~~Workflow triggers for CRM events~~ | — | **DONE** — 4 CRM triggers + 4 CRM actions on the existing engine, with a chain-depth guard. **Builder UI not extended** — CRM nodes are API-configurable only | M |
| ~~Public lead forms~~ | — | **DONE, end to end** — unauthenticated endpoint with honeypot, rate limiting, consent capture, allow-listed attribution, hashed IPs, dedupe. Builder UI at `LeadFormsView.jsx` (field editor, activation, submission log) and the visitor-facing page at `PublicForm.jsx` (`/forms/:workspaceId/:slug`), which did not exist before — the API returned JSON only, so a published link had nothing to fill in | M |
| ~~CRM support tickets~~ | — | **DONE, end to end** — `CrmTicket` with stored SLA, enforced lifecycle, queues. Separate from platform `SupportTicket`. UI at `TicketsView.jsx`: view switcher with live counts, SLA countdown, and a detail that offers only the transitions the ticket's lifecycle permits | M |
| ~~Teams & granular permissions~~ | — | **DONE** — `Team`/`TeamMember` + per-workspace ALL/TEAM/OWN record scoping, server-enforced on leads, deals and tasks. Roles deliberately left at ADMIN/CLIENT — see TEST_EVIDENCE.md. Admin UI in Settings | L |

### Tier 3 — large, mostly independent

| Capability | Notes | Effort |
|---|---|---|
| ~~Gamification (XP, levels, streaks, missions, achievements)~~ | **DONE** — XP awarded only for outcomes (qualified lead, won deal, cleared overdue task, accepted quote, resolved ticket); nothing rewards message volume. Idempotent via `unique(userId, dedupeKey)`, so replaying an event cannot farm points. 6 levels, streaks with one grace day. Profile UI at `ProgressPanel.jsx` on the account page, with an opt-in leaderboard | L |
| ~~Marketing website + SEO/AEO/GEO~~ | **DONE, with one honest limit** — copy extracted to `src/content/marketing.js` (§80), static JSON-LD + meta + OG in `index.html`, `robots.txt`, `sitemap.xml`, and Features/Integrations/Security/FAQ sections rendered from the content layer. **Limit: this is a CSR SPA** — a crawler that does not run JS gets an empty `#root`, so only the static `<head>` is machine-readable. Per-route SEO needs prerendering | XL |
| ~~Motion design system~~ | **DONE** — duration/easing tokens + 5 keyframes in `index.css`, `lib/motion.js` reads the tokens. Under `prefers-reduced-motion` the **tokens themselves collapse to 0ms**, so JS that reads them degrades without its own branch | M |
| ~~Next-best-action / relationship intelligence~~ | **DONE, end to end** — deterministic, evidence-cited recommendations; banded relationship strength with stated confidence. No new tables. UI: `NextBestActions.jsx` as the "Do next" panel on the CRM overview (evidence always inline, urgency shown as a band rather than a number), and `RelationshipCard.jsx` in the lead detail, which keeps the confidence beside the band and hedges a low-confidence verdict in words | L |

## Duplication risks to avoid

Called out because the spec warns against inventing parallel concepts (§8):

1. **Do not add a third grouping primitive.** `Segment` and `Cluster` are already
   near-duplicate static contact buckets. Lead segmentation should add *rules* to
   `Segment`, not a new table.
2. **Do not create an `Opportunity` model.** `Deal` already is the opportunity.
3. **Do not build a second workflow engine for sequences.** `Workflow`/`WorkflowRun`
   already provides durable, resumable execution with a cursor.
4. **Do not add a CRM-specific notification system.** `Notification` exists.
5. **`SupportTicket` is platform support**, not customer CRM ticketing — reusing it
   for CRM tickets would conflate two different audiences.

## Agentic layer — built last, by request

Deferred throughout and then built in two halves with different risk postures.
Design derived from [trycompai/crm](https://github.com/trycompai/crm) (MIT); see
`ATTRIBUTION.md` for what was taken and what diverges.

| Capability | Notes |
|---|---|
| **CRM copilot** | `Copilot.jsx` + `copilot.service.js`. Bounded 5-step tool loop over 11 read tools, driven through the shared `llm.js` so it keeps the Gemini→Ollama fallback. Writes are **structurally unreachable** from the model — the loop only calls `runReadTool`, which 403s on mutations; proposals go to a person and a separate endpoint executes them. Falls back to the deterministic next-best-action engine, and distinguishes "not configured" from "provider unavailable" |
| **Autonomous agent** | `agent.service.js` + `agent.worker.js`. Owns a Postgres work queue and a BullMQ schedule, claims rows with `FOR UPDATE SKIP LOCKED`, books its own rechecks. Writes without asking, gated by an evidence ledger rather than confirmation. Sensitive operations (close deal, mark lost, message contact, delete) are **denied outright when unattended**, not queued |
| **Evidence ledger** | `agent.evidence.js`. Weighted observation kinds with `contradiction` as a first-class negative. Two divergences from theirs: evidence is **re-verified against the database** before pricing, since this CRM ingests customer-controlled text; and two action classes exist, because a reminder triggered by an absence can never carry primary evidence |
| **Agent tab** | `AgentTab.jsx` on lead and deal detail. Shows applied changes, held-back suggestions with Accept/Reject, every pass, and what is booked next |

**Known limits.** The Gemini key is free-tier (20 requests/day), so the copilot
spends most of its time in the deterministic fallback. The agent's tools run
in-process with full database access — trycompai/crm isolates theirs in a
sandbox with deny-all egress, which is the remaining gap worth closing.
