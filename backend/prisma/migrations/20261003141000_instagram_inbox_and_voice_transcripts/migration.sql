-- Voice and Instagram inbound automation (CF-224).

-- Transcript of an inbound voice note.
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "transcript" TEXT;

-- Conversations carry their channel; every existing thread is WhatsApp.
DO $$ BEGIN
  CREATE TYPE "ConversationChannel" AS ENUM ('WHATSAPP', 'INSTAGRAM');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "channel" "ConversationChannel" NOT NULL DEFAULT 'WHATSAPP';
CREATE INDEX IF NOT EXISTS "Conversation_workspaceId_channel_idx" ON "Conversation"("workspaceId", "channel");
-- One Instagram thread per contact, so two DMs arriving together cannot each
-- open one (the WhatsApp equivalent is keyed on waNumberId, which is null here).
CREATE UNIQUE INDEX IF NOT EXISTS "Conversation_instagram_contact_key"
  ON "Conversation"("workspaceId", "contactId") WHERE "channel" = 'INSTAGRAM';

-- Contacts reachable on Instagram.
ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "instagramUserId" TEXT;
ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "instagramUsername" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Contact_workspaceId_instagramUserId_key" ON "Contact"("workspaceId", "instagramUserId");
