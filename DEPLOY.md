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
| `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_PREFIX` | File storage bucket — needed on Render, whose disk is wiped on every deploy (§4 step 10) |
| Optional | `GEMINI_API_KEY` (also voice-note transcription), `OPENAI_API_KEY`, `CLOUDFLARE_*`, `TWILIO_*`, `INSTAGRAM_*`, `SMTP_*`, `EMAIL_FROM` |

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
- **Use a bucket for files**: Render's disk is wiped on every deploy and
  restart. Without `S3_BUCKET` the app keeps archived WhatsApp/Instagram media
  on that disk (and logs a loud `[Storage] WARNING` at boot); template header
  images stay in Postgres. Set the `S3_*` variables (§4 step 10).
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
   The frontend build moved to **Vite 7** (`vite ^7.3.6`,
   `@vitejs/plugin-react ^5.2.0`), which needs **Node >= 22.12** (or 20.19+;
   `frontend/package.json` engines now say `>=22.12 <23`). Render's
   `NODE_VERSION=22` and the VPS Node 22.23 both qualify; a box on an older
   22.x must upgrade Node before `npm ci && npm run build` in `frontend/`.
   No config changes are needed beyond reinstalling `frontend/node_modules`.
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
   | `20261003100000_workspace_addon_stacking_auto_renew` | Drops the one-row-per-add-on unique index (packs stack, one row per pack); `WorkspaceAddon.autoRenew`, `renewedAt`, `expiredAt`; indexes |
   | `20261003101000_plan_feature_fallback_voice` | Data: adds `fallback: true` and `voice: true` to every plan's `features` (values already set are kept) |
   | `20261003110000_workspace_default_phone_country` | `Workspace.defaultPhoneCountry` (default `IN`): the code added to contact numbers typed without one |
   | `20261003111000_contact_opt_in` | `Contact.optInAt` / `optInSource` / `optInText` / `optInIpHash`; backfilled from past consented lead-form submissions (opted-out contacts untouched) |
   | `20261003120000_oauth_pkce` | OAuth provider PKCE: `OAuthClient.publicClient`, nullable `clientSecretHash` (CHECK: public or has a secret), `OAuthAuthorizationCode.codeChallenge`/`codeChallengeMethod`. Existing clients stay confidential; no action needed |
   | `20261003130000_plan_feature_autonomous_agent` | Data: adds `autonomousAgent: true` to paid plans' `features`. Free-plan workspaces are no longer swept by the autonomous CRM agent |
   | `20261003140000_object_storage_keys` | `TemplateAsset.bytes` nullable + `storageKey`; `Message.mediaStorageKey`, `mediaSize` |
   | `20261003141000_instagram_inbox_and_voice_transcripts` | `Message.transcript`; `Conversation.channel` (enum, default WHATSAPP) + one-Instagram-thread-per-contact partial unique index; `Contact.instagramUserId`/`instagramUsername` (unique per workspace) |

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
10. **Live updates (Server-Sent Events).** The inbox, campaign and template
    screens now get pushed updates from
    `GET /api/v1/workspaces/:id/realtime/stream` and poll only while that
    stream is down. Nothing is required to turn it on, but check:
    - **Redis carries the events between processes** (pub/sub channel
      `chatflow:realtime:v1` on `REDIS_URL`). Every process that writes
      (web, `start:worker`, and both stacks if both serve users) must share
      one `REDIS_URL` — the same rule as §1. Each web process opens one extra
      Redis connection when its first stream opens, and every event is one
      `PUBLISH`. Without Redis, events reach only browsers connected to the
      process that made the change; screens then fall back to polling
      (inbox list 30 s, thread 15 s, campaigns 30 s, templates 30–120 s).
    - **VPS reverse proxy** (its config is not in this repo, and
      `deploy-vps.sh` does not touch it). The app sends `X-Accel-Buffering: no` and
      `Cache-Control: no-cache, no-transform`, plus a heartbeat comment
      every 25 s, which keeps nginx's default `proxy_read_timeout` of 60 s
      from cutting the stream. It is still safer to state this explicitly,
      inside the `chatflow.mannmate.com` server block, before the general
      `location /`:
      ```nginx
      location ~ ^/api/v1/workspaces/[^/]+/realtime/stream$ {
          proxy_pass http://127.0.0.1:4400;
          proxy_http_version 1.1;
          proxy_set_header Connection "";
          proxy_set_header Host $host;
          proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
          proxy_set_header X-Forwarded-Proto $scheme;
          proxy_buffering off;
          proxy_cache off;
          gzip off;
          proxy_read_timeout 1h;
          access_log off;   # the one-minute stream token is in the query string
      }
      ```
      Then `nginx -t && systemctl reload nginx`. Serve the site over HTTP/2
      (`listen 443 ssl http2;`); over HTTP/1.1 each open stream takes one of
      the browser's six connections per host. Another proxy (Caddy, Apache)
      needs the same: no response buffering, no compression on this path, a
      read timeout above 25 s. Render needs nothing.
    - **Optional variables** (`backend/.env.example`):
      `REALTIME_ENABLED=false` turns the stream off everywhere (screens poll,
      the token route answers 503); `REALTIME_MAX_STREAMS_PER_USER`
      (default 5, per web process — a sixth closes that user's oldest);
      `REALTIME_HEARTBEAT_MS` (default 25000; keep it below every proxy's
      idle timeout).
    - **Deploys and restarts** close every stream with a `reconnect` event;
      browsers come back within about a second with a fresh token and
      refetch what they show. A stream also ends after 15 minutes, which is
      what bounds how long a removed member or revoked session keeps
      receiving events. Events carry ids and statuses only, never message
      text or phone numbers.
11. **File storage (CF-165).** Media and template images go through
    `src/lib/storage`: an S3-compatible bucket when `S3_BUCKET` is set, local
    disk (`STORAGE_DISK_ROOT`, default `backend/uploads`) otherwise.
    - **Render: configure a bucket.** Create a *private* bucket on AWS S3,
      Cloudflare R2 (`S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com`,
      `S3_REGION=auto`), Supabase Storage (`S3_ENDPOINT=https://<project-ref>.supabase.co/storage/v1/s3`,
      `S3_REGION=<project region>`, keys from Project Settings → Storage → S3
      access keys) or MinIO, with an access key limited to that bucket
      (GetObject, PutObject, DeleteObject; HeadObject is GetObject). Set
      `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` and the endpoint /
      region on **every** stack (they share one database, so a key written by one
      must be readable by the other). `S3_PREFIX` (e.g. `prod`) lets stacks or
      environments share a bucket. No CORS is needed: the app streams files.
    - **Boot log** says `[Storage] Files are stored in s3 bucket "…"`. A bucket
      with missing credentials stops a production boot; the disk driver on
      Render boots with a `[Storage] WARNING … WIPED on every deploy` banner.
    - **Move existing files** (idempotent; re-run any time):
      ```bash
      cd backend
      node scripts/migrate-uploads-to-object-storage.js                  # dry run
      node scripts/migrate-uploads-to-object-storage.js --apply          # copy disk files + TemplateAsset bytes
      node scripts/migrate-uploads-to-object-storage.js --apply --purge-db-bytes   # later: drop the Postgres copies
      ```
      Run it where the old files are (the VPS `backend/` directory; Render's
      disk has nothing worth copying) with the `S3_*` variables set. To switch
      with no gap: set the `S3_*` variables plus `STORAGE_DRIVER=disk`, run
      `--apply`, remove `STORAGE_DRIVER` and redeploy both stacks, then run
      `--apply` once more for files written in between. Template images
      already in Postgres keep working without the script; it only moves them.
    - **VPS without a bucket** keeps `backend/uploads/` (git-ignored, survives
      `deploy-vps.sh`); back it up with the server, or point
      `STORAGE_DISK_ROOT` outside the checkout.
12. **Voice notes and Instagram DMs (CF-224).**
    - With `GEMINI_API_KEY` set, inbound voice notes are transcribed and run
      through opt-out, workflows, keyword triggers, intents and the AI agent
      like text; the transcript is the message body (`Message.transcript`
      marks it). `VOICE_TRANSCRIPTION=false` turns it off. Without a
      transcript a voice note is an audio message: only a workflow with the new
      **Media Received** trigger answers it. Note a transcribed "stop" opts the
      number out, as typed text does.
    - Instagram DMs now land in the inbox (Instagram badge) and run Quickflows,
      workflows, triggers, welcome/out-of-office and the AI agent. Replies are
      metered like automated WhatsApp replies and refused outside Instagram's
      24-hour window; templates and attachments are WhatsApp-only. Sends now go
      to `graph.instagram.com`; **reconnect Instagram** on each workspace
      (Automation → Instagram) so the stored account id is the one webhooks
      use (`/me` `user_id`) — a workspace whose DMs log `No workspace connected
      for IG user …` needs this. The Meta app must have the
      `instagram_business_manage_messages` permission and the Instagram
      webhook subscribed to `messages` (and `comments` for comment flows).
13. **Normalise existing contact numbers** (CF-200) once the new code is live.
    New writes are E.164 (`+919876543210`); older rows keep whatever spelling
    they were saved with until this runs. Set each non-Indian workspace's
    *Default phone country* (Settings -> Workspace) first, since numbers
    without a country code take it.
    ```bash
    cd backend
    node scripts/backfill-contact-phones.js                          # dry run: report only
    node scripts/backfill-contact-phones.js --report phones.json     # same, plus a JSON report
    node scripts/backfill-contact-phones.js --apply                  # rewrite (one workspace: --workspace <id>)
    ```
    Contacts that collapse onto the same number (one person saved as
    `9876543210` and `+91 98765 43210`) are listed as `DUPLICATE` and left
    untouched, as are numbers that cannot be a phone number (`INVALID`):
    merge or fix those by hand, then re-run (it is idempotent). Until then
    lookups still match the legacy spellings, so no new duplicates appear.

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
- **Autonomous CRM agent** is a paid-plan feature (`autonomousAgent`): on the
  Free plan it books and changes nothing, and switching it on, running it or
  retrying a task answers `PLAN_FEATURE_LOCKED`. Its queue view
  (`/ai-agents/autonomous/pending`, alias `/agent/pending`) is ADMIN only.
- **AI Agents** is one sidebar entry (WhatsApp agent, agent studio, autonomous
  agent); the canonical API is `/ai-agents`, `/ai-agents/whatsapp`,
  `/ai-agents/autonomous`. The old `/ai-agent/*` and `/agent/*` paths keep
  working.
- Impersonation by a super admin now requires a reason, lasts 30 minutes, is
  tab-scoped and cannot create lasting credentials.
- **Customize Your Business lead rules are enforced** (CF-154). Creating or
  editing a lead (CRM, bulk status, AI/copilot actions) with a stage outside
  the Lead Lifecycle, an unknown or disabled Lead Source, a tag not listed
  under Lead Tags, or without a field Prospecting Criteria requires is now a
  400. Web forms, CSV import and campaign-reply leads are adjusted instead
  (default stage, a configured fallback source with the original kept as
  detail, unlisted tags dropped, "not qualified" when a required detail is
  missing) and the import lists every adjustment. A lead form's source must
  be a configured source. Workspaces relying on free-form tags or sources
  should add them under Customize Your Business first.
- **Sequence enrolment honours record visibility** (CF-162): under OWN/TEAM
  a member cannot enrol leads they cannot see; they come back as skipped.

### Billing and campaign changes (CF-030, CF-051, CF-056, CF-206, CF-099)

- **Add-on renewal** needs no new cron: `runAddonRenewalSweep()` runs inside
  the existing daily `billing` job (02:00) and once at boot on the stack with
  `RUN_WORKERS=true`. Auto-renew is opt-in per add-on, so nothing is charged
  until a workspace turns it on; packs without it are marked EXPIRED (with a
  notification) at the first sweep after they end.
- **Campaign SMS fallback now needs DLT ids.** A campaign whose fallback has
  SMS on but no `dltTemplateId`/`dltEntityId` keeps running, but its fallback
  SMS is skipped (recorded on the recipient, not charged) until the ids are
  added in the wizard. The DLT templates and the sender header must also be
  registered with Twilio for India delivery; Twilio matches by sender and body.
- **Plan feature flags** `fallback` and `voice` are new and on every plan (the
  migration above). Unticking them in the admin Plans tab now really turns the
  feature off. `campaignAi` is now also checked at runtime: a workspace whose
  plan lacks it gets no agent replies, campaign agent sessions or intent
  routing.
- **Campaign pricing** uses the plan's per-category rates (Free's 2x overrides
  now apply to campaigns as they already did to inbox sends), and an
  unrecognised template category is priced as MARKETING everywhere.
- **Redeploys during a campaign**: on SIGTERM the send loop stops after the
  message in flight and queues a `resume-<campaignId>-<ts>` job for the next
  worker, so the 25 s shutdown budget is no longer exceeded by long campaigns.

### List limits and template media

- **Bounded lists.** The leads, tickets, quotes, products, invoices and support
  ticket lists return at most 500 rows by default (`?limit=` up to 1000,
  `?offset=`); `{data, total}` responses also report `limit`/`offset`, so a
  client can tell it got a page. Super-admin workspace lists default to 1000
  (max 5000). An inbox thread returns its newest 500 messages (`?limit=` up
  to 2000) with `hasMore`, and `?before=<message id>` reads the page older
  than that message. The contacts export is no longer
  capped at 50,000 rows (it streams; `X-Export-Truncated` is never sent), and
  the blocked-numbers export includes every row, not just the first 200.
- **The screens now page.** Leads, tickets, quotes and products show 100 rows
  a page with Previous/Next and the real total; invoices, support requests
  and the super-admin workspace table have "Load more"; the inbox and the CRM
  Sales Inbox thread have "Load earlier messages"; the Sales Inbox lead list
  has "Load more leads". Lead, product and workspace pickers search on the
  server (`/admin/workspaces` takes `?search=`), the super-admin analytics
  totals and workspace dropdowns read every page, and a leads "select all"
  covers the page on screen and says so. No workspace silently stops at the
  first page any more.
- **Template media** is resolved only inside the sending workspace. A
  template whose carousel card or header names an image another workspace
  owns, or one since deleted, now fails to send with
  `TEMPLATE_MEDIA_UNAVAILABLE`. Re-uploading the image in the template editor
  fixes it.
- **OAuth provider PKCE.** Nothing changes for the existing (confidential)
  Spandan client. A public client registered with `publicClient: true` in
  `seedOAuthClients.js` must use PKCE (S256); see `backend/docs/PUBLIC_API.md`.

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
