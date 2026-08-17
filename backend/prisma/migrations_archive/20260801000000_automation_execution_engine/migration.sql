-- Makes the Automation tab actually do something. Before this, Workflows,
-- Instagram Quickflows, Voice AI and WhatsApp Forms stored rows that no code
-- path ever read, and the three "Basic Automations" replies were hardcoded
-- string constants in webhook.service.js.

-- ── Workspace: configurable auto-reply text, business hours, IG connection ──
ALTER TABLE "Workspace"
  ADD COLUMN "welcomeMessage" TEXT NOT NULL DEFAULT 'Thanks for reaching out! We''ve received your message and will get back to you shortly.',
  ADD COLUMN "oooMessage" TEXT NOT NULL DEFAULT 'We''re currently unavailable. We''ll respond to your message as soon as possible.',
  ADD COLUMN "delayedMessage" TEXT NOT NULL DEFAULT 'Sorry for the wait — we''re still looking into this and will reply as soon as we can.',
  ADD COLUMN "delayedAfterMinutes" INTEGER NOT NULL DEFAULT 15,
  ADD COLUMN "businessHours" JSONB,
  ADD COLUMN "voiceAiInboundPhone" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "voiceAiGreeting" TEXT NOT NULL DEFAULT 'Hi! Thanks for calling. How can I help you today?',
  ADD COLUMN "instagramUserId" TEXT,
  ADD COLUMN "instagramUsername" TEXT,
  ADD COLUMN "instagramAccessToken" TEXT,
  ADD COLUMN "instagramConnectedAt" TIMESTAMP(3);

-- ── Conversation: agent assignment (the workflow "assign to agent" action) ──
ALTER TABLE "Conversation" ADD COLUMN "assignedToUserId" TEXT;

ALTER TABLE "Conversation"
  ADD CONSTRAINT "Conversation_assignedToUserId_fkey"
  FOREIGN KEY ("assignedToUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Workflow runs ──
CREATE TYPE "WorkflowRunStatus" AS ENUM ('RUNNING', 'WAITING', 'COMPLETED', 'FAILED');

CREATE TABLE "WorkflowRun" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "workflowId" TEXT NOT NULL,
  "conversationId" TEXT,
  "contactId" TEXT,
  "status" "WorkflowRunStatus" NOT NULL DEFAULT 'RUNNING',
  "cursor" INTEGER NOT NULL DEFAULT 0,
  "nodes" JSONB NOT NULL,
  "trace" JSONB,
  "triggerMessage" TEXT,
  "error" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  CONSTRAINT "WorkflowRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WorkflowRun_workspaceId_startedAt_idx" ON "WorkflowRun"("workspaceId", "startedAt");
CREATE INDEX "WorkflowRun_workflowId_startedAt_idx" ON "WorkflowRun"("workflowId", "startedAt");

ALTER TABLE "WorkflowRun" ADD CONSTRAINT "WorkflowRun_workflowId_fkey"
  FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkflowRun" ADD CONSTRAINT "WorkflowRun_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkflowRun" ADD CONSTRAINT "WorkflowRun_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── WhatsApp Forms: real field definitions + submissions ──
ALTER TABLE "WhatsappForm"
  ADD COLUMN "schema" JSONB,
  ADD COLUMN "keyword" TEXT,
  ADD COLUMN "completionMessage" TEXT NOT NULL DEFAULT 'Thanks! We''ve recorded your response.';

-- Partial-unique semantics: Postgres treats NULLs as distinct, so any number
-- of forms may have no keyword while set keywords stay unique per workspace.
CREATE UNIQUE INDEX "WhatsappForm_workspaceId_keyword_key" ON "WhatsappForm"("workspaceId", "keyword");

CREATE TABLE "WhatsappFormSubmission" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "formId" TEXT NOT NULL,
  "contactId" TEXT,
  "conversationId" TEXT,
  "answers" JSONB NOT NULL DEFAULT '{}',
  "cursor" INTEGER NOT NULL DEFAULT 0,
  "completed" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "WhatsappFormSubmission_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WhatsappFormSubmission_workspaceId_formId_idx" ON "WhatsappFormSubmission"("workspaceId", "formId");
CREATE INDEX "WhatsappFormSubmission_conversationId_completed_idx" ON "WhatsappFormSubmission"("conversationId", "completed");

ALTER TABLE "WhatsappFormSubmission" ADD CONSTRAINT "WhatsappFormSubmission_formId_fkey"
  FOREIGN KEY ("formId") REFERENCES "WhatsappForm"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WhatsappFormSubmission" ADD CONSTRAINT "WhatsappFormSubmission_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Instagram Quickflows ──
CREATE TABLE "InstagramFlow" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'dm',
  "keyword" TEXT NOT NULL DEFAULT '',
  "responseTemplate" TEXT NOT NULL,
  "alsoSendDm" BOOLEAN NOT NULL DEFAULT false,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "triggeredCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InstagramFlow_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "InstagramFlow_workspaceId_isActive_idx" ON "InstagramFlow"("workspaceId", "isActive");

ALTER TABLE "InstagramFlow" ADD CONSTRAINT "InstagramFlow_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Voice AI call log ──
CREATE TABLE "VoiceCall" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "providerCallId" TEXT,
  "fromPhone" TEXT NOT NULL,
  "toPhone" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
  "transcript" JSONB NOT NULL DEFAULT '[]',
  "leadName" TEXT,
  "leadEmail" TEXT,
  "leadSummary" TEXT,
  "contactId" TEXT,
  "forwarded" BOOLEAN NOT NULL DEFAULT false,
  "durationSec" INTEGER NOT NULL DEFAULT 0,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endedAt" TIMESTAMP(3),
  CONSTRAINT "VoiceCall_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VoiceCall_providerCallId_key" ON "VoiceCall"("providerCallId");
CREATE INDEX "VoiceCall_workspaceId_startedAt_idx" ON "VoiceCall"("workspaceId", "startedAt");

ALTER TABLE "VoiceCall" ADD CONSTRAINT "VoiceCall_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
