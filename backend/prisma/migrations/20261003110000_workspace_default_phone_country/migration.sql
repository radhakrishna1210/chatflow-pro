-- CF-200: contact numbers are normalised to E.164 on write. A number typed
-- without a country code takes the workspace's default country.
-- Existing rows are rewritten by scripts/backfill-contact-phones.js (it reports
-- numbers that collapse onto another contact instead of merging them).
ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "defaultPhoneCountry" TEXT NOT NULL DEFAULT 'IN';
