-- How deep a workflow run sits in a chain of CRM-triggered workflows, so a
-- run resumed after a delay is still held to MAX_CHAIN_DEPTH.
--
-- WorkflowRun was created outside the migration history (db push), so the
-- statement uses IF NOT EXISTS like 20261002150000_workflow_run_resume_and_cancel.

-- AlterTable
ALTER TABLE "WorkflowRun" ADD COLUMN IF NOT EXISTS "chainDepth" INTEGER NOT NULL DEFAULT 0;
