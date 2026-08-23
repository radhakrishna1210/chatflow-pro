ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "fallbackConfig" JSONB;
ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "aiAgentEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "aiAgentName" TEXT NOT NULL DEFAULT 'Assistant';
ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "aiAgentPrompt" TEXT NOT NULL DEFAULT 'You are a helpful customer support agent. Answer briefly and politely.';
ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "aiAgentKnowledge" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "aiAgentModel" TEXT NOT NULL DEFAULT 'gemini-1.5-flash';
ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "aiAgentDeployedAt" TIMESTAMP(3);
ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "intentMatchingEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "intentMatchThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.6;
