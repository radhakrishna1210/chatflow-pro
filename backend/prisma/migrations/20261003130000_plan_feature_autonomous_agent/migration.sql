-- Data-only: grant the new `autonomousAgent` feature flag (the autonomous CRM
-- agent: its sweep, on-demand runs and task retries) to every paid plan, so
-- existing paying workspaces keep the agent they had before the flag was
-- enforced. Free does not get it; the sweep now skips workspaces whose plan
-- lacks it. Boot seeding no longer overwrites existing plans, so this is what
-- updates rows already in the table.
UPDATE "Plan"
SET "features" = COALESCE("features", '{}'::jsonb) || '{"autonomousAgent": true}'::jsonb
WHERE "priceMonthly" > 0;
