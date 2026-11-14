-- Context agents: a chat assistant that answers every message arriving on one
-- dedicated WhatsApp number, from a context the workspace typed or uploaded.
--
-- Additive only — one new table, no change to any existing row. Until a
-- workspace creates an agent and assigns it a number, nothing behaves
-- differently.
CREATE TABLE IF NOT EXISTS "ContextAgent" (
  "id"            TEXT         NOT NULL,
  "workspaceId"   TEXT         NOT NULL,
  "name"          TEXT         NOT NULL DEFAULT 'Context Agent',
  "context"       TEXT         NOT NULL DEFAULT '',
  "instructions"  TEXT         NOT NULL DEFAULT '',
  "strictContext" BOOLEAN      NOT NULL DEFAULT true,
  "enabled"       BOOLEAN      NOT NULL DEFAULT false,
  "waNumberId"    TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ContextAgent_pkey" PRIMARY KEY ("id")
);

-- One number, one agent. This is what makes "the number is dedicated" a
-- database fact: a second agent cannot claim a number that is already taken.
CREATE UNIQUE INDEX IF NOT EXISTS "ContextAgent_waNumberId_key" ON "ContextAgent" ("waNumberId");
CREATE INDEX IF NOT EXISTS "ContextAgent_workspaceId_idx" ON "ContextAgent" ("workspaceId");

DO $$ BEGIN
  ALTER TABLE "ContextAgent"
    ADD CONSTRAINT "ContextAgent_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- SET NULL: disconnecting the number keeps the agent and its context, just
-- without a number to answer on.
DO $$ BEGIN
  ALTER TABLE "ContextAgent"
    ADD CONSTRAINT "ContextAgent_waNumberId_fkey"
    FOREIGN KEY ("waNumberId") REFERENCES "WaNumber" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
