# Advanced CRM — Existing Feature Inventory

Baseline audit of `chatflow-pro` as of 2026-08-16, branch `aditya-advanced-crm`.

> **Updated after the 2026 deep audit.** The "Not built" list this file used to
> end with is obsolete: nearly everything on it has since been built. The current
> state of each capability, including known defects and their remediation, is in
> [`ADVANCED_CRM_GAP_ANALYSIS.md`](ADVANCED_CRM_GAP_ANALYSIS.md) and
> [`audit/REMEDIATION_STATUS.md`](../audit/REMEDIATION_STATUS.md).

## Important context: the spec's stack assumptions do not match this repo

`docs/MS_Prompt.md` was written against `trycompai/crm` and assumes Bun, Turborepo,
TypeScript, Next.js App Router, NestJS, tRPC, Better Auth and shadcn/ui.

**None of that is present here.** Per the spec's own rule — *"If the repository differs,
follow the repository"* (§4) — the actual stack governs:

| Layer | Actual |
|---|---|
| Backend | Node 22, Express 5, plain JS (ESM), Prisma 5 → PostgreSQL (Supabase) |
| Jobs | BullMQ + ioredis — nine queues today (`campaigns`, `emails`, `billing`, `workflows`, `sequences`, `agent`, `webhooks`, `outgoing-webhooks`, `crm-maintenance`) |
| Auth | JWT (`jsonwebtoken`) + bcryptjs + Google OAuth; roles `VIEWER` / `AGENT` / `CLIENT` / `ADMIN` (`VIEWER` and `AGENT` were added after this inventory) |
| AI | `@google/genai` (Gemini) via one shared `src/lib/llm.js`, Ollama fallback |
| Frontend | React 18 + Vite 5, hand-rolled routing, **no** CSS framework, Recharts |
| Styling | Inline `style={{}}` objects over CSS custom properties in `src/index.css` |
| Package manager | npm (no workspaces — `backend/` and `frontend/` are independent) |

The product is a **multi-tenant WhatsApp Business messaging and campaign platform**,
not a sales CRM. The sales layer described below was added on top of it.

## Status legend

**EXISTING** — built and verified · **PARTIAL** — works but incomplete ·
**MISSING** — not present · **NEEDS IMPROVEMENT** — present but has a known defect

## Pre-existing platform (not part of this expansion)

| Capability | Status | Notes |
|---|---|---|
| Contacts | EXISTING | `Contact` + CSV import, tags, opt-out. No lifecycle/owner field of its own |
| Segments / Clusters | EXISTING | Two near-duplicate static grouping concepts; neither is rule-based |
| Campaigns | EXISTING | Bulk send, retries, fallback channels, wallet billing, per-recipient ledger |
| Conversations / Inbox | EXISTING | Split-pane inbox, assignment, auto-replies, business hours |
| Workflows | EXISTING | Visual node/edge builder + durable `WorkflowRun` with cursor/resume |
| Automation triggers | EXISTING | Keyword → template, plus AI intent matching |
| WhatsApp AI Agent | EXISTING | Per-workspace configurable agent answering inbound messages |
| Campaign AI sessions | EXISTING | Expiring "Ask Anything" sessions primed with a campaign snapshot |
| Wallet / billing | EXISTING | Balance, transactions, Razorpay, plan limits |
| Super-admin | EXISTING | Platform-level workspace/user/plan management |
| Notifications | EXISTING | In-app notification model + preferences |

## Sales CRM layer (this expansion)

| Capability | Status | Evidence |
|---|---|---|
| Lead model wrapping Contact | EXISTING | `Lead` 1:1 unique FK to `Contact`; Contact untouched |
| Deterministic lead scoring | EXISTING | `leadScoring.service.js`, 6 weighted factors, 0–100, 8 unit tests |
| Explainable score breakdown | EXISTING | `scoreFactors` JSON persisted; rendered as per-factor bars |
| Lead → Deal conversion | EXISTING | Atomic `$transaction`; the lead is claimed before the deal is created, so a concurrent second conversion also gets 409 (race fixed in the remediation, CF-071) |
| Deal model + pipeline stages | EXISTING | Six built-in `DealStage` keys; each workspace can relabel, reorder, hide and reweight them through `PipelineStage` |
| Stage-change audit trail | EXISTING | Append-only `DealStageHistory`, one row per move |
| Kanban pipeline board | EXISTING | Native HTML5 drag/drop, optimistic move with rollback |
| Deal table view | EXISTING | Toggle deep-linked via `?tab=` |
| Task model + CRUD | EXISTING | `Task` with due date, assignee, links to lead/deal/contact |
| Task overdue filter | EXISTING | `?isOverdue=true` |
| CRM activity log | EXISTING | `CrmActivity` (NOTE/CALL/EMAIL/MEETING) |
| Unified deal timeline | EXISTING | Activities merged with stage history in `listActivities` |
| CRM overview dashboard | EXISTING | KPIs, 6-month chart, stage donut, top deals, overdue tasks, activity feed |
| Workspace isolation on tasks/activities | EXISTING | Fixed 2026-08-16 (`docs/archive/TEST_EVIDENCE.md`); activities are now also scoped by their lead/deal visibility (CF-067) |
| Dashboard aggregate performance | EXISTING | Rewritten to `groupBy`/`aggregate`; was 12 sequential queries |

### Sales layer surface area (current)

Routes mounted under `/api/v1/workspaces/:workspaceId`: `/leads`, `/deals`,
`/tasks`, `/activities`, `/crm-analytics`, `/pipeline-stages`, `/forecast`,
`/products`, `/quotes`, `/sequences`, `/tickets`, `/lead-forms`,
`/lead-distribution`, `/saved-views`, `/custom-fields`, `/teams`, `/search`,
`/insights`, `/crm-data` (import/export), `/crm-sales-inbox`,
`/crm-permissions`, `/crm-customization`, `/copilot`, `/agent`, `/progress`;
public lead forms at `/api/v1/forms`.

Frontend pages: `CrmDashboardView`, `LeadsView`, `DealsView`, `TasksView`,
`ForecastView`, `ProductsView`, `QuotesView`, `SequencesView`, `TicketsView`,
`LeadFormsView`, `PublicForm`, `EngagementsView`, `CrmSalesInboxView`,
`CustomizeBusinessView`; shared components include `CommandPalette`,
`Copilot`, `AgentTab`, `SavedViews`, `CustomFields`, `NextBestActions`,
`RelationshipCard`, `ProgressPanel` and `TeamsAdmin`.

## Built since this inventory

Sequences/cadences, campaigns-to-leads, products, deal line items, quotes, CRM
tickets, forecasting, saved views, custom fields, CRM customization admin, CRM
import/export, public lead forms, gamification, command palette, global search,
the CRM copilot and autonomous agent, next-best-action, relationship
intelligence and deal health all have routes, services and views now. See the
gap analysis for each one's state and the defects the audit found.

Still not built: quote PDF export; new pipeline stage *keys* (built-in stages
can only be relabelled, reordered, hidden and reweighted); a UI for the
describe-an-automation → workflow compiler; prerendered per-route SEO.
