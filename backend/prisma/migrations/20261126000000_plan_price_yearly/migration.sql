-- Yearly billing for plans: a third, optional price beside the monthly and
-- quarterly ones. Additive and nullable — every existing plan keeps working
-- as it does today until a yearly price is set on it.
ALTER TABLE "Plan" ADD COLUMN "priceYearly" DECIMAL(10,2);
