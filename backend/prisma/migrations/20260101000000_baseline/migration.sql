-- Baseline: the schema as it stood before the first tracked migration
-- (20260810000000_site_knowledge_index).
--
-- The original tables were created with `prisma db push`, so the history began
-- with ALTERs against tables no migration ever created and `migrate deploy`
-- could not build an empty database (OPEN-001). This migration sorts before
-- every other one and creates exactly what they expect to find: the current
-- datamodel minus everything the later migrations add themselves. That also
-- covers prisma/manual/003_ai_features.sql and 004_authentication_transactions.sql,
-- which were applied by hand on the existing databases.
--
-- Existing databases already have all of this. The guard below makes the whole
-- migration a no-op when "Workspace" exists, so `migrate deploy` simply records
-- it as applied there. Marking it applied up front is equivalent:
--   npx prisma migrate resolve --applied 20260101000000_baseline
--
-- Generated from `prisma migrate diff --from-empty --to-schema-datamodel`,
-- with the objects created by later migrations removed. Do not edit by hand.

DO $baseline$
BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'Workspace')) IS NOT NULL THEN
    RAISE NOTICE 'baseline skipped: the core schema already exists';
    RETURN;
  END IF;

    CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED');

    CREATE TYPE "InviteKind" AS ENUM ('EMAIL', 'LINK');

    CREATE TYPE "WorkflowRunStatus" AS ENUM ('RUNNING', 'WAITING', 'COMPLETED', 'FAILED');

    CREATE TYPE "Role" AS ENUM ('VIEWER', 'AGENT', 'CLIENT', 'ADMIN');

    CREATE TYPE "NumberPoolStatus" AS ENUM ('AVAILABLE', 'ASSIGNED', 'BANNED', 'PROVISIONING');

    CREATE TYPE "TemplateStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'DELETED');

    CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'RUNNING', 'PAUSED', 'COMPLETED', 'FAILED', 'CANCELLED');

    CREATE TYPE "CampaignRecipientStatus" AS ENUM ('PENDING', 'SENDING', 'RETRYING', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'SKIPPED');

    CREATE TYPE "ConversationStatus" AS ENUM ('OPEN', 'RESOLVED', 'PENDING');

    CREATE TYPE "MessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');

    CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'CONTACTED', 'QUALIFIED', 'UNQUALIFIED', 'CONVERTED', 'LOST');

    CREATE TYPE "LeadCategory" AS ENUM ('HOT', 'WARM', 'COLD');

    CREATE TYPE "DealStage" AS ENUM ('QUALIFICATION', 'NEEDS_ANALYSIS', 'PROPOSAL', 'NEGOTIATION', 'CLOSED_WON', 'CLOSED_LOST');

    CREATE TYPE "SequenceStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'PAUSED');

    CREATE TYPE "EnrollmentStatus" AS ENUM ('ACTIVE', 'WAITING', 'COMPLETED', 'EXITED', 'FAILED');

    CREATE TYPE "CustomFieldType" AS ENUM ('TEXT', 'TEXTAREA', 'NUMBER', 'CURRENCY', 'DATE', 'BOOLEAN', 'DROPDOWN', 'MULTISELECT', 'URL', 'EMAIL', 'PHONE', 'USER');

    CREATE TYPE "QuoteStatus" AS ENUM ('DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED');

    CREATE TYPE "TicketStatus" AS ENUM ('NEW', 'OPEN', 'WAITING', 'RESOLVED', 'CLOSED');

    CREATE TYPE "TicketPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

    CREATE TYPE "TaskStatus" AS ENUM ('PENDING', 'COMPLETED');

    CREATE TYPE "CrmActivityType" AS ENUM ('NOTE', 'CALL', 'EMAIL', 'MEETING');

    CREATE TYPE "AgentTaskStatus" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'FAILED', 'SKIPPED');

    CREATE TYPE "FactBand" AS ENUM ('STRONG', 'WEAK');

    CREATE TABLE "User" (
        "id" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "email" TEXT NOT NULL,
        "passwordHash" TEXT,
        "googleId" TEXT,
        "phone" TEXT,
        "jobTitle" TEXT,
        "company" TEXT,
        "timezone" TEXT,
        "language" TEXT,
        "lastLoginAt" TIMESTAMP(3),
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT "User_pkey" PRIMARY KEY ("id")
    );

    CREATE TABLE "Workspace" (
        "id" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "plan" TEXT NOT NULL DEFAULT 'FREE',
        "webhookUrl" TEXT,
        "webhookVerifyToken" TEXT NOT NULL DEFAULT '',
        "webhookEvents" JSONB,
        "notifyNewConversation" BOOLEAN NOT NULL DEFAULT true,
        "notifyTemplateApproved" BOOLEAN NOT NULL DEFAULT true,
        "notifyTemplateRejected" BOOLEAN NOT NULL DEFAULT true,
        "notifyCampaignCompleted" BOOLEAN NOT NULL DEFAULT true,
        "notifyHighOptout" BOOLEAN NOT NULL DEFAULT true,
        "notifyRateLimit" BOOLEAN NOT NULL DEFAULT true,
        "emailNotifyCampaignCompleted" BOOLEAN NOT NULL DEFAULT true,
        "emailNotifyMemberInvite" BOOLEAN NOT NULL DEFAULT true,
        "emailNotifyTemplateApproved" BOOLEAN NOT NULL DEFAULT true,
        "emailNotifyTemplateRejected" BOOLEAN NOT NULL DEFAULT true,
        "autoOooEnabled" BOOLEAN NOT NULL DEFAULT true,
        "autoWelcomeEnabled" BOOLEAN NOT NULL DEFAULT true,
        "autoDelayedEnabled" BOOLEAN NOT NULL DEFAULT false,
        "welcomeMessage" TEXT NOT NULL DEFAULT 'Thanks for reaching out! We''ve received your message and will get back to you shortly.',
        "oooMessage" TEXT NOT NULL DEFAULT 'We''re currently unavailable. We''ll respond to your message as soon as possible.',
        "delayedMessage" TEXT NOT NULL DEFAULT 'Sorry for the wait — we''re still looking into this and will reply as soon as we can.',
        "delayedAfterMinutes" INTEGER NOT NULL DEFAULT 15,
        "businessHours" JSONB,
        "voiceAiEnabled" BOOLEAN NOT NULL DEFAULT false,
        "voiceAiName" TEXT NOT NULL DEFAULT 'MyCallGenie',
        "voiceAiPrompt" TEXT NOT NULL DEFAULT 'Greet the caller and ask for their details.',
        "voiceAiPhone" TEXT NOT NULL DEFAULT '',
        "voiceAiInboundPhone" TEXT NOT NULL DEFAULT '',
        "voiceAiGreeting" TEXT NOT NULL DEFAULT 'Hi! Thanks for calling. How can I help you today?',
        "instagramUserId" TEXT,
        "instagramUsername" TEXT,
        "instagramAccessToken" TEXT,
        "instagramConnectedAt" TIMESTAMP(3),
        "aiAgentEnabled" BOOLEAN NOT NULL DEFAULT false,
        "aiAgentName" TEXT NOT NULL DEFAULT 'Assistant',
        "aiAgentPrompt" TEXT NOT NULL DEFAULT 'You are a helpful customer support agent. Answer briefly and politely.',
        "aiAgentKnowledge" TEXT NOT NULL DEFAULT '',
        "aiAgentModel" TEXT NOT NULL DEFAULT 'gemini-1.5-flash',
        "aiAgentDeployedAt" TIMESTAMP(3),
        "intentMatchingEnabled" BOOLEAN NOT NULL DEFAULT false,
        "intentMatchThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.6,
        "suspended" BOOLEAN NOT NULL DEFAULT false,
        "suspendedReason" TEXT,
        "walletBalance" DECIMAL(12,2) NOT NULL DEFAULT 0,
        "costPerMessage" DECIMAL(10,4) NOT NULL DEFAULT 0.92,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "recordVisibility" TEXT NOT NULL DEFAULT 'ALL',
        "autoLeadFromReply" BOOLEAN NOT NULL DEFAULT false,

        CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
    );

    CREATE TABLE "WorkspaceMember" (
        "userId" TEXT NOT NULL,
        "workspaceId" TEXT NOT NULL,
        "role" "Role" NOT NULL DEFAULT 'CLIENT',
        "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT "WorkspaceMember_pkey" PRIMARY KEY ("userId","workspaceId")
    );

    CREATE TABLE "Invitation" (
        "id" TEXT NOT NULL,
        "workspaceId" TEXT NOT NULL,
        "email" TEXT,
        "role" "Role" NOT NULL DEFAULT 'CLIENT',
        "kind" "InviteKind" NOT NULL DEFAULT 'EMAIL',
        "maxUses" INTEGER,
        "useCount" INTEGER NOT NULL DEFAULT 0,
        "tokenHash" TEXT NOT NULL,
        "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
        "invitedByUserId" TEXT NOT NULL,
        "expiresAt" TIMESTAMP(3) NOT NULL,
        "acceptedAt" TIMESTAMP(3),
        "revokedAt" TIMESTAMP(3),
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
    );

    CREATE TABLE "WaNumber" (
        "id" TEXT NOT NULL,
        "workspaceId" TEXT NOT NULL,
        "phoneNumber" TEXT NOT NULL,
        "metaPhoneNumberId" TEXT NOT NULL,
        "wabaId" TEXT NOT NULL,
        "encryptedAccessToken" TEXT NOT NULL,
        "displayName" TEXT,
        "quality" TEXT,
        "status" TEXT NOT NULL DEFAULT 'ACTIVE',
        "messagingLimit" TEXT,
        "appSubscribed" BOOLEAN NOT NULL DEFAULT false,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT "WaNumber_pkey" PRIMARY KEY ("id")
    );

    CREATE TABLE "NumberPool" (
        "id" TEXT NOT NULL,
        "phoneNumber" TEXT NOT NULL,
        "phoneNumberId" TEXT,
        "wabaId" TEXT,
        "encryptedAccessToken" TEXT,
        "displayName" TEXT,
        "status" "NumberPoolStatus" NOT NULL DEFAULT 'AVAILABLE',
        "assignedTo" TEXT,
        "registeredAt" TIMESTAMP(3),
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "provider" TEXT NOT NULL DEFAULT 'META',
        "twilioSid" TEXT,

        CONSTRAINT "NumberPool_pkey" PRIMARY KEY ("id")
    );

    CREATE TABLE "Template" (
        "id" TEXT NOT NULL,
        "workspaceId" TEXT NOT NULL,
        "waNumberId" TEXT,
        "metaTemplateId" TEXT,
        "name" TEXT NOT NULL,
        "category" TEXT NOT NULL,
        "language" TEXT NOT NULL,
        "components" JSONB NOT NULL,
        "status" "TemplateStatus" NOT NULL DEFAULT 'PENDING',
        "previousCategory" TEXT,
        "categoryUpdatedAt" TIMESTAMP(3),
        "aiGenerated" BOOLEAN NOT NULL DEFAULT false,
        "headerAssetId" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT "Template_pkey" PRIMARY KEY ("id")
    );

    CREATE TABLE "TemplateAsset" (
        "id" TEXT NOT NULL,
        "workspaceId" TEXT NOT NULL,
        "mimeType" TEXT NOT NULL,
        "bytes" BYTEA NOT NULL,
        "sizeBytes" INTEGER NOT NULL,
        "prompt" TEXT,
        "source" TEXT NOT NULL DEFAULT 'upload',
        "metaMediaId" TEXT,
        "metaMediaNumberId" TEXT,
        "metaMediaAt" TIMESTAMP(3),
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT "TemplateAsset_pkey" PRIMARY KEY ("id")
    );

    CREATE TABLE "Contact" (
        "id" TEXT NOT NULL,
        "workspaceId" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "phoneNumber" TEXT NOT NULL,
        "email" TEXT,
        "tags" TEXT[],
        "optedOut" BOOLEAN NOT NULL DEFAULT false,
        "optedOutAt" TIMESTAMP(3),
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
    );

    CREATE TABLE "Campaign" (
        "id" TEXT NOT NULL,
        "workspaceId" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "templateId" TEXT NOT NULL,
        "waNumberId" TEXT,
        "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
        "totalContacts" INTEGER NOT NULL DEFAULT 0,
        "sent" INTEGER NOT NULL DEFAULT 0,
        "delivered" INTEGER NOT NULL DEFAULT 0,
        "read" INTEGER NOT NULL DEFAULT 0,
        "failed" INTEGER NOT NULL DEFAULT 0,
        "skipped" INTEGER NOT NULL DEFAULT 0,
        "costPerMessage" DECIMAL(10,4),
        "totalCost" DECIMAL(12,2),
        "walletBefore" DECIMAL(12,2),
        "walletAfter" DECIMAL(12,2),
        "chargedAt" TIMESTAMP(3),
        "refundAmount" DECIMAL(12,2),
        "refundedAt" TIMESTAMP(3),
        "createdByUserId" TEXT,
        "scheduledAt" TIMESTAMP(3),
        "launchedAt" TIMESTAMP(3),
        "completedAt" TIMESTAMP(3),
        "aiGenerated" BOOLEAN NOT NULL DEFAULT false,
        "aiAgentEnabled" BOOLEAN NOT NULL DEFAULT false,
        "aiAgentId" TEXT,
        "aiAgentCtaLabel" TEXT,
        "aiAgentContext" JSONB,
        "queueJobId" TEXT,
        "replyRules" JSONB,
        "retryConfig" JSONB,
        "trackingConfig" JSONB,
        "fallbackConfig" JSONB,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
    );

    CREATE TABLE "CampaignRecipient" (
        "id" TEXT NOT NULL,
        "campaignId" TEXT NOT NULL,
        "contactId" TEXT NOT NULL,
        "status" "CampaignRecipientStatus" NOT NULL DEFAULT 'PENDING',
        "sentAt" TIMESTAMP(3),
        "deliveredAt" TIMESTAMP(3),
        "readAt" TIMESTAMP(3),
        "failedAt" TIMESTAMP(3),
        "failReason" TEXT,
        "retryCount" INTEGER NOT NULL DEFAULT 0,
        "lastRetryAt" TIMESTAMP(3),
        "nextRetryAt" TIMESTAMP(3),
        "lastFailureReason" TEXT,
        "retryStatus" TEXT,
        "initialStatus" TEXT,
        "retryHistory" JSONB,
        "billedAt" TIMESTAMP(3),
        "billedAmount" DECIMAL(10,4),
        "billingStatus" TEXT,
        "messageCategory" TEXT,
        "aiContext" JSONB,

        CONSTRAINT "CampaignRecipient_pkey" PRIMARY KEY ("id")
    );

    CREATE TABLE "Conversation" (
        "id" TEXT NOT NULL,
        "workspaceId" TEXT NOT NULL,
        "contactId" TEXT NOT NULL,
        "waNumberId" TEXT,
        "status" "ConversationStatus" NOT NULL DEFAULT 'OPEN',
        "unreadCount" INTEGER NOT NULL DEFAULT 0,
        "label" TEXT,
        "assignedToUserId" TEXT,
        "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
    );

    CREATE TABLE "CampaignAiSession" (
        "id" TEXT NOT NULL,
        "workspaceId" TEXT NOT NULL,
        "campaignId" TEXT NOT NULL,
        "campaignRecipientId" TEXT,
        "contactId" TEXT NOT NULL,
        "conversationId" TEXT NOT NULL,
        "agentId" TEXT,
        "ctaLabel" TEXT,
        "campaignContext" JSONB NOT NULL,
        "status" TEXT NOT NULL DEFAULT 'ACTIVE',
        "turns" INTEGER NOT NULL DEFAULT 0,
        "activatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "expiresAt" TIMESTAMP(3) NOT NULL,

        CONSTRAINT "CampaignAiSession_pkey" PRIMARY KEY ("id")
    );

    CREATE TABLE "Message" (
        "id" TEXT NOT NULL,
        "conversationId" TEXT NOT NULL,
        "body" TEXT NOT NULL,
        "direction" "MessageDirection" NOT NULL,
        "metaMessageId" TEXT,
        "senderUserId" TEXT,
        "campaignRecipientId" TEXT,
        "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
    );

    CREATE TABLE "AutomationTrigger" (
        "id" TEXT NOT NULL,
        "workspaceId" TEXT NOT NULL,
        "keyword" TEXT NOT NULL,
        "responseTemplate" TEXT NOT NULL,
        "isActive" BOOLEAN NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT "AutomationTrigger_pkey" PRIMARY KEY ("id")
    );

    CREATE TABLE "Workflow" (
        "id" TEXT NOT NULL,
        "workspaceId" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "isActive" BOOLEAN NOT NULL DEFAULT true,
        "nodes" JSONB NOT NULL,
        "edges" JSONB NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL,

        CONSTRAINT "Workflow_pkey" PRIMARY KEY ("id")
    );

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
        "leadId" TEXT,
        "dealId" TEXT,
        "ticketId" TEXT,

        CONSTRAINT "WorkflowRun_pkey" PRIMARY KEY ("id")
    );

    CREATE TABLE "ApiKey" (
        "id" TEXT NOT NULL,
        "workspaceId" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "keyHash" TEXT NOT NULL,
        "keyPrefix" TEXT NOT NULL,
        "environment" TEXT NOT NULL DEFAULT 'production',
        "lastUsedAt" TIMESTAMP(3),
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "revokedAt" TIMESTAMP(3),

        CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
    );

    CREATE TABLE "Invoice" (
        "id" TEXT NOT NULL,
        "workspaceId" TEXT NOT NULL,
        "invoiceDate" TIMESTAMP(3) NOT NULL,
        "description" TEXT,
        "amount" DOUBLE PRECISION NOT NULL,
        "currency" TEXT NOT NULL DEFAULT 'USD',
        "status" TEXT NOT NULL DEFAULT 'PAID',
        "reference" TEXT,

        CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
    );

    CREATE TABLE "RefreshToken" (
        "id" TEXT NOT NULL,
        "userId" TEXT NOT NULL,
        "token" TEXT NOT NULL,
        "expiresAt" TIMESTAMP(3) NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
    );

    CREATE TABLE "AiSession" (
        "id" TEXT NOT NULL,
        "userId" TEXT,
        "workspaceId" TEXT,
        "state" JSONB NOT NULL DEFAULT '{}',
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL,

        CONSTRAINT "AiSession_pkey" PRIMARY KEY ("id")
    );

    CREATE TABLE "Segment" (
        "id" TEXT NOT NULL,
        "workspaceId" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "desc" TEXT,
        "color" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL,

        CONSTRAINT "Segment_pkey" PRIMARY KEY ("id")
    );

    CREATE TABLE "WhatsappForm" (
        "id" TEXT NOT NULL,
        "workspaceId" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "submissions" INTEGER NOT NULL DEFAULT 0,
        "fields" INTEGER NOT NULL DEFAULT 1,
        "status" TEXT NOT NULL DEFAULT 'Draft',
        "schema" JSONB,
        "categories" JSONB,
        "keyword" TEXT,
        "completionMessage" TEXT NOT NULL DEFAULT 'Thanks! We''ve recorded your response.',
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL,

        CONSTRAINT "WhatsappForm_pkey" PRIMARY KEY ("id")
    );

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

    CREATE TABLE "WalletTransaction" (
        "id" TEXT NOT NULL,
        "workspaceId" TEXT NOT NULL,
        "amount" DECIMAL(12,2) NOT NULL,
        "type" TEXT NOT NULL,
        "category" TEXT NOT NULL DEFAULT 'USAGE',
        "reason" TEXT NOT NULL,
        "balanceBefore" DECIMAL(12,2),
        "balanceAfter" DECIMAL(12,2) NOT NULL,
        "status" TEXT NOT NULL DEFAULT 'SUCCESS',
        "gateway" TEXT,
        "reference" TEXT,
        "idempotencyKey" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT "WalletTransaction_pkey" PRIMARY KEY ("id")
    );

    CREATE TABLE "OptOut" (
        "id" TEXT NOT NULL,
        "workspaceId" TEXT NOT NULL,
        "phoneNumber" TEXT NOT NULL,
        "rawPhone" TEXT,
        "waNumberId" TEXT,
        "waPhone" TEXT,
        "contactId" TEXT,
        "keyword" TEXT,
        "reason" TEXT NOT NULL DEFAULT 'User Opted Out',
        "source" TEXT NOT NULL DEFAULT 'Incoming WhatsApp Message',
        "blockedByUserId" TEXT,
        "blockedByName" TEXT,
        "active" BOOLEAN NOT NULL DEFAULT true,
        "unblockedAt" TIMESTAMP(3),
        "unblockedByUserId" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT "OptOut_pkey" PRIMARY KEY ("id")
    );

    CREATE TABLE "Notification" (
        "id" TEXT NOT NULL,
        "workspaceId" TEXT,
        "userId" TEXT,
        "type" TEXT NOT NULL,
        "title" TEXT NOT NULL,
        "body" TEXT,
        "link" TEXT,
        "meta" JSONB,
        "readAt" TIMESTAMP(3),
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
    );

    CREATE TABLE "NotificationRead" (
        "notificationId" TEXT NOT NULL,
        "userId" TEXT NOT NULL,
        "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT "NotificationRead_pkey" PRIMARY KEY ("notificationId","userId")
    );

    CREATE TABLE "WorkspaceIntegration" (
        "id" TEXT NOT NULL,
        "workspaceId" TEXT NOT NULL,
        "provider" TEXT NOT NULL,
        "type" TEXT NOT NULL,
        "status" TEXT NOT NULL DEFAULT 'CONNECTED',
        "encryptedCredentials" TEXT,
        "config" JSONB,
        "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT "WorkspaceIntegration_pkey" PRIMARY KEY ("id")
    );

    CREATE TABLE "EmailOtp" (
        "id" TEXT NOT NULL,
        "email" TEXT NOT NULL,
        "codeHash" TEXT NOT NULL,
        "purpose" TEXT NOT NULL DEFAULT 'SIGNUP',
        "name" TEXT,
        "passwordHash" TEXT,
        "attempts" INTEGER NOT NULL DEFAULT 0,
        "consumed" BOOLEAN NOT NULL DEFAULT false,
        "expiresAt" TIMESTAMP(3) NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT "EmailOtp_pkey" PRIMARY KEY ("id")
    );

    CREATE TABLE "WhatsAppAuthOtp" (
        "id" TEXT NOT NULL,
        "phone" TEXT NOT NULL,
        "codeHash" TEXT NOT NULL,
        "purpose" TEXT NOT NULL DEFAULT 'AUTHENTICATION',
        "attempts" INTEGER NOT NULL DEFAULT 0,
        "consumed" BOOLEAN NOT NULL DEFAULT false,
        "expiresAt" TIMESTAMP(3) NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT "WhatsAppAuthOtp_pkey" PRIMARY KEY ("id")
    );

    CREATE TABLE "Plan" (
        "id" TEXT NOT NULL,
        "key" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "priceMonthly" DECIMAL(10,2) NOT NULL,
        "priceQuarterly" DECIMAL(10,2),
        "currency" TEXT NOT NULL DEFAULT 'INR',
        "messageQuota" INTEGER NOT NULL,
        "contactLimit" INTEGER,
        "memberLimit" INTEGER,
        "campaignLimit" INTEGER,
        "apiKeyLimit" INTEGER,
        "overageRatePerMsg" DECIMAL(10,4) NOT NULL,
        "overageRates" JSONB,
        "features" JSONB NOT NULL DEFAULT '{}',
        "isActive" BOOLEAN NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
    );

    CREATE TABLE "Subscription" (
        "id" TEXT NOT NULL,
        "workspaceId" TEXT NOT NULL,
        "planId" TEXT NOT NULL,
        "pendingPlanId" TEXT,
        "status" TEXT NOT NULL DEFAULT 'ACTIVE',
        "currentPeriodStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
        "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL,

        CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
    );

    CREATE TABLE "UsageCounter" (
        "id" TEXT NOT NULL,
        "workspaceId" TEXT NOT NULL,
        "periodStart" TIMESTAMP(3) NOT NULL,
        "periodEnd" TIMESTAMP(3) NOT NULL,
        "messagesUsed" INTEGER NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL,

        CONSTRAINT "UsageCounter_pkey" PRIMARY KEY ("id")
    );

    CREATE TABLE "SupportTicket" (
        "id" TEXT NOT NULL,
        "workspaceId" TEXT NOT NULL,
        "userId" TEXT,
        "subject" TEXT NOT NULL,
        "message" TEXT NOT NULL,
        "category" TEXT NOT NULL DEFAULT 'GENERAL',
        "status" TEXT NOT NULL DEFAULT 'OPEN',
        "adminNote" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id")
    );

    CREATE TABLE "Cluster" (
        "id" TEXT NOT NULL,
        "workspaceId" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "description" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT "Cluster_pkey" PRIMARY KEY ("id")
    );

    CREATE TABLE "ClusterContact" (
        "clusterId" TEXT NOT NULL,
        "contactId" TEXT NOT NULL,

        CONSTRAINT "ClusterContact_pkey" PRIMARY KEY ("clusterId","contactId")
    );

    CREATE TABLE "SystemSetting" (
        "key" TEXT NOT NULL,
        "value" TEXT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL,

        CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("key")
    );

    CREATE TABLE "Sequence" (
        "id" TEXT NOT NULL,
        "workspaceId" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "description" TEXT,
        "status" "SequenceStatus" NOT NULL DEFAULT 'DRAFT',
        "steps" JSONB NOT NULL,
        "respectBusinessHours" BOOLEAN NOT NULL DEFAULT true,
        "exitOnReply" BOOLEAN NOT NULL DEFAULT true,
        "createdByUserId" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT "Sequence_pkey" PRIMARY KEY ("id")
    );

    CREATE TABLE "SequenceEnrollment" (
        "id" TEXT NOT NULL,
        "workspaceId" TEXT NOT NULL,
        "sequenceId" TEXT NOT NULL,
        "contactId" TEXT NOT NULL,
        "leadId" TEXT,
        "status" "EnrollmentStatus" NOT NULL DEFAULT 'ACTIVE',
        "cursor" INTEGER NOT NULL DEFAULT 0,
        "nextRunAt" TIMESTAMP(3),
        "steps" JSONB NOT NULL,
        "exitReason" TEXT,
        "lastError" TEXT,
        "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "completedAt" TIMESTAMP(3),
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT "SequenceEnrollment_pkey" PRIMARY KEY ("id")
    );

    CREATE TABLE "SequenceStepRun" (
        "id" TEXT NOT NULL,
        "workspaceId" TEXT NOT NULL,
        "enrollmentId" TEXT NOT NULL,
        "stepIndex" INTEGER NOT NULL,
        "kind" TEXT NOT NULL,
        "outcome" TEXT NOT NULL,
        "detail" TEXT,
        "ranAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT "SequenceStepRun_pkey" PRIMARY KEY ("id")
    );

    CREATE TABLE "CustomFieldDefinition" (
        "id" TEXT NOT NULL,
        "workspaceId" TEXT NOT NULL,
        "entity" TEXT NOT NULL,
        "key" TEXT NOT NULL,
        "label" TEXT NOT NULL,
        "type" "CustomFieldType" NOT NULL DEFAULT 'TEXT',
        "options" JSONB,
        "helpText" TEXT,
        "required" BOOLEAN NOT NULL DEFAULT false,
        "sortOrder" INTEGER NOT NULL DEFAULT 0,
        "isActive" BOOLEAN NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT "CustomFieldDefinition_pkey" PRIMARY KEY ("id")
    );

    CREATE TABLE "Product" (
        "id" TEXT NOT NULL,
        "workspaceId" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "sku" TEXT,
        "category" TEXT,
        "description" TEXT,
        "unitPrice" DECIMAL(12,2) NOT NULL,
        "currency" TEXT NOT NULL DEFAULT 'INR',
        "unit" TEXT,
        "taxRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
        "isService" BOOLEAN NOT NULL DEFAULT false,
        "isActive" BOOLEAN NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
    );

    CREATE TABLE "DealLineItem" (
        "id" TEXT NOT NULL,
        "workspaceId" TEXT NOT NULL,
        "dealId" TEXT NOT NULL,
        "productId" TEXT,
        "name" TEXT NOT NULL,
        "quantity" DECIMAL(12,3) NOT NULL DEFAULT 1,
        "unitPrice" DECIMAL(12,2) NOT NULL,
        "discountPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
        "taxRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
        "subtotal" DECIMAL(14,2) NOT NULL,
        "taxAmount" DECIMAL(14,2) NOT NULL,
        "total" DECIMAL(14,2) NOT NULL,
        "sortOrder" INTEGER NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT "DealLineItem_pkey" PRIMARY KEY ("id")
    );

    CREATE TABLE "Quote" (
        "id" TEXT NOT NULL,
        "workspaceId" TEXT NOT NULL,
        "quoteNumber" TEXT NOT NULL,
        "dealId" TEXT,
        "contactId" TEXT,
        "status" "QuoteStatus" NOT NULL DEFAULT 'DRAFT',
        "currency" TEXT NOT NULL DEFAULT 'INR',
        "discountPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
        "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
        "taxAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
        "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
        "validUntil" TIMESTAMP(3),
        "terms" TEXT,
        "notes" TEXT,
        "sentAt" TIMESTAMP(3),
        "acceptedAt" TIMESTAMP(3),
        "rejectedAt" TIMESTAMP(3),
        "createdByUserId" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
    );

    CREATE TABLE "QuoteLineItem" (
        "id" TEXT NOT NULL,
        "workspaceId" TEXT NOT NULL,
        "quoteId" TEXT NOT NULL,
        "productId" TEXT,
        "name" TEXT NOT NULL,
        "quantity" DECIMAL(12,3) NOT NULL DEFAULT 1,
        "unitPrice" DECIMAL(12,2) NOT NULL,
        "discountPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
        "taxRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
        "subtotal" DECIMAL(14,2) NOT NULL,
        "taxAmount" DECIMAL(14,2) NOT NULL,
        "total" DECIMAL(14,2) NOT NULL,
        "sortOrder" INTEGER NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT "QuoteLineItem_pkey" PRIMARY KEY ("id")
    );

    CREATE TABLE "PipelineStage" (
        "id" TEXT NOT NULL,
        "workspaceId" TEXT NOT NULL,
        "key" TEXT NOT NULL,
        "label" TEXT NOT NULL,
        "probability" INTEGER NOT NULL DEFAULT 0,
        "sortOrder" INTEGER NOT NULL DEFAULT 0,
        "isActive" BOOLEAN NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT "PipelineStage_pkey" PRIMARY KEY ("id")
    );

    CREATE TABLE "SavedView" (
        "id" TEXT NOT NULL,
        "workspaceId" TEXT NOT NULL,
        "createdByUserId" TEXT,
        "entity" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "filters" JSONB NOT NULL,
        "isShared" BOOLEAN NOT NULL DEFAULT false,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT "SavedView_pkey" PRIMARY KEY ("id")
    );

    CREATE TABLE "Team" (
        "id" TEXT NOT NULL,
        "workspaceId" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "description" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
    );

    CREATE TABLE "TeamMember" (
        "teamId" TEXT NOT NULL,
        "userId" TEXT NOT NULL,
        "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT "TeamMember_pkey" PRIMARY KEY ("teamId","userId")
    );

    CREATE TABLE "LeadForm" (
        "id" TEXT NOT NULL,
        "workspaceId" TEXT NOT NULL,
        "slug" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "description" TEXT,
        "fields" JSONB NOT NULL,
        "successMessage" TEXT NOT NULL DEFAULT 'Thanks ΓÇö we''ll be in touch shortly.',
        "consentText" TEXT,
        "source" TEXT,
        "ownerUserId" TEXT,
        "isActive" BOOLEAN NOT NULL DEFAULT false,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT "LeadForm_pkey" PRIMARY KEY ("id")
    );

    CREATE TABLE "LeadFormSubmission" (
        "id" TEXT NOT NULL,
        "workspaceId" TEXT NOT NULL,
        "formId" TEXT NOT NULL,
        "leadId" TEXT,
        "contactId" TEXT,
        "answers" JSONB NOT NULL,
        "outcome" TEXT NOT NULL,
        "reason" TEXT,
        "consentText" TEXT,
        "consentAt" TIMESTAMP(3),
        "attribution" JSONB,
        "ipHash" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT "LeadFormSubmission_pkey" PRIMARY KEY ("id")
    );

    CREATE TABLE "CrmTicket" (
        "id" TEXT NOT NULL,
        "workspaceId" TEXT NOT NULL,
        "ticketNumber" TEXT NOT NULL,
        "subject" TEXT NOT NULL,
        "description" TEXT,
        "status" "TicketStatus" NOT NULL DEFAULT 'NEW',
        "priority" "TicketPriority" NOT NULL DEFAULT 'NORMAL',
        "category" TEXT,
        "contactId" TEXT,
        "ownerUserId" TEXT,
        "teamId" TEXT,
        "conversationId" TEXT,
        "dueAt" TIMESTAMP(3),
        "firstRespondedAt" TIMESTAMP(3),
        "resolvedAt" TIMESTAMP(3),
        "closedAt" TIMESTAMP(3),
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT "CrmTicket_pkey" PRIMARY KEY ("id")
    );

    CREATE TABLE "XpEvent" (
        "id" TEXT NOT NULL,
        "workspaceId" TEXT NOT NULL,
        "userId" TEXT NOT NULL,
        "kind" TEXT NOT NULL,
        "points" INTEGER NOT NULL,
        "dedupeKey" TEXT NOT NULL,
        "recordType" TEXT,
        "recordId" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT "XpEvent_pkey" PRIMARY KEY ("id")
    );

    CREATE TABLE "Achievement" (
        "id" TEXT NOT NULL,
        "workspaceId" TEXT NOT NULL,
        "userId" TEXT NOT NULL,
        "key" TEXT NOT NULL,
        "unlockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT "Achievement_pkey" PRIMARY KEY ("id")
    );

    CREATE TABLE "Lead" (
        "id" TEXT NOT NULL,
        "workspaceId" TEXT NOT NULL,
        "contactId" TEXT NOT NULL,
        "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
        "source" TEXT,
        "ownerUserId" TEXT,
        "score" INTEGER NOT NULL DEFAULT 0,
        "scoreFactors" JSONB,
        "scoreComputedAt" TIMESTAMP(3),
        "category" "LeadCategory",
        "categoryReasons" JSONB,
        "categoryComputedAt" TIMESTAMP(3),
        "customFields" JSONB,
        "notes" TEXT,
        "convertedAt" TIMESTAMP(3),
        "convertedDealId" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
    );

    CREATE TABLE "Deal" (
        "id" TEXT NOT NULL,
        "workspaceId" TEXT NOT NULL,
        "leadId" TEXT,
        "contactId" TEXT NOT NULL,
        "title" TEXT NOT NULL,
        "value" DECIMAL(12,2),
        "currency" TEXT NOT NULL DEFAULT 'INR',
        "stage" "DealStage" NOT NULL DEFAULT 'QUALIFICATION',
        "ownerUserId" TEXT,
        "expectedCloseDate" TIMESTAMP(3),
        "closedAt" TIMESTAMP(3),
        "lostReason" TEXT,
        "customFields" JSONB,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT "Deal_pkey" PRIMARY KEY ("id")
    );

    CREATE TABLE "DealStageHistory" (
        "id" TEXT NOT NULL,
        "workspaceId" TEXT NOT NULL,
        "dealId" TEXT NOT NULL,
        "fromStage" "DealStage",
        "toStage" "DealStage" NOT NULL,
        "fromStageKey" TEXT,
        "toStageKey" TEXT,
        "changedByUserId" TEXT,
        "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT "DealStageHistory_pkey" PRIMARY KEY ("id")
    );

    CREATE TABLE "Task" (
        "id" TEXT NOT NULL,
        "workspaceId" TEXT NOT NULL,
        "title" TEXT NOT NULL,
        "description" TEXT,
        "status" "TaskStatus" NOT NULL DEFAULT 'PENDING',
        "dueDate" TIMESTAMP(3),
        "assignedToUserId" TEXT,
        "leadId" TEXT,
        "dealId" TEXT,
        "contactId" TEXT,
        "completedAt" TIMESTAMP(3),
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
    );

    CREATE TABLE "CrmActivity" (
        "id" TEXT NOT NULL,
        "workspaceId" TEXT NOT NULL,
        "type" "CrmActivityType" NOT NULL DEFAULT 'NOTE',
        "content" TEXT NOT NULL,
        "createdByUserId" TEXT,
        "leadId" TEXT,
        "dealId" TEXT,
        "contactId" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT "CrmActivity_pkey" PRIMARY KEY ("id")
    );

    CREATE TABLE "AgentTask" (
        "id" TEXT NOT NULL,
        "workspaceId" TEXT NOT NULL,
        "kind" TEXT NOT NULL,
        "targetType" TEXT NOT NULL,
        "targetId" TEXT NOT NULL,
        "status" "AgentTaskStatus" NOT NULL DEFAULT 'PENDING',
        "runAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "attempts" INTEGER NOT NULL DEFAULT 0,
        "lockedAt" TIMESTAMP(3),
        "lockedBy" TEXT,
        "lastError" TEXT,
        "reason" TEXT,
        "activeKey" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT "AgentTask_pkey" PRIMARY KEY ("id")
    );

    CREATE TABLE "AgentRun" (
        "id" TEXT NOT NULL,
        "workspaceId" TEXT NOT NULL,
        "taskId" TEXT,
        "targetType" TEXT NOT NULL,
        "targetId" TEXT NOT NULL,
        "summary" TEXT NOT NULL,
        "steps" JSONB NOT NULL,
        "applied" INTEGER NOT NULL DEFAULT 0,
        "withheld" INTEGER NOT NULL DEFAULT 0,
        "degraded" BOOLEAN NOT NULL DEFAULT false,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
    );

    CREATE TABLE "AgentFact" (
        "id" TEXT NOT NULL,
        "workspaceId" TEXT NOT NULL,
        "targetType" TEXT NOT NULL,
        "targetId" TEXT NOT NULL,
        "field" TEXT NOT NULL,
        "value" TEXT NOT NULL,
        "evidence" JSONB NOT NULL,
        "score" DOUBLE PRECISION NOT NULL,
        "band" "FactBand" NOT NULL,
        "applied" BOOLEAN NOT NULL DEFAULT false,
        "rationale" TEXT NOT NULL,
        "settledAt" TIMESTAMP(3),
        "settledBy" TEXT,
        "accepted" BOOLEAN,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT "AgentFact_pkey" PRIMARY KEY ("id")
    );

    CREATE TABLE "AuthenticationTransaction" (
        "id" TEXT NOT NULL,
        "workspaceId" TEXT NOT NULL,
        "templateId" TEXT NOT NULL,
        "waNumberId" TEXT NOT NULL,
        "phone" TEXT NOT NULL,
        "otpHash" TEXT,
        "source" TEXT NOT NULL DEFAULT 'CHATFLOW',
        "status" TEXT NOT NULL DEFAULT 'PENDING',
        "expiresAt" TIMESTAMP(3) NOT NULL,
        "metaMessageId" TEXT,
        "attempts" INTEGER NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "verifiedAt" TIMESTAMP(3),

        CONSTRAINT "AuthenticationTransaction_pkey" PRIMARY KEY ("id")
    );

    CREATE TABLE "_ContactSegments" (
        "A" TEXT NOT NULL,
        "B" TEXT NOT NULL
    );

    CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

    CREATE UNIQUE INDEX "User_googleId_key" ON "User"("googleId");

    CREATE UNIQUE INDEX "Invitation_tokenHash_key" ON "Invitation"("tokenHash");

    CREATE INDEX "Invitation_workspaceId_email_idx" ON "Invitation"("workspaceId", "email");

    CREATE INDEX "Invitation_workspaceId_status_idx" ON "Invitation"("workspaceId", "status");

    CREATE UNIQUE INDEX "NumberPool_phoneNumber_key" ON "NumberPool"("phoneNumber");

    CREATE INDEX "Template_headerAssetId_idx" ON "Template"("headerAssetId");

    CREATE INDEX "TemplateAsset_workspaceId_idx" ON "TemplateAsset"("workspaceId");

    CREATE UNIQUE INDEX "Contact_workspaceId_phoneNumber_key" ON "Contact"("workspaceId", "phoneNumber");

    CREATE INDEX "CampaignRecipient_status_nextRetryAt_idx" ON "CampaignRecipient"("status", "nextRetryAt");

    CREATE INDEX "CampaignRecipient_contactId_sentAt_idx" ON "CampaignRecipient"("contactId", "sentAt");

    CREATE UNIQUE INDEX "CampaignRecipient_campaignId_contactId_key" ON "CampaignRecipient"("campaignId", "contactId");

    CREATE INDEX "Conversation_workspaceId_contactId_waNumberId_idx" ON "Conversation"("workspaceId", "contactId", "waNumberId");

    CREATE INDEX "CampaignAiSession_conversationId_status_idx" ON "CampaignAiSession"("conversationId", "status");

    CREATE INDEX "CampaignAiSession_workspaceId_status_idx" ON "CampaignAiSession"("workspaceId", "status");

    CREATE INDEX "CampaignAiSession_campaignId_idx" ON "CampaignAiSession"("campaignId");

    CREATE UNIQUE INDEX "AutomationTrigger_workspaceId_keyword_key" ON "AutomationTrigger"("workspaceId", "keyword");

    CREATE INDEX "WorkflowRun_workspaceId_startedAt_idx" ON "WorkflowRun"("workspaceId", "startedAt");

    CREATE INDEX "WorkflowRun_workflowId_startedAt_idx" ON "WorkflowRun"("workflowId", "startedAt");

    CREATE UNIQUE INDEX "RefreshToken_token_key" ON "RefreshToken"("token");

    CREATE UNIQUE INDEX "WhatsappForm_workspaceId_keyword_key" ON "WhatsappForm"("workspaceId", "keyword");

    CREATE INDEX "WhatsappFormSubmission_workspaceId_formId_idx" ON "WhatsappFormSubmission"("workspaceId", "formId");

    CREATE INDEX "WhatsappFormSubmission_conversationId_completed_idx" ON "WhatsappFormSubmission"("conversationId", "completed");

    CREATE INDEX "InstagramFlow_workspaceId_isActive_idx" ON "InstagramFlow"("workspaceId", "isActive");

    CREATE INDEX "VoiceCall_workspaceId_startedAt_idx" ON "VoiceCall"("workspaceId", "startedAt");

    CREATE UNIQUE INDEX "VoiceCall_providerCallId_key" ON "VoiceCall"("providerCallId");

    CREATE UNIQUE INDEX "WalletTransaction_idempotencyKey_key" ON "WalletTransaction"("idempotencyKey");

    CREATE INDEX "WalletTransaction_workspaceId_createdAt_idx" ON "WalletTransaction"("workspaceId", "createdAt");

    CREATE INDEX "WalletTransaction_workspaceId_category_idx" ON "WalletTransaction"("workspaceId", "category");

    CREATE INDEX "OptOut_workspaceId_active_createdAt_idx" ON "OptOut"("workspaceId", "active", "createdAt");

    CREATE UNIQUE INDEX "OptOut_workspaceId_phoneNumber_key" ON "OptOut"("workspaceId", "phoneNumber");

    CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

    CREATE INDEX "Notification_workspaceId_createdAt_idx" ON "Notification"("workspaceId", "createdAt");

    CREATE INDEX "NotificationRead_userId_idx" ON "NotificationRead"("userId");

    CREATE UNIQUE INDEX "WorkspaceIntegration_workspaceId_provider_key" ON "WorkspaceIntegration"("workspaceId", "provider");

    CREATE INDEX "EmailOtp_email_purpose_idx" ON "EmailOtp"("email", "purpose");

    CREATE INDEX "WhatsAppAuthOtp_phone_purpose_idx" ON "WhatsAppAuthOtp"("phone", "purpose");

    CREATE UNIQUE INDEX "Plan_key_key" ON "Plan"("key");

    CREATE UNIQUE INDEX "Subscription_workspaceId_key" ON "Subscription"("workspaceId");

    CREATE UNIQUE INDEX "UsageCounter_workspaceId_periodStart_key" ON "UsageCounter"("workspaceId", "periodStart");

    CREATE INDEX "SupportTicket_status_createdAt_idx" ON "SupportTicket"("status", "createdAt");

    CREATE UNIQUE INDEX "Cluster_workspaceId_name_key" ON "Cluster"("workspaceId", "name");

    CREATE INDEX "Sequence_workspaceId_status_idx" ON "Sequence"("workspaceId", "status");

    CREATE INDEX "SequenceEnrollment_workspaceId_status_nextRunAt_idx" ON "SequenceEnrollment"("workspaceId", "status", "nextRunAt");

    CREATE UNIQUE INDEX "SequenceEnrollment_sequenceId_contactId_key" ON "SequenceEnrollment"("sequenceId", "contactId");

    CREATE INDEX "SequenceStepRun_workspaceId_enrollmentId_ranAt_idx" ON "SequenceStepRun"("workspaceId", "enrollmentId", "ranAt");

    CREATE INDEX "CustomFieldDefinition_workspaceId_entity_sortOrder_idx" ON "CustomFieldDefinition"("workspaceId", "entity", "sortOrder");

    CREATE UNIQUE INDEX "CustomFieldDefinition_workspaceId_entity_key_key" ON "CustomFieldDefinition"("workspaceId", "entity", "key");

    CREATE INDEX "Product_workspaceId_isActive_idx" ON "Product"("workspaceId", "isActive");

    CREATE INDEX "Product_workspaceId_category_idx" ON "Product"("workspaceId", "category");

    CREATE UNIQUE INDEX "Product_workspaceId_sku_key" ON "Product"("workspaceId", "sku");

    CREATE INDEX "DealLineItem_workspaceId_dealId_idx" ON "DealLineItem"("workspaceId", "dealId");

    CREATE INDEX "Quote_workspaceId_status_idx" ON "Quote"("workspaceId", "status");

    CREATE INDEX "Quote_workspaceId_dealId_idx" ON "Quote"("workspaceId", "dealId");

    CREATE UNIQUE INDEX "Quote_workspaceId_quoteNumber_key" ON "Quote"("workspaceId", "quoteNumber");

    CREATE INDEX "QuoteLineItem_workspaceId_quoteId_idx" ON "QuoteLineItem"("workspaceId", "quoteId");

    CREATE INDEX "PipelineStage_workspaceId_sortOrder_idx" ON "PipelineStage"("workspaceId", "sortOrder");

    CREATE UNIQUE INDEX "PipelineStage_workspaceId_key_key" ON "PipelineStage"("workspaceId", "key");

    CREATE INDEX "SavedView_workspaceId_entity_idx" ON "SavedView"("workspaceId", "entity");

    CREATE UNIQUE INDEX "SavedView_workspaceId_entity_createdByUserId_name_key" ON "SavedView"("workspaceId", "entity", "createdByUserId", "name");

    CREATE INDEX "Team_workspaceId_idx" ON "Team"("workspaceId");

    CREATE UNIQUE INDEX "Team_workspaceId_name_key" ON "Team"("workspaceId", "name");

    CREATE INDEX "TeamMember_userId_idx" ON "TeamMember"("userId");

    CREATE INDEX "LeadForm_workspaceId_isActive_idx" ON "LeadForm"("workspaceId", "isActive");

    CREATE UNIQUE INDEX "LeadForm_workspaceId_slug_key" ON "LeadForm"("workspaceId", "slug");

    CREATE INDEX "LeadFormSubmission_workspaceId_formId_createdAt_idx" ON "LeadFormSubmission"("workspaceId", "formId", "createdAt");

    CREATE INDEX "CrmTicket_workspaceId_status_dueAt_idx" ON "CrmTicket"("workspaceId", "status", "dueAt");

    CREATE INDEX "CrmTicket_workspaceId_ownerUserId_idx" ON "CrmTicket"("workspaceId", "ownerUserId");

    CREATE UNIQUE INDEX "CrmTicket_workspaceId_ticketNumber_key" ON "CrmTicket"("workspaceId", "ticketNumber");

    CREATE INDEX "XpEvent_workspaceId_userId_createdAt_idx" ON "XpEvent"("workspaceId", "userId", "createdAt");

    CREATE UNIQUE INDEX "XpEvent_userId_dedupeKey_key" ON "XpEvent"("userId", "dedupeKey");

    CREATE INDEX "Achievement_workspaceId_userId_idx" ON "Achievement"("workspaceId", "userId");

    CREATE UNIQUE INDEX "Achievement_userId_key_key" ON "Achievement"("userId", "key");

    CREATE UNIQUE INDEX "Lead_contactId_key" ON "Lead"("contactId");

    CREATE INDEX "Lead_workspaceId_status_idx" ON "Lead"("workspaceId", "status");

    CREATE INDEX "Lead_workspaceId_category_idx" ON "Lead"("workspaceId", "category");

    CREATE INDEX "Lead_workspaceId_score_idx" ON "Lead"("workspaceId", "score");

    CREATE INDEX "Lead_workspaceId_ownerUserId_idx" ON "Lead"("workspaceId", "ownerUserId");

    CREATE INDEX "Deal_workspaceId_stage_idx" ON "Deal"("workspaceId", "stage");

    CREATE INDEX "Deal_workspaceId_ownerUserId_idx" ON "Deal"("workspaceId", "ownerUserId");

    CREATE INDEX "Deal_workspaceId_leadId_idx" ON "Deal"("workspaceId", "leadId");

    CREATE INDEX "Deal_workspaceId_contactId_idx" ON "Deal"("workspaceId", "contactId");

    CREATE INDEX "DealStageHistory_workspaceId_dealId_changedAt_idx" ON "DealStageHistory"("workspaceId", "dealId", "changedAt");

    CREATE INDEX "Task_workspaceId_status_dueDate_idx" ON "Task"("workspaceId", "status", "dueDate");

    CREATE INDEX "Task_workspaceId_assignedToUserId_idx" ON "Task"("workspaceId", "assignedToUserId");

    CREATE INDEX "Task_workspaceId_leadId_idx" ON "Task"("workspaceId", "leadId");

    CREATE INDEX "Task_workspaceId_dealId_idx" ON "Task"("workspaceId", "dealId");

    CREATE INDEX "Task_workspaceId_contactId_idx" ON "Task"("workspaceId", "contactId");

    CREATE INDEX "CrmActivity_workspaceId_leadId_createdAt_idx" ON "CrmActivity"("workspaceId", "leadId", "createdAt");

    CREATE INDEX "CrmActivity_workspaceId_dealId_createdAt_idx" ON "CrmActivity"("workspaceId", "dealId", "createdAt");

    CREATE INDEX "CrmActivity_workspaceId_contactId_createdAt_idx" ON "CrmActivity"("workspaceId", "contactId", "createdAt");

    CREATE INDEX "AgentTask_workspaceId_status_runAfter_idx" ON "AgentTask"("workspaceId", "status", "runAfter");

    CREATE UNIQUE INDEX "AgentTask_workspaceId_activeKey_key" ON "AgentTask"("workspaceId", "activeKey");

    CREATE INDEX "AgentRun_workspaceId_targetType_targetId_createdAt_idx" ON "AgentRun"("workspaceId", "targetType", "targetId", "createdAt");

    CREATE INDEX "AgentFact_workspaceId_targetType_targetId_createdAt_idx" ON "AgentFact"("workspaceId", "targetType", "targetId", "createdAt");

    CREATE INDEX "AgentFact_workspaceId_band_applied_idx" ON "AgentFact"("workspaceId", "band", "applied");

    CREATE INDEX "AuthenticationTransaction_workspaceId_phone_status_idx" ON "AuthenticationTransaction"("workspaceId", "phone", "status");

    CREATE INDEX "AuthenticationTransaction_phone_expiresAt_idx" ON "AuthenticationTransaction"("phone", "expiresAt");

    CREATE UNIQUE INDEX "_ContactSegments_AB_unique" ON "_ContactSegments"("A", "B");

    CREATE INDEX "_ContactSegments_B_index" ON "_ContactSegments"("B");

    ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_invitedByUserId_fkey" FOREIGN KEY ("invitedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

    ALTER TABLE "WaNumber" ADD CONSTRAINT "WaNumber_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    ALTER TABLE "Template" ADD CONSTRAINT "Template_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    ALTER TABLE "Template" ADD CONSTRAINT "Template_waNumberId_fkey" FOREIGN KEY ("waNumberId") REFERENCES "WaNumber"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    ALTER TABLE "Template" ADD CONSTRAINT "Template_headerAssetId_fkey" FOREIGN KEY ("headerAssetId") REFERENCES "TemplateAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

    ALTER TABLE "TemplateAsset" ADD CONSTRAINT "TemplateAsset_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    ALTER TABLE "Contact" ADD CONSTRAINT "Contact_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

    ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_waNumberId_fkey" FOREIGN KEY ("waNumberId") REFERENCES "WaNumber"("id") ON DELETE SET NULL ON UPDATE CASCADE;

    ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    ALTER TABLE "CampaignRecipient" ADD CONSTRAINT "CampaignRecipient_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    ALTER TABLE "CampaignRecipient" ADD CONSTRAINT "CampaignRecipient_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_waNumberId_fkey" FOREIGN KEY ("waNumberId") REFERENCES "WaNumber"("id") ON DELETE SET NULL ON UPDATE CASCADE;

    ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_assignedToUserId_fkey" FOREIGN KEY ("assignedToUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

    ALTER TABLE "CampaignAiSession" ADD CONSTRAINT "CampaignAiSession_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    ALTER TABLE "CampaignAiSession" ADD CONSTRAINT "CampaignAiSession_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    ALTER TABLE "CampaignAiSession" ADD CONSTRAINT "CampaignAiSession_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    ALTER TABLE "CampaignAiSession" ADD CONSTRAINT "CampaignAiSession_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    ALTER TABLE "CampaignAiSession" ADD CONSTRAINT "CampaignAiSession_campaignRecipientId_fkey" FOREIGN KEY ("campaignRecipientId") REFERENCES "CampaignRecipient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

    ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    ALTER TABLE "Message" ADD CONSTRAINT "Message_senderUserId_fkey" FOREIGN KEY ("senderUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

    ALTER TABLE "Message" ADD CONSTRAINT "Message_campaignRecipientId_fkey" FOREIGN KEY ("campaignRecipientId") REFERENCES "CampaignRecipient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

    ALTER TABLE "AutomationTrigger" ADD CONSTRAINT "AutomationTrigger_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    ALTER TABLE "Workflow" ADD CONSTRAINT "Workflow_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    ALTER TABLE "WorkflowRun" ADD CONSTRAINT "WorkflowRun_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    ALTER TABLE "WorkflowRun" ADD CONSTRAINT "WorkflowRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    ALTER TABLE "WorkflowRun" ADD CONSTRAINT "WorkflowRun_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

    ALTER TABLE "WorkflowRun" ADD CONSTRAINT "WorkflowRun_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    ALTER TABLE "WorkflowRun" ADD CONSTRAINT "WorkflowRun_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    ALTER TABLE "WorkflowRun" ADD CONSTRAINT "WorkflowRun_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "CrmTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    ALTER TABLE "Segment" ADD CONSTRAINT "Segment_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    ALTER TABLE "WhatsappForm" ADD CONSTRAINT "WhatsappForm_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    ALTER TABLE "WhatsappFormSubmission" ADD CONSTRAINT "WhatsappFormSubmission_formId_fkey" FOREIGN KEY ("formId") REFERENCES "WhatsappForm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    ALTER TABLE "WhatsappFormSubmission" ADD CONSTRAINT "WhatsappFormSubmission_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    ALTER TABLE "InstagramFlow" ADD CONSTRAINT "InstagramFlow_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    ALTER TABLE "VoiceCall" ADD CONSTRAINT "VoiceCall_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    ALTER TABLE "OptOut" ADD CONSTRAINT "OptOut_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    ALTER TABLE "Notification" ADD CONSTRAINT "Notification_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    ALTER TABLE "NotificationRead" ADD CONSTRAINT "NotificationRead_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    ALTER TABLE "WorkspaceIntegration" ADD CONSTRAINT "WorkspaceIntegration_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

    ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_pendingPlanId_fkey" FOREIGN KEY ("pendingPlanId") REFERENCES "Plan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

    ALTER TABLE "UsageCounter" ADD CONSTRAINT "UsageCounter_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    ALTER TABLE "Cluster" ADD CONSTRAINT "Cluster_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    ALTER TABLE "ClusterContact" ADD CONSTRAINT "ClusterContact_clusterId_fkey" FOREIGN KEY ("clusterId") REFERENCES "Cluster"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    ALTER TABLE "ClusterContact" ADD CONSTRAINT "ClusterContact_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    ALTER TABLE "Sequence" ADD CONSTRAINT "Sequence_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    ALTER TABLE "SequenceEnrollment" ADD CONSTRAINT "SequenceEnrollment_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    ALTER TABLE "SequenceEnrollment" ADD CONSTRAINT "SequenceEnrollment_sequenceId_fkey" FOREIGN KEY ("sequenceId") REFERENCES "Sequence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    ALTER TABLE "SequenceEnrollment" ADD CONSTRAINT "SequenceEnrollment_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    ALTER TABLE "SequenceEnrollment" ADD CONSTRAINT "SequenceEnrollment_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

    ALTER TABLE "SequenceStepRun" ADD CONSTRAINT "SequenceStepRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    ALTER TABLE "SequenceStepRun" ADD CONSTRAINT "SequenceStepRun_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "SequenceEnrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    ALTER TABLE "CustomFieldDefinition" ADD CONSTRAINT "CustomFieldDefinition_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    ALTER TABLE "Product" ADD CONSTRAINT "Product_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    ALTER TABLE "DealLineItem" ADD CONSTRAINT "DealLineItem_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    ALTER TABLE "DealLineItem" ADD CONSTRAINT "DealLineItem_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    ALTER TABLE "DealLineItem" ADD CONSTRAINT "DealLineItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

    ALTER TABLE "Quote" ADD CONSTRAINT "Quote_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    ALTER TABLE "Quote" ADD CONSTRAINT "Quote_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

    ALTER TABLE "Quote" ADD CONSTRAINT "Quote_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

    ALTER TABLE "Quote" ADD CONSTRAINT "Quote_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

    ALTER TABLE "QuoteLineItem" ADD CONSTRAINT "QuoteLineItem_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    ALTER TABLE "QuoteLineItem" ADD CONSTRAINT "QuoteLineItem_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    ALTER TABLE "QuoteLineItem" ADD CONSTRAINT "QuoteLineItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

    ALTER TABLE "PipelineStage" ADD CONSTRAINT "PipelineStage_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    ALTER TABLE "SavedView" ADD CONSTRAINT "SavedView_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    ALTER TABLE "SavedView" ADD CONSTRAINT "SavedView_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

    ALTER TABLE "Team" ADD CONSTRAINT "Team_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    ALTER TABLE "LeadForm" ADD CONSTRAINT "LeadForm_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    ALTER TABLE "LeadForm" ADD CONSTRAINT "LeadForm_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

    ALTER TABLE "LeadFormSubmission" ADD CONSTRAINT "LeadFormSubmission_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    ALTER TABLE "LeadFormSubmission" ADD CONSTRAINT "LeadFormSubmission_formId_fkey" FOREIGN KEY ("formId") REFERENCES "LeadForm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    ALTER TABLE "LeadFormSubmission" ADD CONSTRAINT "LeadFormSubmission_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

    ALTER TABLE "CrmTicket" ADD CONSTRAINT "CrmTicket_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    ALTER TABLE "CrmTicket" ADD CONSTRAINT "CrmTicket_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

    ALTER TABLE "CrmTicket" ADD CONSTRAINT "CrmTicket_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

    ALTER TABLE "CrmTicket" ADD CONSTRAINT "CrmTicket_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

    ALTER TABLE "CrmTicket" ADD CONSTRAINT "CrmTicket_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

    ALTER TABLE "XpEvent" ADD CONSTRAINT "XpEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    ALTER TABLE "XpEvent" ADD CONSTRAINT "XpEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    ALTER TABLE "Achievement" ADD CONSTRAINT "Achievement_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    ALTER TABLE "Achievement" ADD CONSTRAINT "Achievement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    ALTER TABLE "Lead" ADD CONSTRAINT "Lead_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    ALTER TABLE "Lead" ADD CONSTRAINT "Lead_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    ALTER TABLE "Lead" ADD CONSTRAINT "Lead_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

    ALTER TABLE "Deal" ADD CONSTRAINT "Deal_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    ALTER TABLE "Deal" ADD CONSTRAINT "Deal_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

    ALTER TABLE "Deal" ADD CONSTRAINT "Deal_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    ALTER TABLE "Deal" ADD CONSTRAINT "Deal_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

    ALTER TABLE "DealStageHistory" ADD CONSTRAINT "DealStageHistory_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    ALTER TABLE "DealStageHistory" ADD CONSTRAINT "DealStageHistory_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    ALTER TABLE "DealStageHistory" ADD CONSTRAINT "DealStageHistory_changedByUserId_fkey" FOREIGN KEY ("changedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

    ALTER TABLE "Task" ADD CONSTRAINT "Task_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    ALTER TABLE "Task" ADD CONSTRAINT "Task_assignedToUserId_fkey" FOREIGN KEY ("assignedToUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

    ALTER TABLE "Task" ADD CONSTRAINT "Task_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

    ALTER TABLE "Task" ADD CONSTRAINT "Task_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

    ALTER TABLE "Task" ADD CONSTRAINT "Task_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

    ALTER TABLE "CrmActivity" ADD CONSTRAINT "CrmActivity_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    ALTER TABLE "CrmActivity" ADD CONSTRAINT "CrmActivity_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

    ALTER TABLE "CrmActivity" ADD CONSTRAINT "CrmActivity_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

    ALTER TABLE "CrmActivity" ADD CONSTRAINT "CrmActivity_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

    ALTER TABLE "CrmActivity" ADD CONSTRAINT "CrmActivity_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

    ALTER TABLE "AgentTask" ADD CONSTRAINT "AgentTask_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "AgentTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

    ALTER TABLE "AgentFact" ADD CONSTRAINT "AgentFact_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    ALTER TABLE "AuthenticationTransaction" ADD CONSTRAINT "AuthenticationTransaction_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    ALTER TABLE "_ContactSegments" ADD CONSTRAINT "_ContactSegments_A_fkey" FOREIGN KEY ("A") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    ALTER TABLE "_ContactSegments" ADD CONSTRAINT "_ContactSegments_B_fkey" FOREIGN KEY ("B") REFERENCES "Segment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
END
$baseline$;
