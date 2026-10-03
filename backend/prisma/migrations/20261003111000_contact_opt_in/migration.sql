-- CF-070: consent given on a public lead form is copied onto the Contact as
-- WhatsApp opt-in evidence (it used to live only on the submission row).
ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "optInAt" TIMESTAMP(3);
ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "optInSource" TEXT;
ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "optInText" TEXT;
ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "optInIpHash" TEXT;

-- Contacts with a consented form submission get the most recent one;
-- opted-out contacts are left alone.
UPDATE "Contact" c
SET "optInAt" = s."consentAt",
    "optInSource" = 'lead_form:' || f."slug",
    "optInText" = s."consentText",
    "optInIpHash" = s."ipHash"
FROM (
  SELECT DISTINCT ON ("contactId") "contactId", "formId", "consentAt", "consentText", "ipHash"
  FROM "LeadFormSubmission"
  WHERE "contactId" IS NOT NULL AND "consentAt" IS NOT NULL
  ORDER BY "contactId", "consentAt" DESC
) s
JOIN "LeadForm" f ON f."id" = s."formId"
WHERE c."id" = s."contactId" AND c."optInAt" IS NULL AND c."optedOut" = false;
