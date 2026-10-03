-- WF-IN-12: when the inbound automation pipeline finished with a message.
-- A webhook retry that finds the message stored but this unset (and the row
-- is under an hour old) resumes the automation instead of dropping it as a
-- duplicate delivery.
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "automationProcessedAt" TIMESTAMP(3);

-- Recent inbound messages were already handled by the previous release; mark
-- them so a redelivery straddling the deploy does not run their automation a
-- second time. Older rows are never resumed (the window is one hour), so they
-- are left alone rather than rewriting the whole table.
UPDATE "Message" SET "automationProcessedAt" = "createdAt"
WHERE "direction" = 'INBOUND'
  AND "automationProcessedAt" IS NULL
  AND "createdAt" > NOW() - INTERVAL '2 hours';
