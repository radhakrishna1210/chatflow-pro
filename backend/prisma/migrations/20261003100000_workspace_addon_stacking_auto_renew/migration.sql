-- CF-030: add-on packs stack (one row per purchased pack) and can auto-renew
-- from the wallet. Existing rows stay as they are: each becomes one pack with
-- auto-renew off.
DROP INDEX IF EXISTS "WorkspaceAddon_workspaceId_addonKey_key";

ALTER TABLE "WorkspaceAddon" ADD COLUMN "autoRenew" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "WorkspaceAddon" ADD COLUMN "renewedAt" TIMESTAMP(3);
ALTER TABLE "WorkspaceAddon" ADD COLUMN "expiredAt" TIMESTAMP(3);

CREATE INDEX "WorkspaceAddon_workspaceId_addonKey_idx" ON "WorkspaceAddon"("workspaceId", "addonKey");
CREATE INDEX "WorkspaceAddon_status_currentPeriodEnd_idx" ON "WorkspaceAddon"("status", "currentPeriodEnd");
