-- WF-IN-1: why automation is paused on a conversation (human handoff).
-- Null for existing handoffs; the reason is inferred for those, and every
-- handoff now lapses after HANDOFF_TTL_HOURS without a person replying.
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "handoffReason" TEXT;
