-- WhatsApp opt-out (STOP) enforcement, a complete wallet ledger, per-campaign
-- cost accounting and real in-app notifications.
--
-- Every column added here is nullable or defaulted, and every table is new, so
-- this migration is backward compatible: existing rows keep working untouched
-- and code deployed before it still runs against the new shape.

-- ── Workspace: per-message campaign price ─────────────────────────────────────
ALTER TABLE "Workspace"
  ADD COLUMN "costPerMessage" DECIMAL(10,4) NOT NULL DEFAULT 0.92;

-- ── Contact: when the opt-out happened (the flag itself already existed) ─────
ALTER TABLE "Contact" ADD COLUMN "optedOutAt" TIMESTAMP(3);

-- ── Campaign: skipped counter + wallet accounting ────────────────────────────
ALTER TABLE "Campaign"
  ADD COLUMN "skipped" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "costPerMessage" DECIMAL(10,4),
  ADD COLUMN "totalCost" DECIMAL(12,2),
  ADD COLUMN "walletBefore" DECIMAL(12,2),
  ADD COLUMN "walletAfter" DECIMAL(12,2),
  ADD COLUMN "chargedAt" TIMESTAMP(3),
  ADD COLUMN "refundAmount" DECIMAL(12,2),
  ADD COLUMN "refundedAt" TIMESTAMP(3),
  ADD COLUMN "createdByUserId" TEXT;

-- ── Recipients can now be skipped (opted out) rather than sent or failed ─────
ALTER TYPE "CampaignRecipientStatus" ADD VALUE IF NOT EXISTS 'SKIPPED';

-- ── WalletTransaction: full ledger shape ─────────────────────────────────────
ALTER TABLE "WalletTransaction"
  ADD COLUMN "category" TEXT NOT NULL DEFAULT 'USAGE',
  ADD COLUMN "balanceBefore" DECIMAL(12,2),
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'SUCCESS',
  ADD COLUMN "gateway" TEXT,
  ADD COLUMN "idempotencyKey" TEXT,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Backfill the category of historical rows from the reason text so the new
-- dashboard/report breakdowns include pre-migration transactions.
UPDATE "WalletTransaction" SET "category" = 'RECHARGE' WHERE "type" = 'CREDIT';
UPDATE "WalletTransaction" SET "category" = 'CAMPAIGN'
  WHERE "type" = 'DEBIT' AND "reason" ILIKE '%campaign%';

CREATE UNIQUE INDEX "WalletTransaction_idempotencyKey_key" ON "WalletTransaction"("idempotencyKey");
CREATE INDEX "WalletTransaction_workspaceId_category_idx" ON "WalletTransaction"("workspaceId", "category");

-- ── OptOut (blocked numbers) ─────────────────────────────────────────────────
CREATE TABLE "OptOut" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "rawPhone" TEXT,
    "waNumberId" TEXT,
    "waPhone" TEXT,
    "contactId" TEXT,
    "keyword" TEXT,
    "reason" TEXT NOT NULL DEFAULT 'User Opted Out',
    "source" TEXT NOT NULL DEFAULT 'Incoming WhatsApp Message',
    "blockedByUserId" TEXT,
    "blockedByName" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "unblockedAt" TIMESTAMP(3),
    "unblockedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OptOut_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OptOut_workspaceId_phoneNumber_key" ON "OptOut"("workspaceId", "phoneNumber");
CREATE INDEX "OptOut_workspaceId_active_createdAt_idx" ON "OptOut"("workspaceId", "active", "createdAt");

ALTER TABLE "OptOut" ADD CONSTRAINT "OptOut_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed the blocked list from contacts already flagged as opted out, so the
-- new enforcement honours opt-outs recorded before this migration.
INSERT INTO "OptOut" ("id", "workspaceId", "phoneNumber", "rawPhone", "contactId", "reason", "source", "createdAt", "updatedAt")
SELECT
  'optout_' || c."id",
  c."workspaceId",
  regexp_replace(c."phoneNumber", '[^0-9]', '', 'g'),
  c."phoneNumber",
  c."id",
  'User Opted Out',
  'Migrated from contact opt-out flag',
  COALESCE(c."optedOutAt", c."createdAt"),
  CURRENT_TIMESTAMP
FROM "Contact" c
WHERE c."optedOut" = true
  AND regexp_replace(c."phoneNumber", '[^0-9]', '', 'g') <> ''
ON CONFLICT ("workspaceId", "phoneNumber") DO NOTHING;

-- ── Notifications ────────────────────────────────────────────────────────────
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT,
    "userId" TEXT,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "link" TEXT,
    "meta" JSONB,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");
CREATE INDEX "Notification_workspaceId_createdAt_idx" ON "Notification"("workspaceId", "createdAt");

ALTER TABLE "Notification" ADD CONSTRAINT "Notification_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "NotificationRead" (
    "notificationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationRead_pkey" PRIMARY KEY ("notificationId", "userId")
);

CREATE INDEX "NotificationRead_userId_idx" ON "NotificationRead"("userId");

ALTER TABLE "NotificationRead" ADD CONSTRAINT "NotificationRead_notificationId_fkey"
  FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE CASCADE ON UPDATE CASCADE;
