-- Lets a worker claim a recipient atomically before sending, so two concurrent
-- runs of the same campaign batch cannot both send to the same person.
ALTER TYPE "CampaignRecipientStatus" ADD VALUE IF NOT EXISTS 'SENDING';
