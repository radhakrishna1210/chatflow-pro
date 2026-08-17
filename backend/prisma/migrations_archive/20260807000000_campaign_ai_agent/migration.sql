-- Campaign AI Agent: an agent attached to a campaign, activated when the
-- customer taps the campaign's "Ask Anything" CTA, answering from what that
-- campaign actually said.
--
-- Additive and idempotent: every new column is nullable or defaulted, so
-- existing campaigns keep sending exactly as before with the feature off.

ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "aiAgentEnabled"  BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "aiAgentId"       TEXT;
ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "aiAgentCtaLabel" TEXT;
-- Snapshot of the campaign's content at launch. The agent answers from this,
-- never from the live template, so editing a campaign after it went out cannot
-- rewrite history for the customers who already received it.
ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "aiAgentContext"  JSONB;

-- What one contact was actually sent (variables already resolved), written at
-- send time only when the campaign carries an agent.
ALTER TABLE "CampaignRecipient" ADD COLUMN IF NOT EXISTS "aiContext" JSONB;

-- "Which campaign did this customer most recently receive?" — asked on the
-- inbound path when a typed CTA label has to be matched back to a campaign.
CREATE INDEX IF NOT EXISTS "CampaignRecipient_contactId_sentAt_idx"
  ON "CampaignRecipient" ("contactId", "sentAt");

CREATE TABLE IF NOT EXISTS "CampaignAiSession" (
  "id"                  TEXT         NOT NULL,
  "workspaceId"         TEXT         NOT NULL,
  "campaignId"          TEXT         NOT NULL,
  "campaignRecipientId" TEXT,
  "contactId"           TEXT         NOT NULL,
  "conversationId"      TEXT         NOT NULL,
  "agentId"             TEXT,
  "ctaLabel"            TEXT,
  "campaignContext"     JSONB        NOT NULL,
  "status"              TEXT         NOT NULL DEFAULT 'ACTIVE',
  "turns"               INTEGER      NOT NULL DEFAULT 0,
  "activatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastActivityAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt"           TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CampaignAiSession_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CampaignAiSession_conversationId_status_idx" ON "CampaignAiSession" ("conversationId", "status");
CREATE INDEX IF NOT EXISTS "CampaignAiSession_workspaceId_status_idx"    ON "CampaignAiSession" ("workspaceId", "status");
CREATE INDEX IF NOT EXISTS "CampaignAiSession_campaignId_idx"            ON "CampaignAiSession" ("campaignId");

-- Foreign keys are added conditionally so re-running the migration on a
-- database that already has them is a no-op rather than a duplicate-object
-- error (ADD CONSTRAINT has no IF NOT EXISTS in PostgreSQL).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CampaignAiSession_workspaceId_fkey') THEN
    ALTER TABLE "CampaignAiSession" ADD CONSTRAINT "CampaignAiSession_workspaceId_fkey"
      FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CampaignAiSession_campaignId_fkey') THEN
    ALTER TABLE "CampaignAiSession" ADD CONSTRAINT "CampaignAiSession_campaignId_fkey"
      FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CampaignAiSession_contactId_fkey') THEN
    ALTER TABLE "CampaignAiSession" ADD CONSTRAINT "CampaignAiSession_contactId_fkey"
      FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CampaignAiSession_conversationId_fkey') THEN
    ALTER TABLE "CampaignAiSession" ADD CONSTRAINT "CampaignAiSession_conversationId_fkey"
      FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CampaignAiSession_campaignRecipientId_fkey') THEN
    ALTER TABLE "CampaignAiSession" ADD CONSTRAINT "CampaignAiSession_campaignRecipientId_fkey"
      FOREIGN KEY ("campaignRecipientId") REFERENCES "CampaignRecipient"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
