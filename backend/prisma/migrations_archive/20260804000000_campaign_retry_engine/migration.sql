-- Campaign auto-retry engine.
--
-- These columns and the RETRYING enum value were added to schema.prisma by the
-- retry feature but never captured in a migration, so they only existed on
-- databases that had `prisma db push` run against them. Hosted deploys run
-- `prisma migrate deploy` (render.yaml -> start:prod), so on any freshly
-- migrated database every failure path in retry.service.js would throw on the
-- first write and no retry could ever be scheduled.
--
-- Written idempotently (IF NOT EXISTS throughout) so it is a no-op on the
-- databases that already received these changes via db push.

-- ── Campaign: the per-campaign retry policy the wizard saves ────────────────
ALTER TABLE "Campaign"
  ADD COLUMN IF NOT EXISTS "retryConfig" JSONB;

-- ── CampaignRecipient: per-recipient retry bookkeeping ──────────────────────
-- retryCount is NOT NULL DEFAULT 0 so existing rows read as "never retried",
-- which is what calculateNextRetry() expects for a first attempt.
ALTER TABLE "CampaignRecipient"
  ADD COLUMN IF NOT EXISTS "retryCount"        INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "lastRetryAt"       TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "nextRetryAt"       TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lastFailureReason" TEXT,
  ADD COLUMN IF NOT EXISTS "retryStatus"       TEXT;

-- ── A recipient waiting on a scheduled retry is neither sent nor failed ─────
-- Safe inside Prisma's migration transaction: the value is only added here,
-- never read or written in this same migration (PostgreSQL 12+).
ALTER TYPE "CampaignRecipientStatus" ADD VALUE IF NOT EXISTS 'RETRYING';
