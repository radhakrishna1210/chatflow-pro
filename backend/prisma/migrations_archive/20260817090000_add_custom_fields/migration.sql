-- CreateEnum
CREATE TYPE "CustomFieldType" AS ENUM ('TEXT', 'TEXTAREA', 'NUMBER', 'CURRENCY', 'DATE', 'BOOLEAN', 'DROPDOWN', 'MULTISELECT', 'URL', 'EMAIL', 'PHONE', 'USER');

-- AlterTable
ALTER TABLE "Deal" ADD COLUMN     "customFields" JSONB;

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "customFields" JSONB;

-- CreateTable
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

-- CreateIndex
CREATE INDEX "CustomFieldDefinition_workspaceId_entity_sortOrder_idx" ON "CustomFieldDefinition"("workspaceId", "entity", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "CustomFieldDefinition_workspaceId_entity_key_key" ON "CustomFieldDefinition"("workspaceId", "entity", "key");

-- AddForeignKey
ALTER TABLE "CustomFieldDefinition" ADD CONSTRAINT "CustomFieldDefinition_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

