-- Intent rules, the platform audit trail, and the workspace/agent profile
-- fields the Settings and AI Agent pages now edit.
--
-- Every statement is additive and guarded, and every new column has a default,
-- so this applies to a populated database without touching a single existing
-- row's meaning. Nothing here is destructive: no drops, no type changes, no
-- backfills that could lose data.

-- ── Workspace: agent configuration beyond name/prompt/knowledge ──
ALTER TABLE "Workspace"
  ADD COLUMN IF NOT EXISTS "aiAgentPurpose"       TEXT             NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "aiAgentInstructions"  TEXT             NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "aiAgentSafetyNote"    TEXT             NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "aiAgentLanguages"     JSONB,
  ADD COLUMN IF NOT EXISTS "escalationThreshold"  DOUBLE PRECISION NOT NULL DEFAULT 0.65,
  ADD COLUMN IF NOT EXISTS "escalationRules"      JSONB;

-- ── Workspace: profile and branding ──
ALTER TABLE "Workspace"
  ADD COLUMN IF NOT EXISTS "industry"     TEXT,
  ADD COLUMN IF NOT EXISTS "timezone"     TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  ADD COLUMN IF NOT EXISTS "brandColor"   TEXT NOT NULL DEFAULT '#35e8f2',
  ADD COLUMN IF NOT EXISTS "brandLogoUrl" TEXT;

-- ── Intent rules ──
CREATE TABLE IF NOT EXISTS "IntentRule" (
  "id"           TEXT         NOT NULL,
  "workspaceId"  TEXT         NOT NULL,
  "name"         TEXT         NOT NULL,
  "icon"         TEXT         NOT NULL DEFAULT '*',
  "actionType"   TEXT         NOT NULL DEFAULT 'ai',
  "actionTarget" TEXT         NOT NULL DEFAULT '',
  "phrases"      JSONB        NOT NULL DEFAULT '[]',
  "isActive"     BOOLEAN      NOT NULL DEFAULT true,
  "sortOrder"    INTEGER      NOT NULL DEFAULT 0,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "IntentRule_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "IntentRule"
    ADD CONSTRAINT "IntentRule_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "IntentRule_workspaceId_name_key"
  ON "IntentRule" ("workspaceId", "name");
CREATE INDEX IF NOT EXISTS "IntentRule_workspaceId_isActive_idx"
  ON "IntentRule" ("workspaceId", "isActive");

-- ── Intent match events ──
--
-- One row per routing decision. Kept as events rather than counters so the
-- accuracy panel can window to 30 days and so a mismatch corrected by a human
-- can be recorded against the decision it corrects.
CREATE TABLE IF NOT EXISTS "IntentMatchEvent" (
  "id"           TEXT             NOT NULL,
  "workspaceId"  TEXT             NOT NULL,
  "intentRuleId" TEXT,
  "outcome"      TEXT             NOT NULL,
  "confidence"   DOUBLE PRECISION NOT NULL DEFAULT 0,
  "sample"       TEXT             NOT NULL DEFAULT '',
  "createdAt"    TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "IntentMatchEvent_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "IntentMatchEvent"
    ADD CONSTRAINT "IntentMatchEvent_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "IntentMatchEvent"
    ADD CONSTRAINT "IntentMatchEvent_intentRuleId_fkey"
    FOREIGN KEY ("intentRuleId") REFERENCES "IntentRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "IntentMatchEvent_workspaceId_createdAt_idx"
  ON "IntentMatchEvent" ("workspaceId", "createdAt");

-- ── Admin audit trail ──
--
-- Unscoped by design: the row has to outlive the workspace it describes, which
-- is exactly the case an audit trail exists for.
CREATE TABLE IF NOT EXISTS "AdminAuditLog" (
  "id"          TEXT         NOT NULL,
  "actorId"     TEXT,
  "actorEmail"  TEXT         NOT NULL,
  "action"      TEXT         NOT NULL,
  "targetType"  TEXT         NOT NULL DEFAULT '',
  "targetLabel" TEXT         NOT NULL DEFAULT '',
  "reason"      TEXT,
  "meta"        JSONB,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AdminAuditLog_createdAt_idx" ON "AdminAuditLog" ("createdAt");
CREATE INDEX IF NOT EXISTS "AdminAuditLog_action_idx"    ON "AdminAuditLog" ("action");

-- ── Internal conversation notes ──
--
-- Its own table rather than a flagged Message: a note is the team talking to
-- itself, and one code path treating it as a message would deliver it to the
-- customer it is about.
CREATE TABLE IF NOT EXISTS "ConversationNote" (
  "id"             TEXT         NOT NULL,
  "conversationId" TEXT         NOT NULL,
  "authorId"       TEXT,
  "body"           TEXT         NOT NULL,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConversationNote_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "ConversationNote"
    ADD CONSTRAINT "ConversationNote_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ConversationNote"
    ADD CONSTRAINT "ConversationNote_authorId_fkey"
    FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "ConversationNote_conversationId_createdAt_idx"
  ON "ConversationNote" ("conversationId", "createdAt");

-- ── Campaign goal ──
-- Nullable: campaigns created before the builder asked have no answer, and a
-- default would misreport what the sender actually chose.
ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "goal" TEXT;
