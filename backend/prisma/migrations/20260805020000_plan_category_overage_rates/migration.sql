-- Per-category overage pricing on a plan.
--
-- overageRatePerMsg was a single legacy figure (0.02 / 0.01 / 0.008) inherited
-- from USD-era pricing. With messages costing INR 1.09 (marketing), 0.16
-- (utility) and 0.13 (authentication), an over-quota send was billed at well
-- under a hundredth of its cost — a loss on every message.
--
-- overageRates is an optional per-plan override:
--   NULL  -> charge cost, i.e. the shared rates in lib/messagePricing.js.
--            Basic and Growth use this, so they track cost automatically.
--   {...} -> an explicit map, e.g. Free's markup.
--
-- overageRatePerMsg is kept, but now only applies to a send with no template
-- category at all (an inbox reply), so existing values stay meaningful.

ALTER TABLE "Plan"
  ADD COLUMN IF NOT EXISTS "overageRates" JSONB;

-- Free bills over-quota template sends at 2x cost, mirroring the 2x ratio it
-- already carried against the paid tiers (0.02 vs 0.01).
UPDATE "Plan"
   SET "overageRates" = '{"MARKETING": 2.18, "UTILITY": 0.32, "AUTHENTICATION": 0.26}'::jsonb
 WHERE "key" = 'FREE'
   AND "overageRates" IS NULL;

-- Basic and Growth are left NULL on purpose: that is what "charge cost" means,
-- and it keeps them in step with MESSAGE_CATEGORY_RATES with nothing to re-seed.
