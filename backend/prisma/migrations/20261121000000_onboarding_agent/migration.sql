-- Onboarding agent: describe an automation in plain words and have the forms,
-- workflows, auto-replies and templates built for you, plus the AI credits
-- that pay for it.
--
-- Additive only. Two new tables and three new columns that all default to 0,
-- so nothing existing behaves differently until a plan is given credits.

ALTER TABLE "Plan" ADD COLUMN IF NOT EXISTS "aiCreditsMonthly" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Plan" ADD COLUMN IF NOT EXISTS "aiCreditRate" DECIMAL(10,4) NOT NULL DEFAULT 0;
ALTER TABLE "UsageCounter" ADD COLUMN IF NOT EXISTS "aiCreditsUsed" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "AgentBuild" (
  "id"          TEXT         NOT NULL,
  "workspaceId" TEXT         NOT NULL,
  "userId"      TEXT,
  "title"       TEXT         NOT NULL,
  "prompt"      TEXT         NOT NULL,
  "status"      TEXT         NOT NULL DEFAULT 'DRAFT',
  "blueprint"   JSONB        NOT NULL DEFAULT '{}',
  "messages"    JSONB        NOT NULL DEFAULT '[]',
  "applied"     JSONB        NOT NULL DEFAULT '{}',
  "creditsUsed" INTEGER      NOT NULL DEFAULT 0,
  "appliedAt"   TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgentBuild_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AgentBuild_workspaceId_updatedAt_idx" ON "AgentBuild" ("workspaceId", "updatedAt");

DO $$ BEGIN
  ALTER TABLE "AgentBuild"
    ADD CONSTRAINT "AgentBuild_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "AiCreditUsage" (
  "id"           TEXT          NOT NULL,
  "workspaceId"  TEXT          NOT NULL,
  "userId"       TEXT,
  "feature"      TEXT          NOT NULL,
  "reference"    TEXT,
  "model"        TEXT,
  "inputTokens"  INTEGER       NOT NULL DEFAULT 0,
  "outputTokens" INTEGER       NOT NULL DEFAULT 0,
  "credits"      INTEGER       NOT NULL,
  "fromPlan"     INTEGER       NOT NULL DEFAULT 0,
  "fromWallet"   INTEGER       NOT NULL DEFAULT 0,
  "walletAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "createdAt"    TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiCreditUsage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AiCreditUsage_workspaceId_createdAt_idx" ON "AiCreditUsage" ("workspaceId", "createdAt");

DO $$ BEGIN
  ALTER TABLE "AiCreditUsage"
    ADD CONSTRAINT "AiCreditUsage_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Starting allowances for the three plans sold today. Only rows still at the
-- column defaults are touched, so a figure an admin has already set is kept.
UPDATE "Plan" SET "aiCreditsMonthly" = 20,   "aiCreditRate" = 1.00 WHERE "key" = 'FREE'   AND "aiCreditsMonthly" = 0 AND "aiCreditRate" = 0;
UPDATE "Plan" SET "aiCreditsMonthly" = 300,  "aiCreditRate" = 0.75 WHERE "key" = 'BASIC'  AND "aiCreditsMonthly" = 0 AND "aiCreditRate" = 0;
UPDATE "Plan" SET "aiCreditsMonthly" = 1000, "aiCreditRate" = 0.50 WHERE "key" = 'GROWTH' AND "aiCreditsMonthly" = 0 AND "aiCreditRate" = 0;
