-- Link only campaign-dispatched OTPs to their originating campaign. Existing
-- public Authentication API transactions remain null and therefore cannot
-- appear in campaign analytics.
ALTER TABLE "AuthenticationTransaction" ADD COLUMN "campaignId" TEXT;

CREATE INDEX "AuthenticationTransaction_campaignId_status_idx"
  ON "AuthenticationTransaction"("campaignId", "status");

ALTER TABLE "AuthenticationTransaction"
  ADD CONSTRAINT "AuthenticationTransaction_campaignId_fkey"
  FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
