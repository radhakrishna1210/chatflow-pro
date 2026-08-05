-- INR plan catalog (Free / Basic / Growth) + quarterly billing option.
--
-- Basic carries the former Pro limits and features, Growth the former
-- Enterprise ones. STARTER/PRO/ENTERPRISE are retired rather than deleted:
-- Subscription.planId and Subscription.pendingPlanId still reference them, so
-- a DELETE would violate those foreign keys and destroy billing history.
-- Their subscribers are moved to BASIC first, so no subscription is left
-- pointing at a plan that can no longer be renewed or displayed.
--
-- src/server.js performs the same reconciliation on every boot, so this
-- migration and the running app converge on the same catalog either way.

-- ── Quarterly price (null = sold monthly only) ──────────────────────────────
ALTER TABLE "Plan"
  ADD COLUMN IF NOT EXISTS "priceQuarterly" DECIMAL(10,2);

-- ── Plans are priced in INR now, not USD ────────────────────────────────────
ALTER TABLE "Plan" ALTER COLUMN "currency" SET DEFAULT 'INR';
UPDATE "Plan" SET "currency" = 'INR' WHERE "currency" = 'USD';

-- ── Free stays; only its currency changed above ─────────────────────────────

-- ── Basic: former Pro limits/features at INR 1500/mo, 3500/quarter ─────────
INSERT INTO "Plan" ("id", "key", "name", "priceMonthly", "priceQuarterly", "currency",
                    "messageQuota", "contactLimit", "memberLimit", "campaignLimit",
                    "apiKeyLimit", "overageRatePerMsg", "features", "isActive", "createdAt")
VALUES ('plan_basic_inr', 'BASIC', 'Basic', 1500, 3500, 'INR',
        10000, NULL, 10, NULL, 10, 0.0100,
        '{"automation": true, "workflows": true, "aiOnboarding": true, "integrations": true}'::jsonb,
        true, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO UPDATE SET
  "name" = EXCLUDED."name", "priceMonthly" = EXCLUDED."priceMonthly",
  "priceQuarterly" = EXCLUDED."priceQuarterly", "currency" = EXCLUDED."currency",
  "messageQuota" = EXCLUDED."messageQuota", "contactLimit" = EXCLUDED."contactLimit",
  "memberLimit" = EXCLUDED."memberLimit", "campaignLimit" = EXCLUDED."campaignLimit",
  "apiKeyLimit" = EXCLUDED."apiKeyLimit", "overageRatePerMsg" = EXCLUDED."overageRatePerMsg",
  "features" = EXCLUDED."features", "isActive" = true;

-- ── Growth: former Enterprise limits/features at INR 2500/mo, 7500/quarter ──
INSERT INTO "Plan" ("id", "key", "name", "priceMonthly", "priceQuarterly", "currency",
                    "messageQuota", "contactLimit", "memberLimit", "campaignLimit",
                    "apiKeyLimit", "overageRatePerMsg", "features", "isActive", "createdAt")
VALUES ('plan_growth_inr', 'GROWTH', 'Growth', 2500, 7500, 'INR',
        -1, NULL, NULL, NULL, NULL, 0.0080,
        '{"automation": true, "workflows": true, "aiOnboarding": true, "integrations": true}'::jsonb,
        true, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO UPDATE SET
  "name" = EXCLUDED."name", "priceMonthly" = EXCLUDED."priceMonthly",
  "priceQuarterly" = EXCLUDED."priceQuarterly", "currency" = EXCLUDED."currency",
  "messageQuota" = EXCLUDED."messageQuota", "contactLimit" = EXCLUDED."contactLimit",
  "memberLimit" = EXCLUDED."memberLimit", "campaignLimit" = EXCLUDED."campaignLimit",
  "apiKeyLimit" = EXCLUDED."apiKeyLimit", "overageRatePerMsg" = EXCLUDED."overageRatePerMsg",
  "features" = EXCLUDED."features", "isActive" = true;

-- ── Move every subscriber off the retired tiers before deactivating them ────
-- Each workspace lands on the plan that inherited its old tier's limits and
-- features, so nobody loses capability in the move: Starter/Pro carried the
-- limits Basic now has, and Enterprise the ones Growth now has.
UPDATE "Subscription" SET "planId" = (SELECT "id" FROM "Plan" WHERE "key" = 'BASIC')
WHERE "planId" IN (SELECT "id" FROM "Plan" WHERE "key" IN ('STARTER', 'PRO'));

UPDATE "Subscription" SET "planId" = (SELECT "id" FROM "Plan" WHERE "key" = 'GROWTH')
WHERE "planId" IN (SELECT "id" FROM "Plan" WHERE "key" = 'ENTERPRISE');

-- A scheduled change to a retired plan could never be applied at rollover.
UPDATE "Subscription" SET "pendingPlanId" = NULL
WHERE "pendingPlanId" IN (SELECT "id" FROM "Plan" WHERE "key" IN ('STARTER', 'PRO', 'ENTERPRISE'));

UPDATE "Plan" SET "isActive" = false WHERE "key" IN ('STARTER', 'PRO', 'ENTERPRISE');
