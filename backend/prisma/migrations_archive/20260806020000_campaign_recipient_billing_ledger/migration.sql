-- Per-recipient billing ledger and retry provenance.
--
-- The recipient, not the send attempt, is the unit of billing: a message that
-- took four attempts to deliver must be charged once, and one that never
-- delivered must be charged nothing. "billedAt" is the idempotency guard —
-- claimed in a conditional UPDATE ... WHERE "billedAt" IS NULL — so duplicate
-- retry jobs, replayed webhooks and worker restarts cannot double-charge.
--
-- Additive and idempotent: every column is nullable, so existing recipient
-- rows stay valid and unbilled history simply reads as "undecided".

ALTER TABLE "CampaignRecipient" ADD COLUMN IF NOT EXISTS "initialStatus"   TEXT;
ALTER TABLE "CampaignRecipient" ADD COLUMN IF NOT EXISTS "retryHistory"    JSONB;
ALTER TABLE "CampaignRecipient" ADD COLUMN IF NOT EXISTS "billedAt"        TIMESTAMP(3);
ALTER TABLE "CampaignRecipient" ADD COLUMN IF NOT EXISTS "billedAmount"    DECIMAL(10,4);
ALTER TABLE "CampaignRecipient" ADD COLUMN IF NOT EXISTS "billingStatus"   TEXT;
ALTER TABLE "CampaignRecipient" ADD COLUMN IF NOT EXISTS "messageCategory" TEXT;

-- Drives the restart-recovery sweep, which looks for RETRYING rows whose
-- nextRetryAt has already passed because their delayed BullMQ job died with
-- Redis (the Render free Key Value plan has no persistence).
CREATE INDEX IF NOT EXISTS "CampaignRecipient_status_nextRetryAt_idx"
  ON "CampaignRecipient" ("status", "nextRetryAt");

-- Backfill: recipients that already reached a terminal delivered state under
-- the old prepaid model were paid for at launch, so they are marked charged at
-- the campaign's own per-message rate. Anything else is explicitly NOT_CHARGED
-- rather than left null, so the settlement arithmetic below has no ambiguity
-- about pre-existing rows.
UPDATE "CampaignRecipient" r
SET "billedAt"      = COALESCE(r."deliveredAt", r."sentAt", c."chargedAt"),
    "billedAmount"  = c."costPerMessage",
    "billingStatus" = 'CHARGED'
FROM "Campaign" c
WHERE r."campaignId" = c.id
  AND r."billedAt" IS NULL
  AND c."chargedAt" IS NOT NULL
  AND r.status IN ('SENT', 'DELIVERED', 'READ');

UPDATE "CampaignRecipient"
SET "billingStatus" = 'NOT_CHARGED'
WHERE "billingStatus" IS NULL
  AND status IN ('FAILED', 'SKIPPED');
