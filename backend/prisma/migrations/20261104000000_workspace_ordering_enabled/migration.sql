-- Per-workspace switch for "Orders with per-customer prices" (lib/ordering.js).
-- Off for every existing workspace.
ALTER TABLE "Workspace" ADD COLUMN "orderingEnabled" BOOLEAN NOT NULL DEFAULT false;
