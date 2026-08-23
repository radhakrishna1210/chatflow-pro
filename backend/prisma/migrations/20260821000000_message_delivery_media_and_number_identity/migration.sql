-- Inbound message identity, delivery state, media, and WhatsApp number identity.
--
-- The two unique constraints below cannot simply be added: the data they
-- describe is already violating them, which is the whole point. Both are
-- de-duplicated first, keeping the earliest row in each group.

-- ─── Message: type + delivery status ────────────────────────────────────────
CREATE TYPE "MessageType" AS ENUM (
  'TEXT', 'IMAGE', 'VIDEO', 'AUDIO', 'DOCUMENT', 'STICKER', 'LOCATION',
  'CONTACTS', 'INTERACTIVE', 'BUTTON', 'TEMPLATE', 'SYSTEM', 'UNSUPPORTED'
);
CREATE TYPE "MessageStatus" AS ENUM ('PENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED');

ALTER TABLE "Message"
  ADD COLUMN "type"          "MessageType"   NOT NULL DEFAULT 'TEXT',
  ADD COLUMN "status"        "MessageStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "statusAt"      TIMESTAMP(3),
  ADD COLUMN "errorCode"     INTEGER,
  ADD COLUMN "errorMessage"  TEXT,
  ADD COLUMN "mediaId"       TEXT,
  ADD COLUMN "mediaUrl"      TEXT,
  ADD COLUMN "mediaMimeType" TEXT,
  ADD COLUMN "mediaFilename" TEXT,
  ADD COLUMN "mediaSha256"   TEXT,
  ADD COLUMN "locationLat"   DOUBLE PRECISION,
  ADD COLUMN "locationLng"   DOUBLE PRECISION,
  ADD COLUMN "locationName"  TEXT;

-- Existing rows predate status tracking. An inbound message was received by
-- definition, and an outbound one at least reached Meta (it has a wamid), so
-- SENT is the honest floor for both — never DELIVERED, which we cannot know.
UPDATE "Message" SET "status" = 'SENT' WHERE "metaMessageId" IS NOT NULL;

-- Campaign recipients already carry the delivery facts Meta reported, so the
-- messages linked to them can be back-filled truthfully rather than guessed.
UPDATE "Message" m SET "status" = 'DELIVERED', "statusAt" = r."deliveredAt"
  FROM "CampaignRecipient" r
  WHERE m."campaignRecipientId" = r."id" AND r."deliveredAt" IS NOT NULL AND r."readAt" IS NULL;
UPDATE "Message" m SET "status" = 'READ', "statusAt" = r."readAt"
  FROM "CampaignRecipient" r
  WHERE m."campaignRecipientId" = r."id" AND r."readAt" IS NOT NULL;
UPDATE "Message" m SET "status" = 'FAILED', "statusAt" = r."failedAt", "errorMessage" = r."failReason"
  FROM "CampaignRecipient" r
  WHERE m."campaignRecipientId" = r."id" AND r."failedAt" IS NOT NULL;

-- ─── Message.metaMessageId: de-duplicate, then enforce ──────────────────────
-- Meta retries a webhook until it receives a 200 and nothing de-duplicated on
-- this id, so retried deliveries were written repeatedly (rows existed with
-- four copies of one wamid). Keep the earliest of each group.
DELETE FROM "Message" m
USING (
  SELECT "id",
         ROW_NUMBER() OVER (PARTITION BY "metaMessageId" ORDER BY "createdAt" ASC, "id" ASC) AS rn
  FROM "Message"
  WHERE "metaMessageId" IS NOT NULL
) dup
WHERE m."id" = dup."id" AND dup.rn > 1;

DROP INDEX IF EXISTS "Message_metaMessageId_idx";
CREATE UNIQUE INDEX "Message_metaMessageId_key" ON "Message"("metaMessageId");
CREATE INDEX "Message_conversationId_sentAt_idx" ON "Message"("conversationId", "sentAt");
CREATE INDEX "Message_status_idx" ON "Message"("status");

-- ─── Conversation: the 24-hour customer service window ──────────────────────
ALTER TABLE "Conversation" ADD COLUMN "lastInboundAt" TIMESTAMP(3);

-- Seed from the newest inbound message on each thread, so the window is
-- accurate for existing conversations rather than starting empty (which would
-- have made every open thread look closed).
UPDATE "Conversation" c SET "lastInboundAt" = latest.max_sent
FROM (
  SELECT "conversationId", MAX("sentAt") AS max_sent
  FROM "Message" WHERE "direction" = 'INBOUND' GROUP BY "conversationId"
) latest
WHERE c."id" = latest."conversationId";

-- ─── WaNumber: verification state + one row per number per workspace ────────
ALTER TABLE "WaNumber"
  ADD COLUMN "codeVerificationStatus" TEXT,
  ADD COLUMN "lastVerifiedAt"         TIMESTAMP(3),
  ADD COLUMN "unreachableSince"       TIMESTAMP(3),
  ADD COLUMN "unreachableReason"      TEXT;

-- A double-clicked "connect" wrote the same number several times over. Only
-- rows with no campaigns, conversations, templates or widgets are removed —
-- anything carrying history is left in place for a human to resolve rather
-- than silently deleted along with what depends on it.
DELETE FROM "WaNumber" w
USING (
  SELECT "id",
         ROW_NUMBER() OVER (PARTITION BY "workspaceId", "metaPhoneNumberId" ORDER BY "createdAt" ASC, "id" ASC) AS rn
  FROM "WaNumber"
) dup
WHERE w."id" = dup."id"
  AND dup.rn > 1
  AND NOT EXISTS (SELECT 1 FROM "Campaign"     x WHERE x."waNumberId" = w."id")
  AND NOT EXISTS (SELECT 1 FROM "Conversation" x WHERE x."waNumberId" = w."id")
  AND NOT EXISTS (SELECT 1 FROM "Template"     x WHERE x."waNumberId" = w."id")
  AND NOT EXISTS (SELECT 1 FROM "Widget"       x WHERE x."waNumberId" = w."id");

CREATE UNIQUE INDEX "WaNumber_workspaceId_metaPhoneNumberId_key"
  ON "WaNumber"("workspaceId", "metaPhoneNumberId");
