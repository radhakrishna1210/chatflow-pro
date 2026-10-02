# ChatFlow Pro — Secrets and configuration

No secret values appear in this document. Every entry records where a credential lives or lived, what kind it is, and what to do about it.

## 1. Secrets found in the repository and its history

| Location | Git commit(s) | Kind | Assessment | Action |
|---|---|---|---|---|
| `backend/.env.test` | Added in 538214e, deleted in 6583e26, still recoverable from history | Test fixture with DB/Redis URLs, JWT access and refresh secrets, `ENCRYPTION_KEY`, Meta app secret and system-user token, Google client id and secret | DB and Redis point at localhost. The JWT, Meta and Google values match placeholder patterns and are far too short to be real. `ENCRYPTION_KEY` is a 32-character opaque value. | Rotate `ENCRYPTION_KEY` only if this value was ever used outside tests. History rewrite is optional. |
| `backend/.env.example` | Added early, deleted in 757dc81 / 11bdd29 | Example file | No live values reported. The file no longer exists, although `backend/README.md` still points to it. | Restore a values-free `.env.example`. See CF-171. |
| `backend/.env.bak` (OPEN_ISSUES OPEN-009) | Not present in any commit on any ref, nor in the worktree | — | The claim of a live credential in this file could not be verified. It is now gitignored. | If the file exists on a developer machine, treat its contents as exposed and rotate. |
| `backend/dump.rdb` | Added in 538214e, still tracked | Redis snapshot | 89 bytes, an empty RDB header with no data. | `git rm`, and add `*.rdb` to `.gitignore`. |
| `backend/test_key_gen.js` | Tracked | Script | Creates a real API key on the first workspace of whatever `DATABASE_URL` is configured and prints the raw key to stdout. | Move it under `scripts/` with a production guard, or delete it. |
| `frontend/src/pages/IntegrationsView.jsx:208` | Tracked | Placeholder text shaped like a Razorpay Key ID | A UI placeholder, not a credential. Key IDs are public anyway. | None. |
| `tests-qa2-automation.mjs:625`, e2e scripts | Tracked | Dummy Gemini key, test passwords | Placeholders only. | None. |

**Rotation verdict.** No live production credential was found in the tree or in git history, so no rotation is required from this audit. The only conditional case is the fixture `ENCRYPTION_KEY`.

## 2. Secrets at rest and in transit inside the running system

| Secret | Where it is stored | Protection | Issue |
|---|---|---|---|
| WhatsApp access tokens, integration tokens, platform credentials | Postgres (`WaNumber`, `WorkspaceIntegration`, `SystemSetting`) | AES-256-CBC via `lib/encryption.js` | No MAC, no key id, no rotation path, and 23 of 24 callers do not handle decrypt failure (CF-104). |
| Refresh tokens | `RefreshToken.token` | Stored in plaintext | A DB read yields live sessions (CF-042). |
| API keys | `ApiKey` | Hashed | Sound. Issuance is not role-gated (CF-025, CF-006). |
| Outgoing webhook signing secret | `Workspace.webhookVerifyToken`, default `""` | HMAC signing key | Workspaces that never set it sign with an empty key (CF-106). |
| Invite tokens, OAuth `code`/`state`, Google exchange code, Meta verify token | Request URLs | Written in full to `backend/server_error.log` by the request logger | CF-100. |
| Platform settings (super-admin screen) | `SystemSetting`, encrypted | Masked on read | Changes are not audited (CF-107), and the mask reveals 8 characters. The override cache is per process (CF-149). |
| User email | Gemini system prompt (Copilot) | — | Unnecessary PII sent to a third party (CF-123). |

## 3. Environment variables

Source: `backend/src/config/env.js` (Zod schema), checked against usage across `backend/src`. "DB-override" means the super admin can replace the key at runtime from the platform settings screen.

| Name | Required? | Default | Used where | Secret? | Notes |
|---|---|---|---|---|---|
| DATABASE_URL | yes | — | lib/prisma.js (forces `connection_limit=3`) | yes | Shared by the Render and VPS stacks (CF-020). The pool is too small (CF-097). |
| DIRECT_URL | no | = DATABASE_URL | Prisma datasource, prisma-cli.js | yes | |
| REDIS_URL | no | redis://localhost:6379 | lib/redis.js | yes, if it embeds a password | Masked in the degraded-start banner. |
| JWT_ACCESS_SECRET, JWT_REFRESH_SECRET | yes (32+ chars) | — | auth | yes | Must match across stacks that share users. |
| JWT_EXPIRES_IN, JWT_REFRESH_EXPIRES_IN | no | 15m / 7d | auth | no | |
| ENCRYPTION_KEY | yes (32+ chars) | — | lib/encryption.js | yes | Rotating it breaks every encrypted row (CF-104). |
| ADMIN_EMAIL | yes | — | super-admin gate | sensitive | |
| BCRYPT_SALT_ROUNDS | no | 12 | auth | no | |
| META_APP_ID, META_APP_SECRET | yes | — | lib/meta.js, webhook HMAC | APP_SECRET yes | DB-override. |
| META_BUSINESS_ID, META_WABA_ID | yes | — | whatsapp.service | no | DB-override. |
| META_SYSTEM_USER_TOKEN | yes | — | Graph API platform calls | yes | DB-override. |
| META_SYSTEM_USER_ID, META_DISPLAY_NAME | yes | — | **never read** | no | Required but unused (CF-059). |
| META_WEBHOOK_VERIFY_TOKEN | yes | — | GET /webhook/meta and /webhook/instagram | yes | Compared with `===` and echoed as HTML (CF-213). |
| META_TWO_STEP_PIN | **not in the schema** | always undefined | whatsapp.service.js:358 | yes | Setting it has no effect (CF-059). |
| META_API_VERSION, META_REDIRECT_URI, META_ES_CONFIG_ID | no | v21.0 / derived / — | Meta, Embedded Signup | no | META_ES_CONFIG_ID is missing from render.yaml. |
| GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET | yes | — | passport-google | CLIENT_SECRET yes | Required even when Google login is unused. |
| GOOGLE_CALLBACK_URL | no | derived | passport | no | A boot warning fires if it is not on the API origin. |
| TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN | no | — | voice, signature validation | AUTH_TOKEN yes | DB-override. |
| RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET | no | — | lib/razorpay.js | KEY_SECRET yes | DB-override. There is no webhook-secret variable because no Razorpay webhook exists (CF-009). |
| GEMINI_API_KEY, GEMINI_MODEL (+ fallback, embedding, image models) | no | `-latest` aliases | lib/llm.js, embeddings | API key yes | DB-override. `-latest` aliases change with Google's releases. |
| OPENAI_API_KEY, CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, IMAGE_PROVIDER | no | — / auto | template image generation | keys yes | DB-override for OpenAI. |
| OLLAMA_URL, OLLAMA_MODEL | no | 127.0.0.1:11434 / phi3 | LLM fallback | no | Harmless connection failure in production. |
| SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASSWORD, SMTP_IP_FAMILY | no | —, 587, false, 4 | email.service | PASSWORD yes | DB-override except SECURE. SMTP_SECURE is missing from render.yaml. The email worker reports success when SMTP is unset (CF-176). |
| EMAIL_FROM, EMAIL_FROM_NAME | no | — / Spandan | email.service | no | DB-override. |
| INSTAGRAM_APP_ID, INSTAGRAM_APP_SECRET, INSTAGRAM_REDIRECT_URI | no | fall back to META_* | instagram.service | secret yes | |
| PORT | no | 4000 | server.js | no | render.yaml sets 10000, and the VPS health URL assumes 4400. |
| NODE_ENV | no | **development** | server.js, errorHandler, redis, prisma | no | A dangerous default: it disables boot migrations, makes Redis give up after the first failure, and exposes error detail (CF-095, CF-177). |
| CLIENT_URL, CORS_EXTRA_ORIGINS, APP_URL, API_PUBLIC_URL | no | localhost values | CORS, email links, OAuth callbacks, widget snippet | no | These should be required in production (CF-148). API_PUBLIC_URL is missing from render.yaml. |
| TRUST_PROXY_HOPS | no | 0 | app.js `trust proxy` | no | **Set nowhere in deploy config**, so all clients share one rate-limit bucket (CF-027). |
| JSON_BODY_LIMIT | no | 2mb | app.js | no | |
| WORKER_DRAIN_DELAY_SEC, WORKER_STALLED_INTERVAL_MS, CAMPAIGN_WORKER_CONCURRENCY, CAMPAIGN_RATE_DELAY_MS | no | 60 / 300000 / 2 / 250 | workers | no | |
| CAMPAIGN_BATCH_SIZE | no | 50 | **never read** | no | CF-059. |
| PRISMA_PG_ADAPTER, RENDER, RUN_DEPLOY_BUILD | not in the schema | — | lib/prisma.js, scripts/render-build.js | no | Undocumented switches. |

## 4. Deployment configuration issues

- **Two production stacks, one database.** The Render and Hostinger VPS deployments point at the same database with separate Redis instances. Each runs boot migrations, the recovery sweeps and the billing and agent workers (CF-020). Pick one stack, or split the databases.
- **Migrations cannot build a fresh database.** No migration creates the core tables. The baseline squash lives only on `origin/aditya-advanced-crm` in commit cc183d8 (CF-019).
- **A failed boot migration is only logged.** The server then serves traffic against an old schema, and `deploy-vps.sh` wrongly states that migrations never run at boot (CF-096).
- **`TRUST_PROXY_HOPS` is missing** from render.yaml, deploy-vps.sh and DEPLOY.md (CF-027).
- **Liveness-only health check.** `/api/v1/health` answers "ok" with the DB or Redis down (CF-203).
- **Node version drift.** `engines` pins `>=22 <23`, README says Node 20+, and this machine runs Node 24 (CF-171).
- **Ephemeral storage.** Render Redis is the `starter` plan with no persistence, and uploads live on ephemeral disk.
- **No `.env.example`** anywhere in the repo (CF-171).
- **Unsafe test targets.** `npm test` and every `scripts/*-check.mjs` write to whatever `DATABASE_URL` the `.env` file holds, because nothing calls the existing `assert-local-db.js` guard (CF-029). `playwright.config.js` defaults `baseURL` to production (CF-114).
- **Stray tracked files:** `backend/dump.rdb`, `qa_testing_2.pdf`, `screenshots/`, `qa-output/`, `frontend/MS_Prompt.md`, `backend/test_key_gen.js`, `backend/check-*.mjs` and the root merge scratch copies (`schema_*.prisma`, `merge_prisma.py`, `val_*.js`, `cfs_*.js`) (CF-209, CF-164). `frontend/dist` is correctly ignored.
