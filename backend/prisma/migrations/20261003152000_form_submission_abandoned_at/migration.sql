-- WF-IN-7: a WhatsApp form submission given up on rather than finished.
ALTER TABLE "WhatsappFormSubmission" ADD COLUMN IF NOT EXISTS "abandonedAt" TIMESTAMP(3);

-- Open submissions that have sat for more than a day, or whose form is no
-- longer Active, captured every later message on their conversation. Close
-- them now rather than on the customer's next message.
UPDATE "WhatsappFormSubmission" s
SET "completed" = true, "completedAt" = NOW(), "abandonedAt" = NOW()
FROM "WhatsappForm" f
WHERE f."id" = s."formId"
  AND s."completed" = false
  AND (s."updatedAt" < NOW() - INTERVAL '24 hours' OR f."status" <> 'Active');
