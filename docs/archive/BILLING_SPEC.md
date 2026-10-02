> **Historical design spec.** This is section 12 of the root README as it stood before billing was built ("Status: not yet implemented"). Code comments still cite it as "README §12.x" for the reasoning behind each rule. The implemented behaviour differs in places (INR plans FREE/BASIC/GROWTH, Razorpay checkout, quarterly cycles, per-category overage rates, a payment gateway); the current summary is §8 of the [root README](../../README.md). See [README.md](README.md) in this folder.

## 12. Planned Feature Spec: Subscription Plans + Wallet Quota Model

**Status: not yet implemented — this section is the implementation spec**, written against the current codebase so an external engineer/agent can build it without further discovery. It describes the target behavior, the current state it replaces, the data model changes, and where in the existing code each piece of enforcement plugs in.

### 12.1 Current state (what exists today)

- `Workspace.plan` (`schema.prisma`) is a free-text `String` defaulting to `"FREE"`. It is **stored and displayed** (`admin.service.js#listWorkspacesDetailed`) but **never enforced anywhere** — there is no plan catalog, no limits, and no code path that reads `plan` to gate behavior.
- `Workspace.plan` cannot be changed via any existing API — `settings.service.js`'s `ALLOWED_SETTINGS_FIELDS` allow-list explicitly excludes it ("prevents mass-assignment of sensitive columns (plan, webhookVerifyToken, etc.)").
- `Workspace.walletBalance` + `WalletTransaction` (`wallet.service.js`) is a working, server-authoritative ledger: `credit()` and `debit()` both run inside a Prisma transaction and append an immutable ledger row. `POST /workspaces/:id/wallet/recharge` is ADMIN-only and explicitly documented as a **demo** top-up (no live payment gateway — see §11).
- Nothing today consumes the wallet or any quota when a message is sent, a campaign is launched, a contact is created, or a member is invited — all of those are currently unlimited regardless of `plan` or `walletBalance`.
- Role model is per-workspace only: `WorkspaceMember.role` is `ADMIN` or `CLIENT` (`authorize()` in `middleware/authorize.js`, hierarchical: ADMIN ⊇ CLIENT). There is also a platform-level `superAdmin` flag (single `ADMIN_EMAIL`), orthogonal to workspace roles.

### 12.2 Target model

**Two-layer usage model, workspace-scoped (not per-member):**

1. **Subscription quota** — each workspace subscribes to a `Plan`. The plan grants a fixed **included message quota** per billing cycle (plus optional hard caps on contacts/team members/campaigns/API keys/features). Usage against the plan is free (already paid for via the subscription).
2. **Wallet overflow** — once the cycle's included quota is exhausted, further WhatsApp sends are **not blocked outright**; instead each send is debited from `Workspace.walletBalance` at a per-message rate (pay-as-you-go). If the wallet is also insufficient, the send is rejected with a clear "quota + wallet exhausted" error and the workspace is prompted to recharge or upgrade.

This mirrors how the wallet already works today (server-authoritative ledger) — the new work is (a) a plan catalog + subscription record, (b) a quota counter that resets per cycle, and (c) wiring the existing `wallet.service.js#debit` into the send path as the overflow mechanism, instead of leaving usage completely unmetered.

**Role-based rules:**

| Action | ADMIN | CLIENT (member) |
|---|---|---|
| View workspace's plan, quota usage, wallet balance/ledger | ✅ | ✅ (read-only) |
| Change/upgrade/downgrade the workspace's subscription plan | ✅ | ❌ |
| Recharge the wallet | ✅ | ❌ (same restriction pattern already used for `POST /wallet/recharge`) |
| Send messages / launch campaigns that consume quota or wallet | ✅ | ✅ — **usage always debits the workspace's shared quota/wallet**, regardless of which member triggered it. There is no per-member sub-quota; the workspace is the billing unit. |
| Invite a member beyond the plan's included seat limit | ✅, but blocked by plan limit until upgrade | n/a (members can't invite) |

Platform **super admin** (`ADMIN_EMAIL`) can additionally: define/edit the plan catalog, override a workspace's plan or quota manually (e.g. comped account), and view cross-workspace usage — extending the existing `/admin/platform/*` surface (`admin.routes.js`, `requireSuperAdmin`).

### 12.3 Data model changes (Prisma)

```prisma
model Plan {
  id                String       @id @default(cuid())
  key               String       @unique   // "FREE" | "STARTER" | "PRO" | "ENTERPRISE" | ...
  name              String
  priceMonthly      Decimal      @db.Decimal(10, 2)
  currency          String       @default("USD")
  messageQuota      Int          // included messages per billing cycle; 0 = none, -1 = unlimited
  contactLimit      Int?         // null = unlimited
  memberLimit       Int?
  campaignLimit     Int?         // concurrent/active campaigns, or per-cycle sends — define precisely before build
  apiKeyLimit       Int?
  overageRatePerMsg Decimal      @db.Decimal(10, 4) // wallet debit per message once quota is exhausted
  features          Json         @default("{}")     // feature flags: { automation: true, workflows: true, aiOnboarding: true, integrations: true, ... }
  isActive          Boolean      @default(true)
  createdAt         DateTime     @default(now())
  subscriptions     Subscription[]
}

model Subscription {
  id                String    @id @default(cuid())
  workspaceId       String    @unique   // one active subscription per workspace
  planId            String
  status            String    @default("ACTIVE") // ACTIVE | PAST_DUE | CANCELLED | EXPIRED
  currentPeriodStart DateTime @default(now())
  currentPeriodEnd   DateTime
  cancelAtPeriodEnd  Boolean  @default(false)
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt
  workspace           Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  plan                Plan      @relation(fields: [planId], references: [id])
}

model UsageCounter {
  id              String   @id @default(cuid())
  workspaceId     String
  periodStart     DateTime // matches Subscription.currentPeriodStart for the active cycle
  periodEnd       DateTime
  messagesUsed    Int      @default(0) // count against the plan's included messageQuota
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  workspace       Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@unique([workspaceId, periodStart])
}
```

- `Workspace.plan` (the current free-text column) should be **deprecated and migrated** to `Subscription.planId` — keep the old column briefly for backfill, then drop it once `Subscription` rows exist for every workspace (a migration script, not a live dual-write).
- Every existing workspace needs a bootstrapped `Subscription` row (e.g. `FREE` plan, `currentPeriodEnd` = +30 days) as part of the migration, so enforcement code never has to special-case "no subscription".

### 12.4 Enforcement points in existing code

Quota/wallet checks must be added at the point of **consumption**, not just at display time. Based on the current codebase:

| Consumption event | Where it happens today | What to add |
|---|---|---|
| Campaign message send (bulk) | `workers/campaign.worker.js` — the `for (const recipient of recipients)` loop, right before `sendWhatsAppMessage(...)` | Before each send: increment/check `UsageCounter.messagesUsed` against `Plan.messageQuota`; once exceeded, call `wallet.service.js#debit(workspaceId, plan.overageRatePerMsg, { reason: 'Campaign overage' })`. If `debit` returns `{ ok: false }`, mark that recipient `FAILED` with a `failReason` of `"Quota and wallet balance exhausted"` and continue to the next recipient (don't abort the whole campaign — matches the existing per-recipient try/catch pattern already in this file). |
| Single/manual message send | `services/whatsapp.service.js` (conversation reply / test send) | Same quota→wallet check before calling the Meta send helper. |
| Campaign launch (pre-flight) | `services/campaigns.service.js` (launch endpoint) | Optional pre-flight estimate: if `recipients.length` exceeds the *remaining* quota + max affordable wallet overage, warn (not necessarily block) the admin before launch, so a campaign doesn't silently fail mid-run for most of its recipients. |
| Contact creation | `services/contacts.service.js` (create + CSV import) | If `plan.contactLimit` is set, reject creation past the limit with 403 + a clear "upgrade your plan" error. |
| Member invite | `services/members.service.js#inviteMember` | If `plan.memberLimit` is set, count existing `WorkspaceMember` rows and reject past the limit. |
| API key creation | `services/apikeys.service.js` | Same pattern, against `plan.apiKeyLimit`. |
| Feature-gated tabs (Workflows, AI onboarding, Integrations, ...) | Various `services/*` + corresponding frontend views | Check `plan.features.<flag>` — mirror the existing "Coming Soon" pattern already used in the UI (§11) for plan-gated-but-technically-built features, so a downgraded workspace sees a clear upsell state rather than a broken one. |
| Workspace suspension | `middleware/workspaceContext.js` already blocks all access when `Workspace.suspended` | Reuse this exact mechanism for a **CANCELLED/EXPIRED** subscription — don't invent a second suspension flag. Either flip `suspended: true` with a subscription-specific `suspendedReason`, or extend `workspaceContext` to also check `Subscription.status`. |

### 12.5 New/changed API surface

| Endpoint | Method | Role | Purpose |
|---|---|---|---|
| `/workspaces/:workspaceId/subscription` | `GET` | ADMIN, CLIENT (read) | Current plan, cycle dates, quota used/remaining, wallet balance — a single dashboard-ready summary |
| `/workspaces/:workspaceId/subscription` | `PATCH` | ADMIN only | Change plan (upgrade/downgrade) — validate against current usage (e.g. block downgrade below current member count) |
| `/workspaces/:workspaceId/wallet` | `GET` | existing | No change — already returns balance + ledger |
| `/workspaces/:workspaceId/wallet/recharge` | `POST` | existing, ADMIN only | No change to the endpoint; the *source* of debits against this balance expands from "manual admin action" to "automatic overage debits from the worker/services above" |
| `/admin/platform/plans` | `GET`/`POST`/`PATCH` | super admin only | CRUD for the `Plan` catalog (extends the existing `/admin/platform/*` surface in `admin.routes.js`) |
| `/admin/platform/workspaces/:id/subscription` | `PATCH` | super admin only | Manual override (comp a plan, extend a cycle) — extends `setWorkspaceSuspended`-style admin tooling in `admin.service.js` |

### 12.6 Billing-cycle reset

A new **repeatable BullMQ job** (alongside the existing `campaigns`/`email` queues in `queues/` + a worker in `workers/`) should run daily, find `Subscription` rows where `currentPeriodEnd <= now()`:
- Roll `currentPeriodStart`/`currentPeriodEnd` forward by one cycle and create a fresh `UsageCounter` row (quota resets — wallet balance does **not** reset, it's separate money).
- If `cancelAtPeriodEnd` is true, transition `status` to `CANCELLED` instead of renewing, and set `Workspace.suspended` per §12.4.
- This mirrors the existing `recoverScheduledCampaigns()` startup-recovery pattern in `server.js` for resilience against missed runs (a job that didn't fire while the server was down should still catch up on next boot, not wait for the next scheduled tick).

### 12.7 Frontend changes

- `SettingsView.jsx` (or a new `BillingView.jsx`) — plan display, usage bar (messages used / quota), upgrade/downgrade UI (ADMIN-only, matching the existing `isAdmin` gating already used in `Dashboard.jsx`).
- `PaymentsView.jsx` (wallet UI already exists) — add a "quota exhausted, now billing from wallet" indicator once `UsageCounter.messagesUsed >= Plan.messageQuota`, and a low-balance warning tied to `Workspace.notifyRateLimit`-style notification toggles already on the `Workspace` model.
- `SuperAdminView.jsx` — plan catalog management + per-workspace subscription override, alongside the existing suspend/reinstate controls.

### 12.8 Explicit non-goals for this pass

- No live payment gateway integration (Stripe/Razorpay/etc.) — wallet recharge stays the existing demo/manual flow described in §11; only the *consumption* side (quota → wallet overage) is new.
- No per-member sub-quotas — usage is workspace-level only, per §12.2.
- No proration on mid-cycle plan changes — an upgrade/downgrade takes effect at the *next* billing cycle unless a later pass explicitly adds proration.

