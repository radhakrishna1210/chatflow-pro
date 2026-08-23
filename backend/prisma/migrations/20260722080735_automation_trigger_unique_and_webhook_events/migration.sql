-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "webhookEvents" JSONB;

-- CreateIndex
CREATE UNIQUE INDEX "AutomationTrigger_workspaceId_keyword_key" ON "AutomationTrigger"("workspaceId", "keyword");
