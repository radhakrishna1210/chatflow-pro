-- When a person took a conversation over from the automation.
--
-- Handing off flagged the thread and notified the workspace, then let the next
-- inbound message run the whole automation chain again — keyword triggers,
-- intent routing, the AI agent — so the bot talked over the human who had just
-- picked it up.
ALTER TABLE "Conversation" ADD COLUMN "humanHandoffAt" TIMESTAMP(3);

-- Threads a human is already holding start paused, so the bot does not resume
-- on them the moment this ships.
UPDATE "Conversation" SET "humanHandoffAt" = "lastMessageAt"
WHERE "assignedToUserId" IS NOT NULL AND "status" = 'OPEN';
