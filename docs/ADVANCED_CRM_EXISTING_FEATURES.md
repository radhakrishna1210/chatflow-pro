# Advanced CRM — Existing Feature Inventory

Baseline audit of `chatflow-pro` as of 2026-08-16, branch `aditya-advanced-crm`.

## Important context: the spec's stack assumptions do not match this repo

`frontend/MS_Prompt.md` was written against `trycompai/crm` and assumes Bun, Turborepo,
TypeScript, Next.js App Router, NestJS, tRPC, Better Auth and shadcn/ui.

**None of that is present here.** Per the spec's own rule — *"If the repository differs,
follow the repository"* (§4) — the actual stack governs:

| Layer | Actual |
|---|---|
| Backend | Node 22, Express 5, plain JS (ESM), Prisma 5 → PostgreSQL (Supabase) |
| Jobs | BullMQ + ioredis (`campaigns`, `workflows`, `billing`, `email` queues) |
| Auth | JWT (`jsonwebtoken`) + bcryptjs + Google OAuth; roles `ADMIN` / `CLIENT` |
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
| Lead → Deal conversion | EXISTING | Atomic `$transaction`; re-conversion refused with 409 |
| Deal model + pipeline stages | EXISTING | 6-stage `DealStage` enum |
| Stage-change audit trail | EXISTING | Append-only `DealStageHistory`, one row per move |
| Kanban pipeline board | EXISTING | Native HTML5 drag/drop, optimistic move with rollback |
| Deal table view | EXISTING | Toggle deep-linked via `?tab=` |
| Task model + CRUD | EXISTING | `Task` with due date, assignee, links to lead/deal/contact |
| Task overdue filter | EXISTING | `?isOverdue=true` |
| CRM activity log | EXISTING | `CrmActivity` (NOTE/CALL/EMAIL/MEETING) |
| Unified deal timeline | EXISTING | Activities merged with stage history in `listActivities` |
| CRM overview dashboard | EXISTING | KPIs, 6-month chart, stage donut, top deals, overdue tasks, activity feed |
| Workspace isolation on tasks/activities | EXISTING | Fixed 2026-08-16; see `TEST_EVIDENCE.md` |
| Dashboard aggregate performance | EXISTING | Rewritten to `groupBy`/`aggregate`; was 12 sequential queries |

### Sales layer surface area

Routes mounted under `/api/v1/workspaces/:workspaceId`:
`/leads`, `/deals`, `/tasks`, `/activities`, `/crm-analytics`

Frontend pages: `CrmDashboardView`, `LeadsView`, `DealsView`, `TasksView`
Shared components extracted: `Modal`, `Form` (FInput/FLabel/FSelect/FTextarea),
`StatusBadge`, `Avatar`

## Not built

Everything below is named in `MS_Prompt.md` and is **MISSING**. See
`ADVANCED_CRM_GAP_ANALYSIS.md` for sizing.

Sequences/cadences · campaigns-to-leads integration · products & services catalog ·
deal line items · quotes/proposals · support tickets (a `SupportTicket` model exists
for platform support, unrelated to CRM tickets) · forecasting · saved views ·
custom fields · CRM customization admin · import/export for CRM entities ·
public lead forms · gamification (XP, levels, streaks, missions, achievements) ·
command palette · global CRM search · agent command center · next-best-action
recommendations · relationship intelligence · deal health scoring · AI drafting ·
human approval queue · marketing website · SEO/AEO/GEO · motion design system
