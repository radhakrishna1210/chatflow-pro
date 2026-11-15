-- Per-workspace AI model, set by the platform super admin.
--
-- NULL means "use the platform default", so this changes nothing for any
-- existing workspace: every row starts NULL and keeps answering with the same
-- model it used before.
ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "aiModel" TEXT;
