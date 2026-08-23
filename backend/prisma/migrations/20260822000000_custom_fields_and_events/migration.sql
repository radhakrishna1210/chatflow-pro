-- Storage for the two add-ons that were purchasable while nothing implemented
-- them: "Pack of 5 Custom Fields" and "Pack of 3 Custom Events". Until now
-- there was no definition table, no value column, and no code reading either,
-- so buying them granted the workspace nothing at all.

CREATE TABLE "WorkspaceCustomField" (
  "id"          TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "key"         TEXT NOT NULL,
  "label"       TEXT NOT NULL,
  "type"        TEXT NOT NULL DEFAULT 'TEXT',
  "options"     JSONB,
  "sortOrder"   INTEGER NOT NULL DEFAULT 0,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkspaceCustomField_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WorkspaceCustomField_workspaceId_key_key" ON "WorkspaceCustomField"("workspaceId", "key");
CREATE INDEX "WorkspaceCustomField_workspaceId_sortOrder_idx" ON "WorkspaceCustomField"("workspaceId", "sortOrder");
ALTER TABLE "WorkspaceCustomField" ADD CONSTRAINT "WorkspaceCustomField_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "WorkspaceCustomEvent" (
  "id"          TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "key"         TEXT NOT NULL,
  "label"       TEXT NOT NULL,
  "description" TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt"  TIMESTAMP(3),
  "seenCount"   INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "WorkspaceCustomEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WorkspaceCustomEvent_workspaceId_key_key" ON "WorkspaceCustomEvent"("workspaceId", "key");
ALTER TABLE "WorkspaceCustomEvent" ADD CONSTRAINT "WorkspaceCustomEvent_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Values, keyed by WorkspaceCustomField.key.
ALTER TABLE "Contact" ADD COLUMN "customFields" JSONB;
