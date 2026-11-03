-- Extra CSV columns (price, city, ...) stored per contact, and the per-campaign
-- choice of which contact value fills each template variable.
ALTER TABLE "Contact" ADD COLUMN "attributes" JSONB;
ALTER TABLE "Campaign" ADD COLUMN "variableMapping" JSONB;
