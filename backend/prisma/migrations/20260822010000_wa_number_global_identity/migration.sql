-- A WhatsApp number belongs to exactly one workspace, globally.
--
-- The previous constraint was (workspaceId, metaPhoneNumberId), which only
-- stopped one workspace connecting the same number twice. Across workspaces two
-- tenants could claim the same phone number id — and the inbound handler
-- resolves the number with findFirst({ metaPhoneNumberId }) and no workspace to
-- scope by, so whichever row was found first received the other tenant's
-- customer messages.
DROP INDEX IF EXISTS "WaNumber_workspaceId_metaPhoneNumberId_key";
CREATE UNIQUE INDEX "WaNumber_metaPhoneNumberId_key" ON "WaNumber"("metaPhoneNumberId");
