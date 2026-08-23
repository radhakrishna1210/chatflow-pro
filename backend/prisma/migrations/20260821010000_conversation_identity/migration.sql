-- One conversation per (workspace, contact, number).
--
-- Nothing enforced this, and the inbound handler's "find, else create" has a
-- window in it: Meta delivers a burst of messages together and answers each
-- webhook independently, so two deliveries for a brand-new contact could both
-- miss the lookup and both insert. The result is a split thread — half the
-- customer's history in one conversation, half in another, and the inbox
-- showing whichever the query happened to pick.

-- Merge first: dependents move to the earliest conversation of each group.
WITH ranked AS (
  SELECT "id", "workspaceId", "contactId", "waNumberId",
         FIRST_VALUE("id") OVER (
           PARTITION BY "workspaceId", "contactId", "waNumberId"
           ORDER BY "createdAt" ASC, "id" ASC
         ) AS keep_id
  FROM "Conversation"
  WHERE "waNumberId" IS NOT NULL
),
moves AS (SELECT "id" AS from_id, keep_id FROM ranked WHERE "id" <> keep_id)
UPDATE "Message" m SET "conversationId" = moves.keep_id
FROM moves WHERE m."conversationId" = moves.from_id;

WITH ranked AS (
  SELECT "id",
         FIRST_VALUE("id") OVER (
           PARTITION BY "workspaceId", "contactId", "waNumberId"
           ORDER BY "createdAt" ASC, "id" ASC
         ) AS keep_id
  FROM "Conversation" WHERE "waNumberId" IS NOT NULL
),
moves AS (SELECT "id" AS from_id, keep_id FROM ranked WHERE "id" <> keep_id)
UPDATE "ConversationNote" n SET "conversationId" = moves.keep_id
FROM moves WHERE n."conversationId" = moves.from_id;

WITH ranked AS (
  SELECT "id",
         FIRST_VALUE("id") OVER (
           PARTITION BY "workspaceId", "contactId", "waNumberId"
           ORDER BY "createdAt" ASC, "id" ASC
         ) AS keep_id
  FROM "Conversation" WHERE "waNumberId" IS NOT NULL
),
moves AS (SELECT "id" AS from_id, keep_id FROM ranked WHERE "id" <> keep_id)
UPDATE "WorkflowRun" w SET "conversationId" = moves.keep_id
FROM moves WHERE w."conversationId" = moves.from_id;

WITH ranked AS (
  SELECT "id",
         FIRST_VALUE("id") OVER (
           PARTITION BY "workspaceId", "contactId", "waNumberId"
           ORDER BY "createdAt" ASC, "id" ASC
         ) AS keep_id
  FROM "Conversation" WHERE "waNumberId" IS NOT NULL
),
moves AS (SELECT "id" AS from_id, keep_id FROM ranked WHERE "id" <> keep_id)
UPDATE "CampaignAiSession" s SET "conversationId" = moves.keep_id
FROM moves WHERE s."conversationId" = moves.from_id;

-- Carry the surviving row's window forward, then drop the emptied duplicates.
WITH ranked AS (
  SELECT "id", "lastMessageAt", "lastInboundAt", "unreadCount",
         FIRST_VALUE("id") OVER (
           PARTITION BY "workspaceId", "contactId", "waNumberId"
           ORDER BY "createdAt" ASC, "id" ASC
         ) AS keep_id
  FROM "Conversation" WHERE "waNumberId" IS NOT NULL
),
agg AS (
  SELECT keep_id,
         MAX("lastMessageAt") AS last_message,
         MAX("lastInboundAt") AS last_inbound,
         SUM("unreadCount")   AS unread
  FROM ranked GROUP BY keep_id HAVING COUNT(*) > 1
)
UPDATE "Conversation" c
SET "lastMessageAt" = GREATEST(c."lastMessageAt", agg.last_message),
    "lastInboundAt" = GREATEST(COALESCE(c."lastInboundAt", agg.last_inbound), agg.last_inbound),
    "unreadCount"   = agg.unread
FROM agg WHERE c."id" = agg.keep_id;

DELETE FROM "Conversation" c
USING (
  SELECT "id",
         ROW_NUMBER() OVER (
           PARTITION BY "workspaceId", "contactId", "waNumberId"
           ORDER BY "createdAt" ASC, "id" ASC
         ) AS rn
  FROM "Conversation" WHERE "waNumberId" IS NOT NULL
) dup
WHERE c."id" = dup."id" AND dup.rn > 1;

-- Partial, because a thread whose number was disconnected has waNumberId NULL
-- and Postgres treats NULLs as distinct — several detached threads for one
-- contact are legitimate history, not a conflict.
CREATE UNIQUE INDEX "Conversation_workspace_contact_number_key"
  ON "Conversation"("workspaceId", "contactId", "waNumberId")
  WHERE "waNumberId" IS NOT NULL;
