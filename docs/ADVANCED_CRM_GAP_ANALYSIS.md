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

## Deliberately deferred — decided with the user

| Capability | Why deferred | Effort |
|---|---|---|
| Agentic layer (standing agent process, task queue, evidence pipeline, per-record Agent tab, signed-token bridge) | A separate deployment and runtime, not a slice of Lead/Deal. Comp AI's design segregates it from the API by rule | XL |
| CRM Chat / Copilot (NL Q&A over CRM + describe-an-automation → deploy as team agent) | Needs LLM tool-calling, a chat thread model, and an English→workflow compiler | XL |

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

| Capability | Existing foundation | What's needed | Effort |
|---|---|---|---|
| ~~Products & services + line items~~ | — | **DONE** — `Product`, `DealLineItem`, server-side totals | M |
| ~~Quotes / proposals~~ | — | **DONE** — `Quote`, `QuoteLineItem`, status lifecycle. **PDF export not built** | L |
| ~~Sequences / cadences~~ | — | **DONE** — durable engine, queue + worker + recovering sweep, business hours, reply detection, opt-out enforcement, builder UI | L |
| ~~Campaigns → leads integration~~ | — | **DONE** — attributed, scored lead on campaign reply; opt-in per workspace, opt-out respected | M |
| ~~Workflow triggers for CRM events~~ | — | **DONE** — 4 CRM triggers + 4 CRM actions on the existing engine, with a chain-depth guard. **Builder UI not extended** — CRM nodes are API-configurable only | M |
| ~~Public lead forms~~ | — | **DONE** — unauthenticated endpoint with honeypot, rate limiting, consent capture, allow-listed attribution, hashed IPs, dedupe. **No builder UI yet** — forms are API-defined | M |
| CRM support tickets | Platform `SupportTicket` is unrelated | Ticket model with SLA, queues, assignment | M |
| ~~Teams & granular permissions~~ | — | **DONE** — `Team`/`TeamMember` + per-workspace ALL/TEAM/OWN record scoping, server-enforced on leads, deals and tasks. Roles deliberately left at ADMIN/CLIENT — see TEST_EVIDENCE.md. Admin UI in Settings | L |

### Tier 3 — large, mostly independent

| Capability | Notes | Effort |
|---|---|---|
| Gamification (XP, levels, streaks, missions, achievements) | Must reward outcomes, not activity volume, or it drives spam | L |
| Marketing website + SEO/AEO/GEO | `Landing.jsx` exists but is a single in-app page, not a content-architected site. Spec §80 wants marketing copy separated from app logic — this repo has no MDX/content layer | XL |
| Motion design system | No animation library installed; a few CSS keyframes only | M |
| Next-best-action / relationship intelligence | Needs the evidence discipline of §55 to avoid inventing facts | L |

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
