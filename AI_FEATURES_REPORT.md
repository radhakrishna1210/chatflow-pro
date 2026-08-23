# ChatFlow Pro — AI Features Add-on

This package contains **only** the files changed/added to build the four features that were previously marked "Coming Soon":

1. WhatsApp AI Agent (deploy + live test)
2. AI Intent Matching
3. Campaign fallback channels (SMS / email, wizard step 8)
4. Per-provider integration OAuth

It is a patch on top of the v2 codebase — drop these files over your existing repo (same paths), apply the migration, and rebuild. Verified by a self-contained E2E suite: **33/33 passing** (`tests-e2e-v3.mjs`).

---

## Apply

1. **Copy files** — overlay every file in this archive onto your repo at the same path.
2. **Migrate** — apply the schema changes (new: `Campaign.fallbackConfig`; `Workspace.aiAgent*` + `intentMatching*`):
   ```
   # from backend/
   npx prisma migrate dev        # or apply prisma/migrations/manual/003_ai_features.sql
   npx prisma generate
   ```
3. **Rebuild frontend** — `npm run build` in `frontend/`.
4. **Env vars** (all optional — features degrade honestly without them):
   - `GEMINI_API_KEY` — enables AI Agent replies + AI Intent Matching's LLM classifier. Without it, deploy is blocked with a clear message and intent matching falls back to a deterministic keyword-similarity matcher.
   - `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` — enable SMS fallback (already in your `.env`).
   - `SMTP_*` — enable email fallback (already in your `.env`).
   - `<PROVIDER>_CLIENT_ID` / `<PROVIDER>_CLIENT_SECRET` — enable real OAuth per provider. `GOOGLE_*` is already set; `HUBSPOT_*`, `SHOPIFY_*`, `SLACK_*`, `MAILCHIMP_*` light up their "Authorize" buttons the moment you add them — no code change.

---

## 1. WhatsApp AI Agent

A configurable LLM agent that answers inbound WhatsApp messages when no keyword/welcome/OOO rule matched.

- **Config**: name, system prompt, and a knowledge base the agent is told to answer *only* from (so it won't invent prices/policies).
- **Deploy is real and guarded**: it refuses to deploy an empty prompt, and refuses if no LLM provider is configured (instead of the old fake "Deployed!" animation). Deploy stamps `aiAgentDeployedAt` and flips `aiAgentEnabled`.
- **Live test panel**: runs your current prompt + knowledge against the model and renders the reply in a WhatsApp-style bubble — exactly what a customer would receive.
- **Runtime hook**: `webhook.service.js` calls `generateAgentReply()` as the last step of inbound handling, only when the agent is deployed.

Files: `services/aiAgent.service.js`, `controllers/aiAgent.controller.js`, `routes/aiAgent.routes.js`, `pages/AutomationView.jsx` (WhatsApp AI Agent tab).

## 2. AI Intent Matching

Fuzzy-routes an inbound message to the best keyword trigger even without an exact match.

- Uses the LLM as a classifier when available; otherwise a deterministic Jaccard token-overlap + substring scorer, gated by an adjustable **sensitivity threshold** (0.3–0.9). So the toggle always does something real.
- No false positives on unrelated messages (returns null below threshold), verified in the test suite.
- **Runtime hook**: fires in `webhook.service.js` between exact-match triggers and welcome/OOO. Exact matches always win; intent matching only handles the fuzzy cases.

Files: `services/aiAgent.service.js` (`matchIntent`), `pages/AutomationView.jsx` (AI Intent Matching tab). Reply order on inbound: exact trigger → intent match → welcome/OOO → AI agent.

## 3. Campaign Fallback Channels (wizard step 8)

When a WhatsApp send fails for a recipient, the campaign can retry via SMS and/or email.

- Step 8 now shows **only the channels actually configured on your account** (queried from `GET /campaigns/fallback-capabilities`); Voice stays honestly "Coming Soon".
- Per-channel copy (SMS sender + text, email subject + body), `{{1}}`/`{{name}}` substitution for the contact.
- **Runtime**: the campaign worker calls `runFallbackForRecipient()` on send failure. Every attempt — success or failure — is appended to that recipient's `failReason` (e.g. "fallback sent via sms; fallback failed (email: Contact has no email address)"). Nothing is silently swallowed or faked.

Files: `services/fallback.service.js`, `workers/campaign.worker.js`, `services/campaigns.service.js` + `controllers/campaigns.controller.js` + `routes/campaigns.routes.js` (capabilities endpoint + `fallbackConfig` persistence), `validators/index.js`, `pages/CreateCampaign.jsx` (Step 8).

## 4. Per-provider Integration OAuth

A real OAuth 2.0 authorization-code flow for integrations, driven by a provider registry.

- `GET /integrations/oauth/providers` reports which providers exist and whether they're **configured** on this server, so the UI only offers "Authorize" where it will actually work.
- `POST /integrations/oauth/:provider/start` returns a real provider consent URL (with HMAC-signed state binding the callback to the workspace + admin). Unconfigured providers return an honest 400 naming the missing env vars.
- `GET /integrations/oauth/:provider/callback` (public — the browser redirect can't carry a token) verifies the signed state, exchanges the code for tokens server-side, stores them **encrypted at rest**, and redirects back with `?oauth_connected=` or `?oauth_error=`.
- Adding a new provider = adding its client credentials to the environment. Google works end-to-end today; Shopify (needs shop domain), HubSpot, Slack, Mailchimp are wired and light up when their credentials are set.

Files: `lib/oauthProviders.js`, `controllers/integrations.controller.js`, `routes/integrations.routes.js` + `routes/index.js` (public callback mount), `pages/IntegrationsView.jsx` (Authorize flow + callback banner).

---

## Honest degradation (by design)

- No `GEMINI_API_KEY` → agent deploy is blocked with a clear message; intent matching uses the deterministic matcher; test panel says so.
- A provider without credentials → its Authorize returns a 400 naming the env vars to set, rather than a dead button.
- Voice-call fallback → still genuinely unbuilt, still labelled "Coming Soon".

## Testing

`tests-e2e-v3.mjs` boots the app in-process and runs 33 checks across all four features: config CRUD + role gating, deploy refusal without LLM / empty prompt, intent match/no-false-positive/disable, fallback capability reporting + config persistence + honest per-recipient failure recording, OAuth provider listing + real authorize URL + unconfigured-400 + invalid-state callback redirect. Run it against a live Postgres + Redis with `PRISMA_PG_ADAPTER=1`.
