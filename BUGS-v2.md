# Bugs

## 1. Onboarding AI Assistant doesn't build real workflows — it only creates bare Template/Campaign rows, and often just replies with text

**Where:** Dashboard "Create your Free WhatsApp AI Assistant" box
- Frontend: `frontend/src/pages/Dashboard.jsx` — `HomeView` component, `handleSend()` (~line 287-326)
- Backend route: `backend/src/routes/onboarding.routes.js` → `POST /api/v1/onboarding/chat`
- Backend logic: `backend/src/controllers/onboarding.controller.js` — `chatWithAi()`

**Reported behavior:** User (client or admin) types a business requirement (e.g. "Create a template for an abandoned cart", "Create a campaign for Diwali sale") expecting the agent to build the actual workflow end-to-end. Instead it appears to just print a chat-style response and nothing gets created.

### Root causes found in code

1. **No workflow creation exists at all.** `chatWithAi()` only ever creates two kinds of rows: `prisma.template.create(...)` and `prisma.campaign.create(...)`. There is zero integration with `backend/src/services/workflow.service.js` (grepped — no references to onboarding/chat/aiGenerated in that file). So "build the whole workflow" as a concept doesn't exist server-side — the agent can, at best, make one template or one fake campaign, never an actual multi-step automation/workflow.

2. **"Campaigns" created by the agent are fabricated, not real sends.** In both the one-shot path (`onboarding.controller.js:161-193`) and the guided path (`:268-312`), the campaign is inserted directly with hardcoded fake stats:
   ```js
   totalContacts: 250, sent: 250, delivered: 245, read: 190,
   status: 'RUNNING', launchedAt: new Date(),
   ```
   No contacts are queried, no messages are queued, and `webhook.service.js` (which handles real outbound WhatsApp sends) is never called. The "campaign" is cosmetic — it shows up in the Campaigns table with made-up numbers but nothing was ever sent to a real customer.

3. **Default mode is a multi-turn slot-filling chat, but the UI hides that it's a conversation.** The "Guided Flow" checkbox defaults to `checked` (`Dashboard.jsx:270`, `guided` init `true`). With `guided=true`, `chatWithAi` never creates anything on the first message — it just asks a follow-up question and stores conversation state in `AiSession` (`onboarding.controller.js:134-160`, state machine `TEMPLATE_GATHER_NAME` → `TEMPLATE_GATHER_BODY` → create; `CAMPAIGN_GATHER_NAME` → `CAMPAIGN_GATHER_TEMPLATE` → create). But the frontend (`Dashboard.jsx:422-451`) renders only a single "AI response" box that gets replaced each send — there's no visible chat thread, so a user clicking one of the suggestion chips ("Create a template for an abandoned cart") just sees one question back and, not realizing they're expected to keep replying in the same box, concludes the agent "did nothing."

4. **AI content generation silently degrades to filler text.** `callOllama()` (`onboarding.controller.js:5-31`) calls a local Ollama server at `http://127.0.0.1:11434` running model `phi3`. This is a local/dev-only dependency — on any deployed environment (per project memory, backend is deployed against Supabase, not a machine running Ollama) this call will fail every time. When it fails:
   - `generateTemplateBody()` falls back to a hardcoded generic template: `"Hello {{1}}, here is the information you requested. Reply STOP to unsubscribe."` — completely ignoring what the user actually asked for (e.g. "abandoned cart").
   - Intent classification for anything not matching the hardcoded keyword shortcuts (`create`/`make`/`build`/`new`/`generate` + `template`/`campaign`) falls back to `GENERAL`, and the general-chat reply also depends on Ollama; when it fails, the user just gets the canned line: `"I'm your AI Agent. I can help you create or delete templates and campaigns. Just tell me what you want to do!"` — which matches exactly the symptom reported (a static response, no action).

5. **Only 4 intents exist, nothing else.** `detectIntent()` can only ever resolve to `CREATE_TEMPLATE`, `CREATE_CAMPAIGN`, `DELETE_TEMPLATE`, `DELETE_CAMPAIGN`, or `GENERAL`. Any other business requirement described in free text (the actual advertised use case — "describe your business flow ... to automatically build and register templates") has no code path to act on it beyond writing one generic template.

### Additional findings

6. **Duplicate, inconsistent frontend entry points.** There's a second, near-identical chat UI in `frontend/src/components/AIOnboardingCard.jsx` (used on `Dashboard.jsx` and `Landing.jsx`) that posts to the same `/api/v1/onboarding/chat` endpoint but never sends a `guided` flag at all — it silently gets the server's `guided = true` default. So the two entry points can behave differently depending on which one the user is on, and neither reliably does one-shot creation.

7. **A real tool-calling surface already exists but is completely disconnected from the chat agent.** `backend/src/routes/ai.routes.js` / `backend/src/controllers/ai.controller.js` exposes `POST /api/v1/ai/template/create`, `/campaign/create`, `/template/update`, `/campaign/update`, and `/workflow/execute` — but `onboarding.controller.js` never calls any of them, and the chat box never calls that route either. They're currently only wired to a "Run Simulation" button on `frontend/src/pages/AutomationView.jsx:381`, unrelated to onboarding.
   - Worse, `executeWorkflow` (`ai.controller.js:80-82`) is a pure stub — it ignores `req.body.workflowId` and just returns `{ status: 'workflow_executed', message: 'Successfully triggered automation flow via AI' }` with zero database or execution logic. This is a canned success response, not a real action — even if the onboarding agent were wired to call it, it still wouldn't do anything.
   - `workflow.service.js` has a working `createWorkflow(workspaceId, {...})` (lines 10-20) that's never invoked by any AI/onboarding code path.

### Net effect
The feature is currently a very limited CRUD-by-chat toy for individual Template/Campaign rows (with fabricated campaign stats), not the "creates the whole workflow according to requirements" agent implied by the UI copy ("Describe your business flow or campaign parameters below to automatically build and register templates"). It has no connection to the real workflow/automation engine or to actual message sending, and its content quality depends on a local LLM (Ollama) that isn't part of this project's deployment setup, so in production it mostly returns generic filler or the same canned fallback sentence — matching the "just shows a response, does nothing" report.

### Suggested fix direction (not yet implemented)
- Wire template/campaign creation (and new: workflow creation) through the real services (`workflow.service.js`, `webhook.service.js`) instead of raw fabricated `prisma.campaign.create` stats.
- Replace/point `callOllama` at whatever LLM provider is actually available in production, with a real error surfaced to the user instead of a silent generic fallback.
- Either render an actual chat thread on the frontend so guided multi-turn flow is visibly a conversation, or default `guided` to `false` for true one-shot action from a single suggestion-chip click.
- Expand intent handling beyond 4 hardcoded template/campaign CRUD intents to actually cover "build a whole workflow" as advertised.
- Consolidate the two duplicate frontend chat entry points (`Dashboard.jsx`'s `HomeView` and `AIOnboardingCard.jsx`) so they behave consistently.
- Either implement `executeWorkflow` in `ai.controller.js` for real (call `workflow.service.js`'s `createWorkflow`/execution logic) or remove the stub so it doesn't masquerade as a working action, and connect the onboarding chat agent to this tool surface instead of duplicating create logic inline in `onboarding.controller.js`.

## 2. Meta Embedded Signup regression — "Connect via Meta" button on Number Setup does nothing (feature was built and committed, but is missing from this branch)

**Where:**
- Frontend: `frontend/src/pages/NumberSetupView.jsx` — "Connect via Meta" card (labeled "Recommended", promises "no tokens to copy")
- Backend: would be `whatsapp.service.js` (`completeEmbeddedSignup`), `lib/meta.js` (token-aware `subscribeAppToWaba`/`registerPhoneNumber`/`getPhoneNumberById`), and new routes under `/whatsapp/embedded-signup*`

**Reported/observed behavior:** On the current branch (`mearge_fixes`), the "Connect via Meta" button in Number Setup has **no `onClick` handler at all** — clicking it does nothing. No Meta JS SDK (`FB.login`, `WA_EMBEDDED_SIGNUP` postMessage handling) is loaded anywhere in the frontend. Businesses currently have exactly one way to "bring their own" WhatsApp number: the "Connect Your Own" manual form, where they must copy-paste their own `phoneNumber`, `metaPhoneNumberId`, `wabaId`, and a long-lived Meta access token by hand — the opposite of the one-click experience the "Connect via Meta" card advertises.

### Root cause: this is a regression, not a missing feature

A full Embedded Signup implementation was already built and **committed**: commit `ec0174f`, `"feat(whatsapp): Embedded Signup + BYO OTP number onboarding"`, on branch `feature/embedded-signup` (confirmed via `git log --oneline --all`, and matches a detailed record in prior project notes dated 2026-05-29). That implementation included:
- Frontend: Meta JS SDK flow in `NumberSetupView.jsx` — "Connect with Meta" button calling `FB.login` with a `config_id`, capturing `waba_id`/`phone_number_id` from the `WA_EMBEDDED_SIGNUP` postMessage event, then POSTing to the backend.
- Backend: `whatsapp.service.completeEmbeddedSignup` (exchange auth code → `subscribeAppToWaba` → `registerPhoneNumber` → `getPhoneNumberById` → upsert `WaNumber` → sync templates), new routes `GET/POST /whatsapp/embedded-signup[/config]`, and a `META_ES_CONFIG_ID` env var.
- Token-aware helper functions added to `lib/meta.js` for the subscribe/register/lookup calls.

**None of this exists on the current branch.** Grepping the entire repo for `FB.login`, `WA_EMBEDDED_SIGNUP`, `embedded-signup`/`embeddedSignup` (case-insensitive), and `META_ES_CONFIG_ID` returns **zero matches** anywhere outside git history — not in `NumberSetupView.jsx`, not in `whatsapp.service.js`, not in `lib/meta.js`, not in any routes file. The `feature/embedded-signup` branch still exists locally and on `origin`, so the code isn't lost, but it never made it into `mearge_fixes` (or any of the other merge/conflict-resolution branches that fed into it) — most likely dropped during a merge/conflict resolution rather than intentionally removed.

Related orphaned groundwork: `lib/meta.js` still has `exchangeCodeForToken`/`getLongLivedToken` (OAuth code-exchange helpers, lines ~92-115) sitting unused — nothing in the current backend calls them, consistent with the Embedded Signup wiring that would have used them being absent.

### Net effect
The "Recommended" one-click Meta connection path is completely non-functional (dead button, no SDK loaded), forcing every business onto the manual token-paste form instead — worse UX and worse security posture (customers handling raw long-lived access tokens) than what was already built and working on `feature/embedded-signup`.

### Suggested fix direction (not yet implemented)
- Diff `feature/embedded-signup` (commit `ec0174f`) against `mearge_fixes` for `NumberSetupView.jsx`, `whatsapp.service.js`, `whatsapp.routes.js`/`whatsapp.controller.js`, and `lib/meta.js` to recover the dropped Embedded Signup code, then re-apply/re-merge it onto the current branch.
- Re-add the `META_ES_CONFIG_ID` env var and confirm the Meta app's Embedded Signup configuration (JS-SDK allowed domains, app must be Live) still matches what was verified working on 2026-05-29.
- After restoring, keep the manual "Connect Your Own" form only as an explicit fallback, not the sole option.

## 3. Templates are shared across all WhatsApp numbers in a workspace instead of being private per number

**Where:**
- Schema: `backend/prisma/schema.prisma` — `model Template` (~line 103-117)
- Backend: `backend/src/services/templates.service.js` — `listTemplates`, `createTemplate`, `updateTemplate`, `deleteTemplate`, `duplicateTemplate`, `syncTemplatesFromMeta`
- Frontend: `frontend/src/pages/Dashboard.jsx` — `TemplatesView` (no per-number selector anywhere)

**Reported scenario:** An admin adds two numbers to their workspace via the Number Pool. Client A (using number one) adds 2 templates; Client B (using number two) adds 3 templates. All 5 templates end up visible to both clients, regardless of which number they were created under. Expected: each number's templates should be private to that number.

### Root cause

The `Template` model has **no relationship to `WaNumber` at all** — it only has `workspaceId`:
```prisma
model Template {
  id             String   @id @default(cuid())
  workspaceId    String
  metaTemplateId String?
  name           String
  ...
  workspace      Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
}
```
There is no `waNumberId` column and no relation to `WaNumber`. Every template query is scoped only by `workspaceId`:
- `listTemplates(workspaceId)` (`templates.service.js:6-15`) — `prisma.template.findMany({ where: { workspaceId } })`, with zero filtering by number. Any member of the workspace sees every template ever created under any of the workspace's connected numbers.
- `getTemplate`/`updateTemplate`/`deleteTemplate`/`duplicateTemplate` (`templates.service.js:107-185`) — all scoped by `{ id, workspaceId }` only; nothing prevents Client B from editing/deleting a template that Client A created for a different number.

This isn't just a visibility bug — it also silently **misroutes template submissions to Meta** once a workspace has more than one connected number. `createTemplate` (`templates.service.js:68-105`), `syncTemplatesFromMeta` (`:24-66`), `updateTemplate`'s resubmit path (`:126-129`), and `deleteTemplate`'s Meta-delete path (`:152-154`) all resolve "the" WhatsApp number the same way:
```js
const waNumber = await prisma.waNumber.findFirst({ where: { workspaceId }, orderBy: { createdAt: 'desc' } });
```
i.e. **always the most-recently-connected number in the workspace**, never the number the user actually intended to submit the template under. So in the reported scenario, once number two is connected, every subsequent "create template" call — even ones triggered from a UI context implying number one — actually gets submitted to number two's WABA via Meta, while `syncTemplatesFromMeta` will only ever pull number two's templates back down, further conflating the two.

The frontend has no concept of this at all: `TemplatesView` in `Dashboard.jsx` has no number selector/filter — it just calls `GET /templates` and renders whatever the backend returns, consistent with the backend having nothing to filter by.

### Net effect
In any workspace with more than one connected number (the normal case for an admin managing multiple clients/numbers from one workspace), templates are pooled and cross-visible instead of private per number, and template create/update/delete/sync operations against Meta silently target only the newest connected number rather than the correct one — risking templates being submitted to, or deleted from, the wrong WABA entirely.

### Suggested fix direction (not yet implemented)
- Add a `waNumberId` (required, FK to `WaNumber`, likely `onDelete: Cascade`) column to `Template`, and backfill existing rows (best-effort: assign to the workspace's oldest/only `WaNumber` where ambiguous).
- Update `listTemplates`/`getTemplate`/`updateTemplate`/`deleteTemplate`/`duplicateTemplate`/`syncTemplatesFromMeta`/`createTemplate` to accept and filter/require a `waNumberId` instead of resolving "the newest number in the workspace."
- Add a number selector to `TemplatesView` (and anywhere else templates are listed/created, including the template library install flow and the onboarding chat agent's template creation path — see bug #1) so users explicitly pick which connected number a template belongs to.
- Apply the equivalent scoping check to `Campaign` if not already present, since campaigns reference both a `Template` and a `WaNumber` — worth auditing whether a campaign could end up pairing a template from one number with a different number's `waNumberId`.

## 4. Campaigns list never shows a success rate, and only shows a date for scheduled campaigns (never for immediate sends)

**Where:** `frontend/src/pages/Dashboard.jsx` — `CampaignsView` table rendering (~line 556-579)

**Reported behavior:** On the Campaigns page, the `RATE` column always shows `—` and the `DATE` column only shows a date when a campaign was scheduled for later — campaigns sent immediately never show a date at all.

### Root cause

**Rate:**
```js
const rate = sent > 0 ? +((delivered / sent) * 100).toFixed(1) : 0;
...
{rate > 0 ? (...) : <span>—</span>}
```
Rate is derived purely from `delivered / sent`, and `delivered` on the `Campaign` row is only ever incremented by the Meta webhook's delivery-status handler (`webhook.service.js` `handleStatusUpdate`) — which has an existing no-op bug in its `delivered` branch (`campaignRecipient.updateMany(..., { data: {} })`, and a separately-known issue where the `Campaign.delivered` counter increment path needs the webhook to actually fire and match). In practice `delivered` stays `0` for most/all campaigns shown in the screenshot (`sent: 1, delivered: 0` on every row), so `rate` is always `0` and the UI always falls back to `—` — this isn't a rendering bug so much as `delivered` never getting populated end-to-end, making the Rate column permanently useless.

**Date:**
```js
const date = c.scheduledAt ? new Date(c.scheduledAt).toLocaleDateString(...) : (c.date ?? '—');
```
The `Campaign` Prisma model has no `date` field, so `c.date` is always `undefined` and the fallback is always `—`. The column is hardcoded to only ever read `scheduledAt` — but `launchCampaign` (`campaigns.service.js`) only sets `scheduledAt` when the campaign is scheduled for later; an immediately-sent campaign gets `launchedAt`/`createdAt` set instead, and neither is read here. So every "send now" campaign permanently shows `—` in the Date column, exactly as reported (only "JRFIER", the one scheduled campaign in the screenshot, shows a date).

### Suggested fix direction (not yet implemented)
- Date column: fall back through `c.launchedAt ?? c.createdAt` when `scheduledAt` is absent, so every campaign shows a meaningful date regardless of send mode.
- Rate column: fix `delivered`/`read` counters to actually update from the webhook (see the known no-op in `handleStatusUpdate`'s `delivered` branch), and/or display a `sent`-based fallback rate (e.g. delivery pending indicator) instead of a bare `—` when `sent > 0` but `delivered` hasn't been confirmed yet, so the column isn't silently blank for every campaign.

## 5. "New Campaign" wizard — steps 5-8 (Reply Flows, Retries, Conversion Tracking, Fallback Channels) are fully interactive but entirely non-functional

**Where:** `frontend/src/pages/CreateCampaign.jsx` — `Step5` (~line 434), `Step6` (~514), `Step7` (~607), `Step8` (~667), and the launch handler `handleGoLive` (~904)

**Reported behavior:** The New Campaign popup has 8 steps. Steps 1-4 (Campaign Type & Number, Message Template, Audience, Schedule) work correctly. From step 5 ("Reply Flows") onward, nothing works properly.

### Root cause

Steps 5-8 render real, fully interactive UI (add/edit auto-reply rules in Step 5; retry scheduling in Step 6; UTM/conversion tracking in Step 7; fallback channel config in Step 8) — but **none of it is wired to anything**:

1. **Each step's "Save" button has no `onClick` handler at all:**
   - Step 5: `<Btn>Save Flow</Btn>` (line 508) — clicking it does nothing, no state is persisted, no API call.
   - Step 6: `<Btn>Save Retry Config</Btn>` (line 601) — same, no handler.
   - Step 7: `<Btn>Save Tracking</Btn>` (line 660) — same, no handler.
   - (Step 8's fallback-channel options are additionally hardcoded `opacity: 0.45, cursor: 'not-allowed'` with a "Coming Soon" badge per channel — that part is intentionally disabled, but the "Enable Fallback Channels" toggle above it still has no save/submit path either.)

2. **Each step's state is local-only React `useState` inside its own component** (`Step5`'s `rules`, `Step6`'s `active`/`endDate`/`pattern`/etc., `Step7`'s `utmOn`/`utm`/`evtOn`/`evtName`, `Step8`'s `enabled`/`delay`/`msgOpt`) — none of it is lifted up to the parent `CreateCampaign` component the way Steps 1-4's data is (`campaignName`, `selectedNumberId`, `selectedTemplateId`, `selectedContactIds`, `scheduleType`, `scheduledAt` all live in the parent). So even if a user fills out Reply Flow rules, retry settings, UTM parameters, or fallback config, that data physically cannot reach the launch handler — it's scoped inside a component that unmounts/loses state as soon as the accordion step closes or the wizard closes.

3. **`handleGoLive`'s POST payload only ever sends Steps 1-4's data:**
   ```js
   body: JSON.stringify({ name: campaignName, type: campaignType, numberId: selectedNumberId, templateId: selectedTemplateId, scheduleType, scheduledAt })
   ```
   (`CreateCampaign.jsx:910`). There is no field for reply-flow rules, retry config, tracking params, or fallback channels anywhere in the request to `POST /campaigns`, nor does the backend `campaigns.service.js`/`Campaign` Prisma model have any columns to receive them even if the frontend did send them (no `replyRules`, `retryConfig`, `utmParams`, or `fallbackChannels` fields exist on `Campaign`).

4. Steps 5-8 are also never "locked" (`isLocked(n)` only gates `n === 2, 3, 4`; returns `false` for everything else, including 5-8) — so a user can open and "complete" them in any order, out of sequence with the rest of the wizard, reinforcing that they were never actually integrated into the wizard's real flow/validation.

### Net effect
Steps 5-8 are a fully-built UI prototype with no backend integration at all — anything a user configures there is silently discarded the moment they click "Save" (which does nothing) or leave the step, and none of it is ever sent when the campaign is actually created/launched. This will read to a user as "broken" exactly as reported, since the UI gives every visual cue (toggles, inputs, a green "Save" button) that the configuration was accepted.

### Suggested fix direction (not yet implemented)
- Add backend support: new columns/JSON fields on `Campaign` (or related tables) for reply-flow rules, retry config, UTM/conversion tracking, and fallback-channel settings, plus corresponding update endpoints.
- Lift Steps 5-8's local state up into the parent `CreateCampaign` component (same pattern as Steps 1-4) so it survives step navigation and can be included in the `POST /campaigns` payload (or a follow-up `PATCH` after creation).
- Wire each step's "Save" button to actually persist that step's data (either into parent state immediately, or via its own API call), and add loading/success/error feedback so it's clear the save succeeded or failed.
- Until this is built, consider marking Steps 5-8 as "Coming Soon" (matching the pattern already used for Step 8's fallback channel options) rather than presenting fully-interactive controls that silently do nothing.

## 6. Inbox never receives real conversations/messages — Meta is never subscribed to send webhook events for a connected number

**Where:**
- Frontend: `frontend/src/pages/InboxView.jsx` (polls `/conversations` every 5s and `/conversations/:id/messages` every 4s)
- Backend: `backend/src/services/conversations.service.js`, `backend/src/controllers/webhook.controller.js`, `backend/src/services/webhook.service.js` (`handleInboundMessage`, ~line 92-196)
- Number connection: `backend/src/services/whatsapp.service.js` (`connectOwnNumber`, `onboardFromPool`), `backend/src/services/admin.service.js` (pool add/assign/OTP/sync)

**Reported behavior:** The Inbox section doesn't work at all — nothing has ever worked there.

### Root cause

The Inbox's own code is actually correctly built end-to-end: `InboxView.jsx` polls for conversations and messages, `conversations.service.js`'s `listConversations`/`getMessages`/`sendMessage` are real (outbound send calls the real Meta Graph API via `sendTextMessage`), the routes are properly mounted and auth-gated, and `webhook.service.js`'s `handleInboundMessage` correctly creates `Contact`/`Conversation`/`Message` rows when it receives an inbound-message webhook event from Meta. **The problem is nothing ever triggers that last step, because Meta is never told to send webhook events for any connected number in the first place.**

WhatsApp Cloud API requires an explicit, one-time API call — `POST /{waba-id}/subscribed_apps` — to subscribe an app to a WABA before Meta will deliver *any* webhook events (inbound messages, message status/delivery receipts, template status updates) for numbers on that WABA. **Grepping the entire backend for `subscribed_apps`/`subscribeApp`/"subscribe" (case-insensitive) finds zero matches anywhere in the current code** — not in `lib/meta.js`, not in `whatsapp.service.js`'s `connectOwnNumber` or `onboardFromPool`, not in `admin.service.js`'s pool-add/assign/OTP/sync functions. No matter which of the two connection paths a business uses (manual "Connect Your Own" form, or purchasing from the Number Pool), **the app subscription step is simply never performed**, so Meta has no reason to ever call this backend's `/api/v1/webhook` endpoint for that number.

The webhook *receiver* itself (`webhook.controller.js`) is correctly implemented (HMAC signature verification via `req.rawBody` captured in `app.js:13`, proper 200 ack, async dispatch to `processWebhook`) — it would work fine if Meta ever called it. It just never gets called, because the subscription was never registered.

This single root cause cascades into several symptoms already documented elsewhere in this file:
- **Inbox stays permanently empty** — no inbound message webhook ever arrives, so `handleInboundMessage` never runs, so no `Conversation`/`Message` rows are ever created. (Outbound sending from an existing conversation would still technically work via the real Meta API call in `sendMessage`, but there's never an existing conversation to send from, since those are only ever created from an inbound message.)
- **Campaign `delivered`/`read` counters and Rate column stay at 0** (see bug #4) — status-update webhooks never arrive either, for the same reason.
- **Template approval status never updates automatically** — `message_template_status_update` webhooks never arrive, so templates stay `PENDING` until a user manually clicks "sync from Meta."

Consistent with bug #2 (the Embedded Signup regression): the missing memory record of that feature explicitly mentions a `subscribeAppToWaba` helper as part of the completed Embedded Signup implementation on `feature/embedded-signup` — this subscription call was apparently only ever wired into that now-missing code path, not into the manual "Connect Your Own" or Number Pool paths that are currently the only working ways to connect a number.

### Suggested fix direction (not yet implemented)
- Add a `subscribeAppToWaba(wabaId, accessToken)` call to `lib/meta.js` (`POST /{waba-id}/subscribed_apps`) if it doesn't already exist on the `feature/embedded-signup` branch (recover it from there per bug #2 if so).
- Call it at the end of every number-connection path that currently creates a `WaNumber`: `whatsapp.service.js`'s `connectOwnNumber` and `onboardFromPool`, and `admin.service.js`'s manual add/OTP-verify/assign-to-workspace/sync-from-WABA functions — so every way of connecting a number actually registers for webhooks, not just Embedded Signup.
- Add a way to verify/display subscription status per number (e.g. a diagnostic check against `GET /{waba-id}/subscribed_apps`) so support/admin can confirm a given number is actually receiving events, rather than discovering silently-missing webhooks only when a customer reports "nothing arrives."
- Once subscribed, re-verify the full inbound path against a real test number to confirm `handleInboundMessage` actually populates the Inbox as expected.

## 7. Integrations tab is entirely fake — no backend exists for it at all, and it stores raw third-party API keys/secrets in plaintext in browser localStorage

**Where:** `frontend/src/pages/IntegrationsView.jsx` (entire file, 730 lines) — no backend counterpart exists anywhere.

**Reported behavior:** Full review requested — this tab had never been checked before.

### Root cause: zero backend wiring, confirmed by grep

Grepping the entire backend (`backend/src`) for `integration` (case-insensitive) returns **zero matches** — there is no route, controller, service, or Prisma model for integrations anywhere in this codebase. The whole 24-integration catalogue (WhatsApp Pay, Razorpay, PayU, Stripe, Shopify, WooCommerce, Zapier, HubSpot, Salesforce, etc.) is a hardcoded static array (`INTEGRATIONS`, lines 14-204) in the frontend only, and every "connection" is entirely client-side theater:

1. **`ConnectModal.handleSave` (line 320-324) does nothing real:**
   ```js
   const handleSave = async () => {
     setSaving(true);
     await new Promise(r => setTimeout(r, 1100));   // fake "Connecting…" delay
     onSave(intg.id, cfg.type === 'webhook' ? { webhook_url: wUrl } : cfg.type === 'oauth' ? { oauth: true } : values);
   };
   ```
   There is no `fetch`/API call anywhere in this file. "Connecting…" is a plain `setTimeout`, and `onSave` just writes to `localStorage` (`saveConnected`, line 11, key `chatflow_integrations_v1`) via `handleSave` in the parent (line 607-612). Nothing is ever sent to the backend, so no integration ever actually does anything — Shopify product sync, Stripe payment notifications, CRM lead sync, Zapier/Make triggers, etc. are all inert.

2. **Sensitive credentials are stored in plaintext in browser localStorage, unencrypted, forever.** For every `apikey`-type integration (Razorpay, PayU, Stripe, Cashfree, Shopify, WooCommerce, Freshworks, Freshdesk, Yampi, Judge.me, Wafeq — 11 of the 24 integrations), the user is asked to paste real production secrets (Stripe secret key, Razorpay key secret, WooCommerce consumer secret, Shopify Admin API key, etc. — see `CONNECT_CONFIG`, lines 207-234) into a form whose only persistence is `localStorage.setItem(...)` with no encryption. This is a real security issue, not just a "doesn't work" bug: any XSS on this origin, browser extension with page access, or shared/public computer exposes every credential a user has ever entered here indefinitely (localStorage has no expiry). Compare to how `WaNumber.encryptedAccessToken` is at least encrypted at rest server-side (`backend/src/lib/encryption.js`) — these third-party secrets get materially weaker protection than the platform's own Meta tokens.

3. **OAuth-type integrations (Google Sheets, Facebook Lead Form, Zoho CRM/Bigin/Billing/Books, HubSpot, Salesforce, Calendly — 9 integrations) never perform a real OAuth redirect.** The modal shows an "Authorize {provider}" button and copy about being "redirected to {provider}," but clicking it just runs the same fake 1.1s `setTimeout` and marks `{ oauth: true }` in localStorage (line 323) — there is no `window.location`/popup redirect to any real OAuth authorize URL anywhere in the file, and no backend OAuth callback route exists for any of these providers (only Google login OAuth exists, for platform auth, unrelated to this).

4. **Webhook-type integrations (Pabbly Connect, Make/Integromat, Zapier) generate a URL to a domain that isn't part of this deployment:**
   ```js
   function webhookUrl(id) { return `https://hooks.chatflowpro.com/wh/${getWorkspaceId()}/${id}`; }
   ```
   `hooks.chatflowpro.com` doesn't exist anywhere else in the codebase or in the deployment setup (per project memory, the deployed app is a single Render service serving relative `/api/v1` paths — no separate `hooks.` subdomain, no route in `backend/src/routes` matches `/wh/:workspaceId/:integrationId`). If a user actually pastes this URL into Zapier/Make/Pabbly as instructed, every trigger will simply fail (unresolvable host / 404) since nothing is listening there.

5. **"Connected" state isn't scoped per workspace.** `STORAGE_KEY = 'chatflow_integrations_v1'` (line 6) is a single global localStorage key, not namespaced by workspace ID (unlike the webhook URL itself, which does embed `getWorkspaceId()`). If the same browser is used to view more than one workspace (e.g., a super admin checking multiple clients, or a shared/support machine), each workspace's "connected" badges and any saved API keys bleed into every other workspace viewed from that browser.

### Net effect
The entire Integrations tab is a non-functional visual prototype. No integration in the catalogue does anything — nothing is sent to any third-party API, no webhook is actually registered, no OAuth token is ever obtained, and no data flows between ChatFlow Pro and any of these 24 services. Worse than just "not working," it actively invites users to paste live production API secrets into a form that stores them insecurely and permanently in their browser with no backend involvement whatsoever.

### Suggested fix direction (not yet implemented)
- Build real backend support: a Prisma model (e.g. `WorkspaceIntegration`) to store connection state and encrypted credentials per workspace (reuse the existing `lib/encryption.js` pattern used for `WaNumber.encryptedAccessToken`), plus routes/services for create/list/delete per integration.
- For `apikey`-type integrations, submit credentials to a real backend endpoint that encrypts and stores them server-side — never persist raw secrets client-side.
- For `oauth`-type integrations, implement real OAuth authorize/callback flows per provider (or explicitly mark them "Coming Soon" until built, rather than showing a fully-interactive fake authorize screen).
- For `webhook`-type integrations, either stand up a real `hooks.chatflowpro.com` (or equivalent) receiving endpoint wired into this backend, or point the generated URL at the real deployed origin's `/api/v1/...` path instead of a non-existent subdomain.
- Until any of the above exists, consider labeling the whole tab "Coming Soon" / read-only catalogue (no interactive Connect flow) to avoid collecting and mishandling real user credentials in the meantime.
- Fix the localStorage key to be workspace-scoped (e.g. `` `chatflow_integrations_v1:${workspaceId}` ``) regardless of the above, since credential/connection bleed across workspaces on a shared browser is a bug on its own.

## 8. Automation tab — full review: most of it is not functional. Only 2 of 9 sub-tabs actually automate anything

**Where:** `frontend/src/pages/AutomationView.jsx` (entire file, 1590 lines, 9 sub-tabs) + `backend/src/controllers/automation.controller.js`, `backend/src/services/automation.service.js`, `backend/src/routes/automation.routes.js`

**Summary verdict (headline for this bug): out of the 9 sub-tabs under Automation, only "Custom Auto Reply" is a fully real, working automation. "Basic Automations" is mostly real (2 of its 3 toggles work). Everything else — Workflows, AI Intent Matching, WhatsApp AI Agent, Instagram Quickflows, Voice AI, WhatsApp Forms, Smart Lists — is either entirely fake UI, saves data that nothing ever acts on, or is a settings-only shell with no execution engine behind it. As the user suspected: the "automation" part of this product is effectively not built yet, beyond simple keyword auto-replies.**

Tab-by-tab findings:

### 1. Basic Automations — MOSTLY REAL, one dead toggle
`BasicAutomationsTab` correctly reads/writes `GET`/`PATCH /automation/basic` to real `Workspace` columns (`autoOooEnabled`, `autoWelcomeEnabled`, `autoDelayedEnabled` — `automation.service.js`). Of the three:
- **Welcome Message** and **Out of Office Message** are genuinely consulted at runtime — `webhook.service.js:164-168` checks `autoWelcomeEnabled`/`autoOooEnabled` when an inbound message arrives and sends the corresponding auto-reply. These work.
- **Delayed Response Message** persists to the DB (`autoDelayedEnabled`) but is **never read anywhere else in the backend** — grepping for `autoDelayedEnabled` outside `automation.service.js`'s get/update functions finds no consumer. There is no delay-timer mechanism, no "you've been unresponsive for N minutes, send this message" logic anywhere. Toggling it on has zero effect — it's a dead setting that looks live.

### 2. Custom Auto Reply — REAL, the one fully working automation
`CustomAutoReplyTab` is genuine CRUD on `AutomationTrigger` (`/automation/triggers`), and this is the **only** automation in the entire tab that is both fully wired end-to-end and actually executes: `webhook.service.js`'s `findMatchingTrigger` (via `automation.service.js`) does keyword substring matching against inbound messages and sends the configured reply. This works as advertised.

### 3. Workflows — SAVES DATA, NEVER EXECUTES IT (confirmed dead end)
`WorkflowsTab` has full CRUD (`/workflows`) plus an AI-assisted builder (`POST /automation/workflows/ai-preview`, Gemini-backed with a non-AI fallback in `automation.service.js`). Building and saving a workflow works. **But nothing ever runs a saved workflow.** As already documented in this file (bug #1 / project memory), `Workflow.nodes`/`edges` has zero interpreter anywhere in the backend — inbound messages only ever consult `AutomationTrigger` (tab #2 above), never `Workflow`.
- Worse: the **"Run AI Test Simulation" button actively misleads users into thinking it works.** It calls `POST /api/v1/ai/workflow/execute` (`runSimulation`, `AutomationView.jsx:376-403`), which hits `ai.controller.js`'s `executeWorkflow` — a hardcoded stub that ignores `req.body.workflowId` entirely and always returns `{ status: 'workflow_executed', message: 'Successfully triggered automation flow via AI' }`. So clicking "Run AI Test Simulation" on *any* workflow, including an empty or nonsensical one, always shows a green "Successfully triggered automation flow via AI" success message — there is no actual simulation happening, and no way for a user to discover their workflow doesn't do anything until they test it for real (which is impossible, since nothing executes workflows in production either).

### 4. AI Intent Matching — 100% FAKE, not wired to anything
```jsx
const AIIntentMatchingTab = () => {
  const [enabled, setEnabled] = useState(false);
  ...
  <Toggle on={enabled} onToggle={() => setEnabled(!enabled)} />
```
The entire tab is local component state with **no `wFetch` call anywhere in it** — no fetch on mount, no save on toggle. Refreshing the page always resets it to "Disabled." There is no corresponding backend route (`automation.routes.js` has no intent-matching endpoint) and no field on `Workspace` for it. The tab also displays a specific, concrete-sounding billing claim — **"₹0.2 per successful intent match will be deducted from wallet"** — for a feature that cannot ever be "enabled" in any way that persists or does anything; this is worth flagging as potentially misleading even though nothing can currently be charged (there is no wallet-deduction logic anywhere in the backend for this feature).

### 5. WhatsApp AI Agent — 100% FAKE, no persistence, no execution
`WhatsAppAIAgentTab`'s System Prompt `<textarea>`, AI Model `<select>`, Temperature `<input type="range">`, and Knowledge Base `Toggle` are **entirely uncontrolled or locally-scoped** — the textarea has no `value`/`onChange` wired to any state variable that's ever read, the select and range input aren't wired to state at all, and `kbEnabled` is local `useState` only. **Zero `wFetch` calls exist anywhere in this component.** The "Deploy Agent" button (`handleDeploy`, line 880-884) is a pure UI animation — `setTimeout(1500ms)` flips a "Deploying…" state to "Deployed!" and back, with no network request at all. Nothing about this tab is connected to anything: not the onboarding chat agent (bug #1), not any LLM, not any deployment mechanism.

### 6. Instagram Quickflows — mostly fake; the one real piece is a stub
"New IG Flow" button has **no `onClick` handler at all** — dead. "Connect Instagram Account" does trigger a real-looking redirect to Instagram's OAuth authorize URL (`handleConnect`, line 939-944), and there is a matching backend route (`GET /auth/instagram/callback`, `auth.routes.js:75`) — but that callback is an explicit stub:
```js
// NOTE: In a real implementation you would exchange the code for a token via Instagram Basic Display API.
return res.redirect(`${env.CLIENT_URL}/settings/instagram?code=${encodeURIComponent(code)}`);
```
It never exchanges the OAuth `code` for an access token, never stores any Instagram connection anywhere, and just redirects back to a `/settings/instagram` frontend route with the raw code in the query string — which nothing in the frontend consumes either (no route/handler reads a `code` query param anywhere in `SettingsView.jsx` or elsewhere). So even the one flow that looks real dead-ends with no persisted connection.

### 7. Voice AI - Inbound Calls — settings persist, but there is no telephony engine behind it at all
`VoiceAITab` correctly reads/writes `GET`/`PATCH /automation/voice` to real `Workspace` columns (`voiceAiEnabled`, `voiceAiName`, `voiceAiPrompt`, `voiceAiPhone` — `automation.service.js:166-192`), so the settings genuinely save. **But grepping the entire backend for any call-handling/telephony code (Twilio Voice webhooks, IVR, speech-to-text, TwiML) finds nothing at all.** There is no route that would ever receive an inbound phone call, no code that answers a call with the configured `voiceAiPrompt`, and no lead-capture logic. The marketing copy on this tab ("Get an AI Receptionist to handle your calls 24/7," "AI answers calls 24x7," "Leads auto-pushed to ChatFlow Pro") describes a feature with zero backend implementation — enabling it only flips a database flag with no functional consequence.

### 8. WhatsApp Forms — CRUD works, but there's no actual form behind it
`WhatsAppFormsTab` has real CRUD (`/whatsapp-forms`) against the `WhatsappForm` model — but that model (`schema.prisma`) is just `{ name, submissions: Int, fields: Int, status }`. **`fields` is a plain number the user types in (e.g. "3"), not a list of actual form field definitions** (no field names, types, or questions are ever captured), and `submissions` is a static counter that's never incremented anywhere in the backend (no consumer of it found). There is no way to actually design what the form asks, no way to send it to a WhatsApp contact (no integration with Meta's WhatsApp Flows/interactive-message APIs), and no real submission ever gets recorded. This tab lets you create a database row with a name and a number on it — it does not let you "collect structured data natively inside WhatsApp" as advertised.

### 9. Smart Lists (Segments) — CRUD works, but is an isolated dead end elsewhere in the product
`SmartListsTab` has real, working CRUD for `Segment`s and per-segment contacts (`/segments` routes). This is a genuinely functional part of the product on its own. **However**, as already noted in bug #5, the one place Segments could be used — selecting a segment as campaign audience in `CreateCampaign.jsx` — has that option present in the UI but `disabled: true`. So Smart Lists can be built, but currently cannot be used for anything (no campaign, no automation, no workflow anywhere consumes a `Segment`).

### Net effect
Of the 9 Automation sub-tabs: **1 (Custom Auto Reply) is fully real and working. 1 more (Basic Automations) is mostly real (2 of 3 toggles). The remaining 7 tabs are either entirely disconnected from any backend (AI Intent Matching, WhatsApp AI Agent), save data with no execution engine behind it (Workflows, Voice AI, WhatsApp Forms), or are dead/stubbed integrations (Instagram Quickflows).** Confirms the suspicion driving this review: beyond simple keyword-triggered auto-replies and welcome/OOO messages, the Automation section does not yet automate anything.

### Suggested fix direction (not yet implemented)
- Prioritize by user-facing risk: fix the two "actively misleading" pieces first — the Workflows "Run AI Test Simulation" button (currently always reports fake success regardless of workflow content) and the AI Intent Matching tab's wallet-deduction claim for a feature that can't be enabled.
- Decide product scope: either build a real workflow execution engine (the biggest lift — needs a node/edge interpreter wired into `webhook.service.js`'s inbound-message handling, replacing/extending the current `AutomationTrigger`-only path) or remove/hide the Workflows, AI Intent Matching, WhatsApp AI Agent, Voice AI, and Instagram Quickflows tabs until they have real backends, so the product doesn't advertise capabilities it doesn't have.
- If keeping Voice AI and WhatsApp Forms as roadmap items, relabel them "Coming Soon" (as is already done elsewhere in the app, e.g. Step 8 fallback channels in bug #5) rather than presenting fully-interactive save/deploy flows with no effect.
- Wire Smart Lists (Segments) into `CreateCampaign.jsx`'s audience picker (see bug #5) so the one genuinely functional CRUD feature in this tab has somewhere to actually be used.

## 9. No dedicated Super Admin dashboard exists — the platform owner has no separate area for platform-wide administration

**Where:**
- Frontend: `frontend/src/pages/Dashboard.jsx` — `Sidebar`, `ADMIN_NAV`/`CLIENT_NAV` (~line 1241-1265), `NumberSetupView.jsx` (only place any `superAdmin`-gated UI exists)
- Backend: `backend/src/routes/admin.routes.js`, `backend/src/services/admin.service.js`

**Reported requirement:** Super Admin (the platform owner) should have their own dedicated admin dashboard — covering platform-wide analytics, restrictions on clients/workspaces, issue reports, a "Contact Us" management view, and other platform-owner-level tools — separate from the regular workspace dashboard. Regular workspace users (admin/client) should not see platform-wide analytics.

### Root cause: confirmed — no such page or nav entry exists anywhere

**1. The sidebar navigation is literally identical for every role, including super admin.**
```js
const CLIENT_NAV = ADMIN_NAV;              // Dashboard.jsx:1258 — same array, no distinction
...
const Sidebar = ({ page, setPage, onNav, user }) => {
  ...
  const NAV = ADMIN_NAV;                   // Dashboard.jsx:1264 — hardcoded, ignores role/superAdmin entirely
```
Even though `Dashboard`'s top-level component computes `NAV = isAdmin ? ADMIN_NAV : CLIENT_NAV` (line 1346) as if role-based menus were intended, `Sidebar` never receives that as a prop and instead hardcodes its own `NAV = ADMIN_NAV` internally — so this distinction is dead code, and in practice every user (client, workspace admin, and platform super admin alike) sees the exact same 14-item menu: Home, Templates, Campaigns, Contacts, Inbox, Integrations, Automation, Analytics, Chat Analysis, User Analytics, Number Setup, Payments, API Keys, Settings. **There is no "Admin Dashboard," "Platform," or "Super Admin" nav item anywhere in this list.**

**2. The only super-admin-specific UI in the entire app is a panel buried inside a client-facing page.** The single place `superAdmin` gates any UI is `NumberSetupView.jsx:340` — a Number Pool management panel (stats, sync-from-WABA, assign-to-workspace, reset/ban) shown *inside* the regular "Number Setup" page that every workspace admin also uses to connect their own number. There is no standalone route/page for it; a super admin has to go to what looks like their personal number-connection screen to find the one bit of platform administration that exists.

**3. Everything else a super admin sees is scoped to their own personal workspace, not the platform.** Logging in as the super-admin email doesn't grant any different view of Analytics, Chat Analysis, User Analytics, Campaigns, etc. — `analytics.service.js`'s `getOverview`/`getDeliveryStats`/`getCampaignStats`/`getAgentStats`/`getChatAnalytics` are all `workspaceId`-scoped (confirmed by signature — every function takes a single `workspaceId` and queries only that workspace's data). A super admin registering an account still gets their own brand-new personal `Workspace` like any other user (per `auth.service.js` register flow — see `[[auth-roles-architecture]]` memory), and every analytics screen they see is just that one workspace's numbers, not platform-wide totals across all clients. There is no backend endpoint anywhere that aggregates across workspaces (e.g. total messages sent platform-wide, total active clients, total revenue) — `admin.service.js`'s only non-pool function is `listWorkspaces` (a bare list with name/owner, no metrics attached).

**4. No client/workspace restriction (suspend/ban a client) capability exists.** The only "ban" in the entire codebase is `banPoolEntry` (`admin.service.js:91`), which bans a *phone number* in the Number Pool — there is no way for the super admin to suspend, restrict, or disable a workspace/client account itself.

**5. No issue-report or "Contact Us" system exists anywhere.** Grepping the Prisma schema and backend for anything resembling a support ticket, issue report, or contact request model/route finds nothing — there is no `Ticket`/`Report`/`SupportRequest` model in `schema.prisma`, and no corresponding routes/controllers. If clients currently have any way to report an issue or contact support, it isn't tracked or visible anywhere in this product — certainly not to the super admin.

### Net effect
The platform owner (super admin) has no dedicated administrative surface at all. Their experience is nearly indistinguishable from a regular workspace admin's — same nav, same workspace-scoped analytics, same everything — except for one buried panel on the Number Setup page for managing the shared Number Pool. There is no way to see platform-wide usage, manage/restrict clients, review reported issues, or handle contact/support requests from a central place.

### Suggested fix direction (not yet implemented)
- Add a dedicated `admin`/`platform` route in `Sidebar`'s nav, shown only when `user.superAdmin === true`, leading to a new standalone Super Admin Dashboard page — separate from the regular workspace `Dashboard`.
- Fix `Sidebar` to actually use its role-aware `NAV` (currently dead code — the prop is computed in `Dashboard` but never passed to or used by `Sidebar`) as part of this, so roles genuinely produce different menus.
- Move the existing Number Pool management panel out of `NumberSetupView.jsx` into this new dedicated dashboard (it's the one piece of super-admin tooling that already exists and works).
- Add backend support for platform-wide aggregate analytics (total workspaces, total messages/campaigns sent across all clients, revenue, growth over time) — a new set of endpoints under `admin.routes.js` distinct from the existing per-workspace `analytics.routes.js`.
- Add workspace/client restriction capability (suspend/reactivate a workspace) distinct from the existing pool-entry-only `banPoolEntry`.
- Add an issue-report / "Contact Us" model and flow (new Prisma model + routes) so clients can report problems and the super admin has a place to review and act on them — currently nothing like this exists in the product at all.
- Ensure regular workspace admins/clients continue to see only their own workspace's analytics (already true today) once platform-wide analytics exists, so it stays exclusive to the super admin dashboard as requested.

## 10. Wallet is entirely client-side and trivially spoofable — no backend, no server-side balance, no authentication at all (security issue, not just "unfinished")

**Where:** `frontend/src/pages/PaymentsView.jsx` (entire file, Wallet/Expenses/Insights/Billing/Subscription sub-tabs), `frontend/src/pages/Dashboard.jsx` (Sidebar wallet balance display, `Sidebar` ~line 1266-1277)

**Reported behavior:** Wallet "organisation" isn't done properly — no proper security/authentication behind it.

### Root cause: confirmed — the wallet has no backend at all; the balance is just a number in `localStorage`

Grepping the entire backend for `wallet` (case-insensitive) returns **zero matches**. There is no `Wallet` model in `schema.prisma`, no wallet routes/controllers/services, and no `balance` field on `Workspace` or `User`. Everything is implemented purely in the browser:

1. **The balance itself is a raw, unauthenticated `localStorage` number that any user can edit directly:**
   ```js
   localStorage.setItem('chatflow_wallet_balance', newBal.toFixed(2));
   window.dispatchEvent(new CustomEvent('wallet:balance-updated', { detail: newBal }));
   ```
   (`PaymentsView.jsx:82-86`). Any user can open devtools and run `localStorage.setItem('chatflow_wallet_balance', '99999999')` to instantly grant themselves unlimited balance — there is no server involved at any point, so there is nothing to authenticate against or validate server-side. This is the literal meaning of "no proper security and authentication for wallets": the concept of a wallet balance exists only as trusted client state.

2. **"Recharge Now" doesn't call any real payment gateway.** `handleRecharge` (`PaymentsView.jsx:89-112`) is:
   ```js
   setRechargeStatus('processing');
   setTimeout(() => {
     const newBal = balance + amt;
     updateBalance(newBal);
     ...
   }, 1200);
   ```
   A 1.2-second `setTimeout` fakes a payment, then adds the user-typed amount directly to the local balance. There's no Razorpay/Stripe/PayU checkout, no server-side payment verification, no webhook confirming a real charge succeeded before crediting the balance — the "recharge" is just "type any number, wait 1.2s, get that much added to your balance."

3. **Nothing server-side ever actually deducts from this balance.** Bug #8 already documented that "AI Intent Matching" claims "₹0.2 per successful intent match will be deducted from wallet" — there is no backend logic anywhere that deducts anything from anything, because there's no backend wallet to deduct from. The "Track Expenses" tab (`renderExpenses`, `PaymentsView.jsx:174-198`) reinforces this: its four "recent" expense line items (`AI Intent matching execution`, `Voice AI receptionist inbound call`, `Campaign delivery batch`, `WhatsApp Form Submission response routing`) are **hardcoded static data**, not fetched from anywhere — every user sees the identical fake expense history regardless of what they've actually done.

4. **Balance isn't scoped per user or workspace.** `chatflow_wallet_balance` is a single global localStorage key (same pattern as the Integrations bug, #7) — not namespaced by user or workspace ID. On a shared browser, or a super admin checking multiple client accounts, wallet balances bleed across accounts. There's also no server-side association between a balance and a workspace at all, since the balance doesn't exist server-side in the first place.

5. **The rest of the Payments section shares the same pattern — Billing Details, Subscription, and Add-ons are all fake, localStorage-only:** `handleSaveBilling` (line 114-119) and `toggleAddon` (line 121-125) both just write to `localStorage` (`chatflow_billing_details`, `chatflow_subscribed_addons`) with no backend call. "Cancel Subscription" / "Reactivate Plan" (line 301-303) just flips a local `useState` boolean — no real subscription is ever created, billed, or cancelled anywhere.

6. **Invoices are a confusing hybrid of real and fake data.** The Invoices tab does fetch genuine records from a real backend endpoint (`GET /settings/invoices`, backed by the actual `Invoice` Prisma model) — but every wallet "recharge" additionally prepends a **client-only fake invoice** to the in-memory list (`newInvoice` with `id: local_inv_${Date.now()}`, `PaymentsView.jsx:99-107`) that is never sent to or persisted by the backend. That fake invoice disappears the moment the page is refreshed, while genuinely-created `Invoice` rows (however those get created — no code path in this file creates a real one) persist. A user has no way to tell which invoices in the list are real.

### Net effect
The Wallet is not a real financial feature — it's an unauthenticated, purely cosmetic number stored in the browser that any user can set to anything via devtools, with a fake "recharge" flow that never touches a payment processor, and expense/deduction data that's entirely hardcoded rather than reflecting real usage. If this wallet balance is ever intended to gate real paid features (as bug #8's AI Intent Matching pricing claim implies), the current implementation provides **zero actual protection** — it's trivially bypassable by anyone with browser devtools access, not merely "unfinished."

### Suggested fix direction (not yet implemented)
- Add a real `Wallet`/`WalletTransaction` model (balance + immutable transaction ledger) tied to `Workspace`, with all balance reads/writes happening server-side only — the frontend should never be the source of truth for balance.
- Integrate a real payment gateway (Razorpay/Stripe/PayU — several are already referenced as "integrations" in bug #7) for recharges: client requests a payment session, gateway processes the real charge, gateway webhook confirms success server-side, only then does the backend credit the wallet — never let the client directly set the new balance.
- Wire real usage-based deductions server-side wherever a paid action actually occurs (once such actions exist — most currently don't, per bug #8), writing to the transaction ledger so "Track Expenses" reflects real activity instead of hardcoded sample rows.
- Persist Billing Details and Subscription/Add-on state server-side (new fields/models under `Workspace` or a dedicated `Subscription` model) instead of `localStorage`, and back real invoice generation off the same source of truth so every row in the Invoices tab is genuine.
- Until a real backend exists, treat this as a security-relevant gap, not a cosmetic one — do not use the current wallet balance to gate any real feature or billing decision.

## 11. Email+password signup is completely missing (dead nav link, no Register page at all) — only Google login actually works. Requested: build a proper OTP-verified signup flow using SMTP

**Where:**
- Frontend: `frontend/src/pages/Login.jsx:114` ("Create one free" link), `frontend/src/App.jsx` (page router)
- Backend: `backend/src/controllers/auth.controller.js` (`register`), `backend/src/services/auth.service.js` (`register`, working but unreachable), `backend/src/lib/mailer.js` (SMTP already implemented and used elsewhere)

**Reported behavior:** Only the Google sign-in option works. Creating a new account and logging in with email + password both fail.

### Root cause: there is no Register/Signup page anywhere in the frontend — the backend endpoint exists but is completely unreachable from the UI

`Login.jsx:114`:
```jsx
<span onClick={() => onNav('register')} ...>Create one free</span>
```
This calls `onNav('register')`, which in `App.jsx`'s router:
```js
if (page === 'landing')   return <Landing onNav={nav} />;
if (page === 'login')     return <Login onNav={nav} />;
if (page === 'dashboard') return <Dashboard onNav={nav} />;
return <Landing onNav={nav} />;   // 'register' matches none of the above — silently falls through here
```
`'register'` isn't handled by any case, so the app just silently redisplays the **Landing page** with no error, no explanation, and no way to tell the user clicked anything. **There is no `Register.jsx` (or equivalently named) file anywhere in `frontend/src/pages`** — confirmed by directory listing and by grepping the entire frontend for `register`/`signup` (case-insensitive), which only turns up this one dead `onNav('register')` call and unrelated matches (a UTM field placeholder, a template-library string). Nothing in the frontend ever calls `POST /api/v1/auth/register`.

The backend registration endpoint itself is fully implemented and correct — `auth.controller.js:3-6` → `auth.service.js:32-63` (creates `User`, creates a personal `Workspace`, hashes the password, issues tokens) — it's just **completely unreachable** because no UI exists to call it. Since no email+password account can ever be created through the product, "login with email and password" only ever works for accounts created some other way (e.g. directly in the database, or via Google OAuth accounts that also happen to have a password set — which none do, since `findOrCreateGoogleUser` never sets a `passwordHash`). This is why both "create account" and "email/password login" read as broken: there is no working path to ever get a password-based account in the first place.

### Requested feature: OTP-verified signup module (build from scratch)

Per the requirement: signup should work as a distinct, secure flow, not just a plain register form:
1. User enters email + password (+ name) to start signup.
2. Backend generates an OTP and emails it to the address via SMTP — **`backend/src/lib/mailer.js` already has a working `sendMail({ to, subject, html })` using `nodemailer` and configured SMTP env vars (`SMTP_HOST`/`SMTP_USER`/`SMTP_PASSWORD`/etc.), already used in production for welcome/invite/approval emails (`email.service.js`, `email.queue.js`, `email.worker.js`) — this can be reused directly for OTP delivery, no new email infra needed.**
3. User enters the OTP into a verification screen.
4. Backend verifies the OTP (correct code, not expired, not already used/exceeded attempt limit).
5. **Only if OTP verification succeeds** does the backend actually create the `User` + `Workspace` (i.e., move the existing `auth.service.js` `register()` logic behind successful OTP verification, rather than running immediately on form submit).
6. Once created, the user can log in normally with that email + the password they set during signup — using the already-working `POST /api/v1/auth/login` flow.

### What doesn't exist yet and needs to be built
- **No OTP model at all in the schema.** Grepping `schema.prisma` and the whole backend for anything email-OTP-related finds nothing — the only existing "OTP" in this codebase is a completely unrelated concept: `admin.service.js`'s `sendOtpRequest`/`verifyOtpAndAdd` (Meta's phone-number OTP verification for adding numbers to the Number Pool). A new model is needed, e.g. `EmailOtp { email, codeHash, expiresAt, attempts, purpose, createdAt }`, generated server-side, never sent to the client except via email.
- **No pending-signup state.** Since account creation must not happen until OTP verification succeeds, unverified signup attempts (email/password/name entered but not yet OTP-confirmed) need to be held somewhere (either a short-lived `PendingSignup` table, or the OTP record itself carrying the pending name/password hash) rather than being written to `User` immediately.
- **No frontend at all** — needs a real `Register.jsx` (reachable via `App.jsx`'s router, fixing the dead `'register'` case), a two-step UI (details → OTP entry), resend-OTP handling, and expiry/error states.
- **New backend endpoints**, e.g. `POST /auth/register/start` (validate email not already in use, create pending signup + OTP, email it), `POST /auth/register/verify` (check OTP, create the real `User`/`Workspace`/tokens only on success), and a resend endpoint with basic rate-limiting to prevent OTP spam.

### Suggested fix direction (summary)
- Immediate/minimal fix: add the missing `Register.jsx` page and wire `App.jsx`'s router to handle `'register'`, so at minimum the existing (working) `register()` backend call becomes reachable — this alone would unblock account creation.
- Full requested fix: build the OTP module as described above (new `EmailOtp`/pending-signup model, `start`/`verify`/`resend` endpoints, SMTP delivery via the already-working `mailer.js`, two-step frontend flow), and gate actual `User`/`Workspace` creation behind successful OTP verification rather than immediate form submission.
