-- Add-ons become real purchases.
--
-- They were fictional: the Payments screen listed four with prices hardcoded in
-- the JSX, and "Add to Plan" wrote a boolean to localStorage. No order, no
-- payment, nothing server-side — so the price shown could never match the
-- gateway, because the gateway was never called.
CREATE TABLE "WorkspaceAddon" (
  "id"               TEXT NOT NULL,
  "workspaceId"      TEXT NOT NULL,
  "addonKey"         TEXT NOT NULL,
  "status"           TEXT NOT NULL DEFAULT 'ACTIVE',
  "amountPaid"       DECIMAL(10,2) NOT NULL,
  "currency"         TEXT NOT NULL DEFAULT 'INR',
  "gateway"          TEXT,
  "reference"        TEXT,
  "activatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "cancelledAt"      TIMESTAMP(3),
  "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WorkspaceAddon_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkspaceAddon_workspaceId_addonKey_key" ON "WorkspaceAddon"("workspaceId", "addonKey");
CREATE INDEX "WorkspaceAddon_workspaceId_status_idx" ON "WorkspaceAddon"("workspaceId", "status");

ALTER TABLE "WorkspaceAddon" ADD CONSTRAINT "WorkspaceAddon_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
