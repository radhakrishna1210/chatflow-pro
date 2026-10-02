-- Data-only: grant the new `campaignAi` feature flag (AI agent deploy/test and
-- intent matching) to every paid plan, so existing paying workspaces keep the
-- access they had before the flag was enforced. Boot seeding no longer
-- overwrites existing plans, so this is what updates rows already in the table.
UPDATE "Plan"
SET "features" = COALESCE("features", '{}'::jsonb) || '{"campaignAi": true}'::jsonb
WHERE "priceMonthly" > 0;
