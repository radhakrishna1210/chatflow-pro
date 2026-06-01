# Deploying ChatFlow Pro to Render (test environment)

This repo ships a [`render.yaml`](./render.yaml) Blueprint that deploys ChatFlow Pro
as a **single web service**: the Vite frontend is built and served by the Express
backend, so the app, REST API (`/api/v1`), Google OAuth callback, and Meta webhook
all share one origin — `https://<service>.onrender.com`.

- **Postgres** stays on **Supabase** (the blueprint does not create a DB).
- **Redis** for BullMQ is provisioned by the blueprint (Render "Key Value", free plan).

## 1. Push the database schema (once, from your machine)

Render only runs `prisma generate`, never `db push`. Apply the schema to Supabase
yourself using the **session pooler** URL (port 5432):

```bash
cd backend
# uses the DATABASE_URL in backend/.env
npm run db:push
```

## 2. Create the Blueprint on Render

1. Push this branch (`feature/embedded-signup`) to GitHub.
2. Render Dashboard → **New** → **Blueprint** → pick this repo.
3. Render reads `render.yaml`, shows the `chatflow-pro` web service + `chatflow-redis`.
4. It will prompt for every `sync: false` env var — fill them in (see below), then **Apply**.

`REDIS_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` are wired/generated automatically.

## 3. Environment variables to set (`sync: false`)

| Var | Value |
|-----|-------|
| `DATABASE_URL` | Supabase **session pooler** URL: `postgresql://postgres.<ref>:<pw>@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=require` |
| `CLIENT_URL` / `APP_URL` / `CHATFLOW_PRO_URL` | `https://<service>.onrender.com` |
| `GOOGLE_CALLBACK_URL` | `https://<service>.onrender.com/api/v1/auth/google/callback` |
| `ENCRYPTION_KEY` | exactly 32 characters |
| `ADMIN_EMAIL` | seed admin login email |
| `META_*` | App ID, secret, business/WABA/system-user IDs, system-user token, display name, webhook verify token, ES config id, two-step PIN |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | from Google Cloud Console |
| `SMTP_USER` / `SMTP_PASSWORD` / `SMTP_HOST` / `EMAIL_FROM` | email notifications |
| `TWILIO_*` | optional |

> The service URL isn't known until the first deploy. Deploy once, copy the URL,
> then set the four URL vars (and the dashboard redirects/webhook below) and redeploy.

## 4. Update external dashboards with the live URL

- **Google Cloud Console** → Credentials → Authorized redirect URIs:
  add `https://<service>.onrender.com/api/v1/auth/google/callback` (must match `GOOGLE_CALLBACK_URL`).
- **Meta App** → Webhook callback URL:
  `https://<service>.onrender.com/api/v1/webhook` with your `META_WEBHOOK_VERIFY_TOKEN`.
- **Meta App** → Embedded Signup / JS SDK allowed domains: add `https://<service>.onrender.com`,
  and flip the app to **Live**.

## 5. Verify

- `https://<service>.onrender.com/api/v1/health` → `{ "status": "ok" }`
- Root URL loads the SPA; log in with the admin user.

## Notes / caveats (free plan)

- The free web service **spins down when idle** — the first request and any
  in-progress BullMQ workers pause until it wakes. Fine for testing; use a paid
  instance for always-on campaign/email workers.
- Supabase free tier **pauses** after inactivity — unpause it before testing.
- `chatflow-redis` uses `maxmemoryPolicy: noeviction`, required so BullMQ never
  loses queued jobs.
- Schema changes: rerun `npm run db:push` locally (Render won't do it for you).
