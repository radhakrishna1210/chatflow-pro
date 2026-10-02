-- Workflow runs: a CANCELLED terminal status, a persisted resume time for the
-- recovery sweep, and a version counter for atomic claims.
--
-- WorkflowRunStatus / WorkflowRun were created outside the migration history
-- (db push), so these statements use IF NOT EXISTS to stay safe on databases
-- where the baseline was applied by hand.

-- AlterEnum
ALTER TYPE "WorkflowRunStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';

-- AlterTable
ALTER TABLE "WorkflowRun" ADD COLUMN IF NOT EXISTS "resumeAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "WorkflowRun_status_resumeAt_idx" ON "WorkflowRun"("status", "resumeAt");
