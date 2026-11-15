-- A WhatsApp Form published as a WhatsApp Flow (one screen with a Submit
-- button) instead of one question per message. See lib/formFlowScreen.js.
-- A new table only: nothing existing is altered, and forms without a row here
-- keep working the chat way.
CREATE TABLE "WhatsappFormScreen" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "wabaId" TEXT NOT NULL,
    "metaFlowId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'FAILED',
    "fingerprint" TEXT,
    "error" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsappFormScreen_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WhatsappFormScreen_formId_key" ON "WhatsappFormScreen"("formId");

CREATE INDEX "WhatsappFormScreen_workspaceId_idx" ON "WhatsappFormScreen"("workspaceId");

ALTER TABLE "WhatsappFormScreen" ADD CONSTRAINT "WhatsappFormScreen_formId_fkey"
    FOREIGN KEY ("formId") REFERENCES "WhatsappForm"("id") ON DELETE CASCADE ON UPDATE CASCADE;
