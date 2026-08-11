-- Contacts recorded when they were created but never when they last changed,
-- so the contact list could not offer "Recently Updated" as a sort at all.
--
-- Backfilled from "createdAt" rather than CURRENT_TIMESTAMP: defaulting every
-- existing row to "now" would claim the whole address book was touched at
-- migration time, which makes the first "Recently Updated" sort meaningless
-- and is the one thing this column exists to answer.

ALTER TABLE "Contact"
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);

UPDATE "Contact" SET "updatedAt" = "createdAt" WHERE "updatedAt" IS NULL;

ALTER TABLE "Contact"
  ALTER COLUMN "updatedAt" SET NOT NULL,
  ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;

-- Sorting the list by recency scans this on every page.
CREATE INDEX IF NOT EXISTS "Contact_workspaceId_updatedAt_idx"
  ON "Contact" ("workspaceId", "updatedAt");
