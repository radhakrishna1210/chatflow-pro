-- Meta's stated reason for rejecting a template.
--
-- The status sync stored only REJECTED, so the builder could say a template was
-- refused but never why, and the user had to open Business Manager to find out.
-- Meta returns this on the template edge as `rejected_reason`; it is now read
-- and kept alongside the status.
--
-- Nullable with no default, so existing rows are unaffected and code deployed
-- before this migration still runs.

ALTER TABLE "Template"
  ADD COLUMN IF NOT EXISTS "rejectedReason" TEXT;
