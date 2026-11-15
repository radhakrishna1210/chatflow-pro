-- Today's stock for an order form: a quantity available per quantity question,
-- counted down by completed orders (services/whatsappFormStock.service.js).
-- A new table only: nothing existing is altered, and a form without a row
-- here takes orders without limits, as before.
CREATE TABLE "WhatsappFormStock" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "limits" JSONB NOT NULL DEFAULT '{}',
    "countFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "soldOutMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsappFormStock_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WhatsappFormStock_formId_key" ON "WhatsappFormStock"("formId");

CREATE INDEX "WhatsappFormStock_workspaceId_idx" ON "WhatsappFormStock"("workspaceId");

ALTER TABLE "WhatsappFormStock" ADD CONSTRAINT "WhatsappFormStock_formId_fkey"
    FOREIGN KEY ("formId") REFERENCES "WhatsappForm"("id") ON DELETE CASCADE ON UPDATE CASCADE;
