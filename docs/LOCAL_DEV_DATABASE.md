# Local development database

This branch runs against a **local PostgreSQL only**. It must never connect to
Supabase or any shared/production database.

## Why this exists

A stale credential in `backend/.env.bak` pointed at a shared Supabase instance
holding real customer workspaces (`Labhesh Pahade's Workspace`,
`Radhakrishna Thete's Workspace`, and others). Restoring `.env` from that file
connected to it. Only reads were issued and the config was reverted
immediately, but the incident is the reason for the guard below.

## The guard — run before every database operation

`backend/scripts/assert-local-db.js` refuses to proceed unless `DATABASE_URL`
is local. It rejects on two independent grounds: a hostname that is not
loopback, and any managed-provider marker anywhere in the URL (`supabase`,
`neon.tech`, `amazonaws.com`, `rds.`, `render.com`, `railway.app`, and others).

```bash
node --env-file=.env scripts/assert-local-db.js
```

Chain it ahead of anything destructive:

```bash
node --env-file=.env scripts/assert-local-db.js && npx prisma db push
```

Verified behaviour:

```
local config     -> [db-guard] OK — local database confirmed: chatflow@127.0.0.1:5433/chatflow_dev
supabase URL     -> [db-guard] BLOCKED — points at a managed provider ("supabase")   exit 1
db.example.com   -> [db-guard] BLOCKED — host is "db.example.com", which is not local  exit 1
```

## Setup

PostgreSQL is not installed on this machine; Docker is. The database runs as a
container bound to loopback only — `127.0.0.1:5433`, not `0.0.0.0`, so it is
not reachable from the network.

```bash
docker run -d --name chatflow-local-pg \
  -e POSTGRES_USER=chatflow \
  -e POSTGRES_PASSWORD=chatflow_local_dev \
  -e POSTGRES_DB=chatflow_dev \
  -p 127.0.0.1:5433:5432 \
  -v chatflow-local-pgdata:/var/lib/postgresql/data \
  postgres:16-alpine
```

`backend/.env`:

```
DATABASE_URL=postgresql://chatflow:chatflow_local_dev@127.0.0.1:5433/chatflow_dev?schema=public
DIRECT_URL=postgresql://chatflow:chatflow_local_dev@127.0.0.1:5433/chatflow_dev?schema=public
```

These credentials are deliberately throwaway and local-only.

## Schema: use `db push`, not `migrate deploy`

`npx prisma migrate deploy` **fails on a fresh database** — confirmed:

```
Applying migration `20260717073845_add_subscription_models`
Error: P3018   ERROR: relation "Workspace" does not exist
```

The migration history has no baseline creating the core tables, so it can only
be replayed against a database that already has them. This is OPEN-001, now
reproduced from scratch rather than inferred.

The repo already expects this — `src/server.js` logs
*"Skipped migrate deploy in development (use db push)"*. So:

```bash
node --env-file=.env scripts/assert-local-db.js && npx prisma db push
```

Result: 55 tables, including all 15 belonging to this branch —
`Lead`, `Deal`, `DealStageHistory`, `Task`, `CrmActivity`, `SavedView`,
`PipelineStage`, `CustomFieldDefinition`, `Product`, `DealLineItem`, `Quote`,
`QuoteLineItem`, `Sequence`, `SequenceEnrollment`, `SequenceStepRun`.

## Seeding

```bash
node --env-file=.env scripts/seed-plans.js        # FREE / BASIC / GROWTH
node --env-file=.env scripts/create-test-user.js  # test@example.com / password123
node --env-file=.env scripts/seed-crm.js          # contacts, leads, deals, tasks
```

`seed-crm.js` seeds every workspace it finds, so run `create-test-user.js`
first or it has nothing to seed.

## Resetting

```bash
node --env-file=.env scripts/assert-local-db.js \
  && docker exec chatflow-local-pg psql -U chatflow -d chatflow_dev \
       -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;" \
  && npx prisma db push
```

## Verified state

- `npm test` — **153/153 passing** against the local database
- Backend boots with all five workers started
- CRM workflow triggers verified end-to-end over HTTP against local data

## A note on timing

The first CRM event after a cold start can take longer than a second to
process: `emitCrmEvent` is fire-and-forget and lazily imports the workflow
engine on first use. A test that asserts within ~1s of the very first event may
see nothing and wrongly conclude the feature is broken — allow ~2.5s, or warm
the path first. Subsequent events complete well under a second.
