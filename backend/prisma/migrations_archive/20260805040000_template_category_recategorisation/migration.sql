-- Track Meta re-categorising an approved template.
--
-- Meta re-reviews templates after approval and moves them between categories,
-- most often UTILITY -> MARKETING. On the workspace's own per-category rates
-- that is INR 0.16 -> INR 1.09 per message, a ~7x rise that previously
-- happened invisibly: nothing consumed the message_template_category_update
-- webhook, so the stored category stayed stale and campaigns kept quoting the
-- old price.
--
-- Both columns are nullable with no default, so existing templates are
-- unaffected and code deployed before this migration still runs.

ALTER TABLE "Template"
  ADD COLUMN IF NOT EXISTS "previousCategory"  TEXT,
  ADD COLUMN IF NOT EXISTS "categoryUpdatedAt" TIMESTAMP(3);
