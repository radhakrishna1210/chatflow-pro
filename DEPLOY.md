# Deploying Spandan

Spandan ships as **one Node process** that runs the Express API, serves the
built Vite SPA from `frontend/dist`, and (when it owns background work) runs the
BullMQ workers. The frontend calls relative `/api/...` paths, so API and UI are
same-origin — no CORS rewrite rules, no `VITE_API_URL`.

There are two production deployments today, and **they share one Postgres**:

| | Render | Hostinger VPS |
| --- | --- | --- |
| Defined by | [`render.yaml`](render.yaml) (Blueprint) | [`deploy-vps.sh`](deploy-vps.sh) |
| Services | web `chatflow-pro` (rootDir `backend`), Key Value `chatflow-redis` | PM2 app `chatflow-backend` in `/root/apps/chatflow-pro`, `chatflow.mannmate.com` behind the box's reverse proxy, app on `127.0.0.1:4400` |
| Node | `NODE_VERSION=22` | Node 22 at `/root/.nvm/versions/node/v22.23.2/bin` (system Node 18 runs pm2 and other apps) |
| Env | Render dashboard (`sync: false` secrets) | `/root/apps/chatflow-pro/backend/.env` (not in git) |
| Migrations | at boot (`src/server.js`, `NODE_ENV≠development`) | explicitly in `deploy-vps.sh`, then again (no-op) at boot |
| Health check | `/api/v1/health/ready` | `deploy-vps.sh` polls `http://127.0.0.1:4400/api/v1/health/ready` |

Database: Supabase Postgres through the pooler in **session mode (port 5432)**.

> **Upgrading an existing deployment to the audit-remediation release?** Read
> [§4](#4-upgrading-to-the-audit-remediation-release) first — it has ordered,
> one-time steps (migrations, deploying both stacks together, re-encrypting
> secrets, the Razorpay webhook, choosing the worker owner).

---

## 1. Shared rules (both stacks)

### One worker owner per database (`RUN_WORKERS`)

A process with `RUN_WORKERS=true` (the default) starts all nine BullMQ workers
(`campaigns`, `emails`, `billing`, `workflows`, `sequences`, `agent`,
`webhooks`, `outgoing-webhooks`, `crm-maintenance`), registers the repeatable
schedules, re-queues scheduled campaigns, pending retries and stranded
campaigns, upserts the plan catalogue and backfills subscriptions, and runs the
billing-cycle sweep. Two such processes on one database mean double recovery,
double renewal sweeps and double agent ticks — BullMQ's job-id dedupe only works
inside one Redis.

**Decision for the operator:**

1. Pick the stack that owns background work and keep `RUN_WORKERS=true` there.
2. Set `RUN_WORKERS=false` on the other stack — the `RUN_WORKERS` env var in
   `render.yaml`/the Render dashboard, or `RUN_WORKERS=false ./deploy-vps.sh`
   (the script passes it to PM2, overriding `backend/.env`). Both files
   currently default to `true`, so this must be set deliberately.
3. Give **both** stacks the owner's `REDIS_URL`. Jobs the non-owner enqueues
   (campaign launches, invite e-mails, workflow resumes, inbound webhooks)
   otherwise land in a Redis no worker reads. A Render Key Value is private to
   Render by default (`ipAllowList: []`); for the VPS to use it, add the VPS IP
   to its allow-list and use the external (TLS) URL — or host Redis where both
   can reach it.
4. **Meta's webhook callback URL** must point at a deployment whose Redis is
   read by the owner's `webhooks` worker. In production the endpoint verifies
   the signature, enqueues and only then answers 200 (503 if it cannot queue);
   if nothing drains that Redis, inbound messages are never processed.

Simplest of all is to retire one of the two stacks.

### Workers in their own process (optional)

`npm run start:worker` (`src/worker.js`) runs the same boot without an HTTP
listener. To split, run it as a second service (Render *Background Worker* with
the same build and env, or a second PM2 app), set `RUN_WORKERS=false` on the
web service, and keep the same `REDIS_URL` on both.

### Required in production

`src/server.js` refuses to start when `NODE_ENV` is unset, and with
`NODE_ENV=production` it also requires `CLIENT_URL`, `APP_URL` and `REDIS_URL`
to be set explicitly (they no longer fall back to localhost). Production also
exits if Redis is unreachable or a migration fails. Set `TRUST_PROXY_HOPS=1`
(one proxy in front on both stacks) so rate limits see real client IPs.
Every variable is listed in [`backend/.env.example`](backend/.env.example).

### Database pool size (`DATABASE_POOL_SIZE`, default 5)

Every process opens its own Prisma pool of this many connections (an explicit
`connection_limit` in `DATABASE_URL` wins). The sum over all processes on the
database — Render web, VPS, any worker process, migrations — must stay below
the Supabase pooler's limit (15 on the smallest compute). P2024 "Timed out
fetching a new connection" means it is too small; raise it once only one stack
uses the database.

### Health

- `GET /api/v1/health` — liveness, always 200 while the process is up.
- `GET /api/v1/health/ready` — 503 until boot has finished and Postgres and
  Redis answer, with per-check detail. Use this for deploy health checks.

---

## 2. Render

### First-time setup (Blueprint)

1. Push the branch to GitHub. `frontend/dist/` is git-ignored; Render builds it.
2. Generate `ENCRYPTION_KEY` (exactly 32 ASCII or 64 hex chars):
   `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
   `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET` are generated by Render
   (`generateValue: true`).
3. Render Dashboard → **New → Blueprint**, pick the repo and branch. It creates
   `chatflow-redis` (Key Value, `noeviction`) and `chatflow-pro` (web,
   `plan: starter`, `region: singapore`) and prompts for every `sync: false`
   variable:

| Variable | Notes |
| --- | --- |
| `DATABASE_URL` | Supabase → Database → Connection string → **Session mode (5432)** |
| `DIRECT_URL` | Optional in session mode (defaults to `DATABASE_URL`) |
| `CLIENT_URL`, `APP_URL` | The service URL, e.g. `https://chatflow-pro-xxxx.onrender.com` (fix after the first deploy, step 5) |
| `ENCRYPTION_KEY`, `ADMIN_EMAIL` | From step 2; the super-admin login |
| `META_APP_ID`, `META_APP_SECRET`, `META_BUSINESS_ID`, `META_WABA_ID`, `META_SYSTEM_USER_TOKEN`, `META_WEBHOOK_VERIFY_TOKEN` | Meta app / Business Manager. `META_SYSTEM_USER_ID` and `META_DISPLAY_NAME` are optional and unused |
| `META_TWO_STEP_PIN` | Optional 6-digit PIN for numbers that already have two-step verification |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google Cloud Console → Credentials |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | Needed for plan checkout, add-ons and wallet top-ups |
| Optional | `GEMINI_API_KEY`, `OPENAI_API_KEY`, `CLOUDFLARE_*`, `TWILIO_*`, `INSTAGRAM_*`, `SMTP_*`, `EMAIL_FROM` |

   `render.yaml` already sets `NODE_VERSION=22`, `NODE_ENV=production`,
   `PORT=10000`, `TRUST_PROXY_HOPS=1`, `RUN_WORKERS=true` and `REDIS_URL` from
   `chatflow-redis`. **Never** set `ALLOW_DEMO_RECHARGE` (it is ignored in
   production anyway).
4. **Apply.** Build is `npm ci`; the `postinstall` hook
   (`scripts/ensure-prisma-client.js` + `scripts/render-build.js`) generates the
   Prisma client and builds the SPA. Start is `npm run start:prod`
   (`node src/server.js`), which runs `prisma migrate deploy` at boot.
5. Set `CLIENT_URL` and `APP_URL` to the real hostname and redeploy.
   `CLIENT_URL` is the CORS allow-list and post-OAuth redirect target; `APP_URL`
   derives the Google, Meta and Instagram callback URLs (`config/env.js`).
6. Point the providers at the host (§3).

A service created by hand instead of a Blueprint needs: Root Directory
`backend`, Build `npm install` (or `npm ci`), Start `npm run start:prod`,
Health Check Path `/api/v1/health/ready`, a Key Value instance whose internal
URL is `REDIS_URL`, and the variables above.

### Expected boot log

```
[Migration] Running auto-migrations...
[Migration] Auto-migrations completed successfully.
[DB] Connected to PostgreSQL
[Server] Spandan backend running on port 10000
[Init] Ensured plan: FREE / BASIC / GROWTH          (RUN_WORKERS=true only)
[Redis] Connected
[Worker] Campaign worker started                    (… Email, Billing, Workflow,
[Worker] Sequence worker started                     Sequence, Webhook; nine
[Worker] Webhook worker started                      workers in total)
[Server] Ready
```

With `RUN_WORKERS=false` you see `[Worker] RUN_WORKERS=false — workers, schedules,
recovery and sweeps are left to the owning deployment.` instead of the worker
lines. A crash-loop right after `[Migration]` is a failed migration (check the
deploy logs, not the build logs); one after `[Redis]` means Redis is unreachable.

### Render specifics

- **Don't use the free web tier**: it spins down after ~15 idle minutes and
  stops draining the queues. `render.yaml` uses `plan: starter`.
- **Key Value**: keep `noeviction`. A free instance has no persistence and
  expires after 30 days; boot recovery re-queues scheduled/stranded campaigns
  and pending retries from Postgres, but other in-flight jobs are lost on a
  restart. Do not move the queues to a per-request-billed Redis (Upstash): idle
  BullMQ polling exhausted its quota once. Polling is tuned by
  `WORKER_DRAIN_DELAY_SEC` (60) and `WORKER_STALLED_INTERVAL_MS` (5 min).
- **Uploads are ephemeral**: files written to local disk are lost on every
  deploy/restart.
- **Region**: `singapore`; keep the database and service in the same region.

---

## 3. Hostinger VPS

The VPS runs the app under PM2 as `chatflow-backend` from
`/root/apps/chatflow-pro`, listening on `127.0.0.1:4400` behind the box's
reverse proxy for `chatflow.mannmate.com`. Redeploy with:

```bash
ssh root@<vps>
cd /root/apps/chatflow-pro
./deploy-vps.sh                 # current branch
./deploy-vps.sh master          # or a specific branch
RUN_WORKERS=false ./deploy-vps.sh   # if Render owns background work (§1)
```

What the script does, in order:

1. Preflight: Node 22 present, `backend/.env` present (it is never generated —
   create it from `backend/.env.example`), and appends `TRUST_PROXY_HOPS=1` to
   `backend/.env` if missing.
2. `git pull --ff-only` (refuses a dirty tree).
3. `rm -rf frontend/dist`, then `npm ci` in `backend/` with Node 22 and
   `RUN_DEPLOY_BUILD=1`, which generates the Prisma client and rebuilds the SPA.
4. `node scripts/prisma-cli.js migrate deploy` (Node 22).
5. `pm2 restart chatflow-backend --update-env` using **system Node** with
   `NODE_ENV=production` and the chosen `RUN_WORKERS`, then `pm2 save`.
   (Calling pm2 from a Node 22 shell could respawn the daemon and move the
   other PM2 apps on the box to Node 22.)
6. Polls `/api/v1/health/ready` for 90 s and prints the error log on failure.

`backend/.env` on the VPS must contain at least everything marked required in
`backend/.env.example`, plus `CLIENT_URL` and `APP_URL`
(`https://chatflow.mannmate.com`) and `REDIS_URL` — the app no longer starts in
production without them. `NODE_ENV` is pinned by the script, but set
`NODE_ENV=production` in `.env` too so a bare `pm2 restart`/reboot resurrect
behaves the same.

---

## 4. Upgrading to the audit-remediation release

One-time, ordered steps for moving an existing deployment (Render, VPS, or
both) from `master` before the remediation to the `fix/audit-remediation`
release. Do them in this order.

1. **Dependencies.** `multer` moved to `^2.0.2`. Deploys run `npm ci`, which
   installs it; any long-lived checkout that runs the backend (a dev box, or a
   VPS run without `deploy-vps.sh`) needs `cd backend && npm install`.
2. **Prisma client.** The schema changed. `npm ci`/`npm install` regenerate the
   client via `postinstall`; otherwise run `cd backend && npx prisma generate`.
   Code from this release fails on new columns until the client is regenerated.
3. **Migrations** (`node scripts/prisma-cli.js migrate deploy`; Render runs it
   at boot, `deploy-vps.sh` before restart). New in this release:

   | Migration | Effect |
   | --- | --- |
   | `20260101000000_baseline` | Creates the pre-migration schema on an **empty** database. On an existing database the `DO` block sees `"Workspace"` and does nothing; `migrate deploy` just records it. Optionally mark it first: `npx prisma migrate resolve --applied 20260101000000_baseline` |
   | `20261002100000_gateway_payment` | `GatewayPayment` table (each Razorpay payment applied once) |
   | `20261002101000_subscription_billing_cycle` | `Subscription.billingCycle` |
   | `20261002102000_plan_feature_campaign_ai` | Data: adds `campaignAi: true` to paid plans' `features` |
   | `20261002103000_workspace_billing_profile` | `WorkspaceBillingProfile` table |
   | `20261002104000_invoice_amount_decimal_inr` | `Invoice.amount` → `DECIMAL(12,2)`, currency default INR |
   | `20261002110000_refresh_token_hash_family` | Hashed refresh tokens + token families; `RefreshToken.token` nullable |
   | `20261002110100_user_disabled_at` | `User.disabledAt` |
   | `20261002120000_api_key_actor` | `ApiKey.createdByUserId`, `oauthClientId` |
   | `20261002120100_authentication_transaction_created_index` | Index for OTP history |
   | `20261002130000_campaign_quota_reservation` | `Campaign.quotaUnits`, `quotaPeriodStart`, `quotaReleasedAt` |
   | `20261002150000_workflow_run_resume_and_cancel` | `WorkflowRunStatus.CANCELLED`, `WorkflowRun.resumeAt`, `version`, index |
   | `20261002180000_workspace_autonomous_agent_enabled` | `Workspace.autonomousAgentEnabled` (default true) |
   | `20261002190000_fk_actions_and_hot_indexes` | Foreign-key delete/update actions and hot-path indexes |

   Both stacks share the database, so migrations run once; the second stack's
   `migrate deploy` is a no-op.
4. **Deploy Render and the VPS together.** Refresh tokens are now stored
   hashed and rotate with reuse detection. Old code cannot find a hashed token,
   so a stack still on the old release logs out every user whose session was
   refreshed by the new one. Existing plaintext sessions keep working and are
   hashed on first use.
5. **Re-encrypt stored secrets** once the new code is live on every stack:
   ```bash
   cd backend
   node scripts/reencrypt-secrets.js            # dry run: counts only
   node scripts/reencrypt-secrets.js --apply    # rewrites WhatsApp tokens, IG tokens, integration credentials, platform settings to AES-GCM
   ```
   Run it where the production env is loaded (Render shell, or the VPS
   `backend/` directory). Values it reports as unreadable must be reconnected.
6. **Register the Razorpay webhook**: Razorpay Dashboard → Webhooks →
   `https://<api host>/api/v1/webhook/razorpay`, events `payment.captured` and
   `order.paid`, and set the same secret as `RAZORPAY_WEBHOOK_SECRET` on every
   stack. The route answers 503 without it. Never set `ALLOW_DEMO_RECHARGE` in
   production.
7. **Choose the worker owner** (§1): exactly one stack with `RUN_WORKERS=true`,
   the other `false`, both on the same `REDIS_URL`; point Meta's webhook
   callback at a deployment whose Redis the owner's `webhooks` worker reads.
8. **Check the VPS `backend/.env`** has `NODE_ENV=production`, `CLIENT_URL`,
   `APP_URL` and `REDIS_URL` (the server now refuses to start without them),
   and `TRUST_PROXY_HOPS=1` (the script adds it if missing). New optional
   variables: `DATABASE_POOL_SIZE`, `META_TWO_STEP_PIN`,
   `ENCRYPTION_KEYS_PREVIOUS`, `EXPOSE_ERROR_DETAIL` (leave unset on servers).
9. **Render health check path** is now `/api/v1/health/ready` (in
   `render.yaml`; update it by hand on a dashboard-created service).

### User-visible permission changes

Tell workspace owners before the release:

- **ADMIN only** now: API keys (list/create/rotate/revoke; the playground test
  send stays CLIENT), OAuth app connect, outgoing webhook destination and test,
  Authentication-API (OTP) configuration, WhatsApp number connect-own /
  onboard / embedded signup / pool / disconnect, CRM customization, billing
  actions.
- **CLIENT ("Member") can no longer** delete leads (single or bulk) or edit
  lead-distribution rules, and no longer has CRM lead export in the permission
  matrix.
- **Workflows and contact clusters** (create/update/delete) need CLIENT or
  higher; VIEWER and AGENT can only read them.
- **AGENT** may only perform an explicit list of actions: reply and send media
  in conversations, AI reply suggestions/preview, add/delete notes, assign /
  change status / toggle the bot, create and edit contacts, block a number
  (opt-out), and log CRM activities. Unblocking numbers needs CLIENT.
- Impersonation by a super admin now requires a reason, lasts 30 minutes, is
  tab-scoped and cannot create lasting credentials.

---

## 5. Point the providers at the host

- **Google Cloud Console** → OAuth client → Authorized redirect URI:
  `https://<host>/api/v1/auth/google/callback`
- **Meta App Dashboard** → WhatsApp → Configuration → Callback URL
  `https://<host>/api/v1/webhook/meta`, verify token = `META_WEBHOOK_VERIFY_TOKEN`
  (see §1 item 4 for which host).
- **Meta Embedded Signup** redirect URI: `https://<host>/api/v1/auth/meta/callback`
- **Instagram** webhook `https://<host>/api/v1/webhook/instagram`, redirect
  `https://<host>/api/v1/auth/instagram/callback`
- **Twilio** voice webhook `/api/v1/voice/incoming`, status callback
  `/api/v1/voice/status`
- **Razorpay** webhook `/api/v1/webhook/razorpay` (§4 step 6)

## 6. Verify

```bash
curl https://<host>/api/v1/health          # {"status":"ok",...}
curl https://<host>/api/v1/health/ready    # 200 once boot, Postgres and Redis are ok
curl -I https://<host>/dashboard           # 200 text/html (SPA fallback)
curl -I https://<host>/api/v1/nope         # 404 application/json
```

Then sign in, refresh the page and confirm the session persists.

---

## 7. Things that will bite you

- **Supabase pooler mode.** Keep session mode (5432). Transaction mode (6543)
  breaks prepared statements and `migrate deploy`; if you must use it, add
  `?pgbouncer=true&connection_limit=1` and set `DIRECT_URL` to a direct
  connection.
- **Supabase free projects pause** after ~1 week idle; the app then exits on
  boot until it is un-paused.
- **`prisma/manual/`** SQL is not applied automatically and is no longer needed:
  the baseline migration includes it.
- **Never run `prisma migrate dev` or `db push`** against the shared database.
- **`npm start` reads `.env` from the current directory** (via
  `dotenv/config` in `config/env.js`); run it from `backend/`. Render needs no
  `.env` file; `npm run dev` uses `--env-file=.env`.
