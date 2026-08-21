-- A resumable stop for a running campaign. Cancelling was the only way to halt
-- one, and it cannot be undone.
ALTER TYPE "CampaignStatus" ADD VALUE IF NOT EXISTS 'PAUSED';
