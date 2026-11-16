-- Owner approval for an order form (services/formOrder.service.js): the
-- settings per form, and each order's progress through approval and payment.
-- New tables only: nothing existing is altered, and a form without a
-- WhatsappFormOrderFlow row confirms orders straight away, as before.
CREATE TABLE "WhatsappFormOrderFlow" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "ownerPhone" TEXT,
    "upiId" TEXT,
    "payeeName" TEXT,
    "bankDetails" TEXT,
    "qrImage" BYTEA,
    "qrMime" TEXT,
    "replyMinutes" INTEGER NOT NULL DEFAULT 60,
    "paymentMinutes" INTEGER NOT NULL DEFAULT 120,
    "cutoffTime" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsappFormOrderFlow_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WhatsappFormOrderFlow_formId_key" ON "WhatsappFormOrderFlow"("formId");

CREATE INDEX "WhatsappFormOrderFlow_workspaceId_idx" ON "WhatsappFormOrderFlow"("workspaceId");

ALTER TABLE "WhatsappFormOrderFlow" ADD CONSTRAINT "WhatsappFormOrderFlow_formId_fkey"
    FOREIGN KEY ("formId") REFERENCES "WhatsappForm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "WhatsappFormOrder" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_OWNER',
    "cancelReason" TEXT,
    "total" DOUBLE PRECISION,
    "expiresAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsappFormOrder_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WhatsappFormOrder_submissionId_key" ON "WhatsappFormOrder"("submissionId");

CREATE INDEX "WhatsappFormOrder_workspaceId_formId_createdAt_idx" ON "WhatsappFormOrder"("workspaceId", "formId", "createdAt");

CREATE INDEX "WhatsappFormOrder_status_expiresAt_idx" ON "WhatsappFormOrder"("status", "expiresAt");

CREATE INDEX "WhatsappFormOrder_contactId_status_idx" ON "WhatsappFormOrder"("contactId", "status");

ALTER TABLE "WhatsappFormOrder" ADD CONSTRAINT "WhatsappFormOrder_formId_fkey"
    FOREIGN KEY ("formId") REFERENCES "WhatsappForm"("id") ON DELETE CASCADE ON UPDATE CASCADE;
