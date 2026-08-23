-- Remove the retired STARTER / PRO / ENTERPRISE plan rows.
--
-- 20260804010000 moved every subscriber onto BASIC/GROWTH and deactivated
-- these three, but left the rows in place because Subscription.planId and
-- pendingPlanId still referenced them at that point. With no references left
-- they are dead weight that still renders in the admin Plans tab, so they go.
--
-- The NOT EXISTS guards make this safe regardless of what any given database
-- looks like: if some environment somehow still has a subscription pointing at
-- one of these plans, that plan is left alone rather than the delete failing
-- on a foreign key and blocking the whole migration.

DELETE FROM "Plan" p
WHERE p."key" IN ('STARTER', 'PRO', 'ENTERPRISE')
  AND NOT EXISTS (SELECT 1 FROM "Subscription" s WHERE s."planId" = p."id")
  AND NOT EXISTS (SELECT 1 FROM "Subscription" s WHERE s."pendingPlanId" = p."id");
