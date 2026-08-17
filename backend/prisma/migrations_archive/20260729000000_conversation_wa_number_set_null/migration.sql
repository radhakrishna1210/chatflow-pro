-- Chat history outlives the number it ran on. Disconnecting a number used to be
-- blocked by this restrict FK; it now detaches the threads instead.
ALTER TABLE "Conversation" DROP CONSTRAINT "Conversation_waNumberId_fkey";

ALTER TABLE "Conversation" ALTER COLUMN "waNumberId" DROP NOT NULL;

ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_waNumberId_fkey" FOREIGN KEY ("waNumberId") REFERENCES "WaNumber"("id") ON DELETE SET NULL ON UPDATE CASCADE;
