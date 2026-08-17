# Archived migrations (pre-baseline)

These 32 migrations were the history up to 17 August 2026. They are kept for
reference and are **no longer applied by `prisma migrate deploy`** — the active
history is a single `00000000000000_baseline`.

## Why they were replaced

The history could not be replayed onto an empty database. The first migration,
`20260717073845_add_subscription_models`, alters `Workspace` — and nothing in
the history ever creates it. The original schema was made with `db push` before
migrations were introduced, so the history never had a starting point.

Reproduced against an empty local database:

```
Applying migration `20260717073845_add_subscription_models`
Error: P3018
Database error code: 42P01
ERROR: relation "Workspace" does not exist
```

The practical consequence: a new environment could not be built from the repo.
Every deployment depended on a database that already existed.

## What replaced them

`prisma/migrations/00000000000000_baseline/migration.sql`, generated with

```bash
prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script
```

Verified on a scratch database: applies cleanly from empty, and

```
prisma migrate diff --from-url <scratch> --to-schema-datamodel prisma/schema.prisma --exit-code
→ No difference detected.  (exit 0)
```

## Applying this to an existing database

An existing database already has the schema, so the baseline must be recorded
as applied rather than run — running it would fail on objects that exist.

```bash
prisma migrate resolve --applied 00000000000000_baseline
```

Done for the local development database. **Not done for the hosted database**,
for two reasons:

1. This branch is under a standing instruction to touch only a local Postgres.
   `scripts/assert-local-db.js` enforces it and will abort on a remote host.
2. OPEN-002 is unresolved — the hosted schema has drifted from the datamodel.
   Marking the baseline applied there would freeze that drift in place and
   present it as correct.

**Order of operations when you do it:** resolve OPEN-002 first (pull the hosted
schema, diff it against `schema.prisma`, hand-write a corrective migration and
apply it), confirm `migrate diff --exit-code` reports no difference against the
hosted database, and only then mark the baseline applied there.
