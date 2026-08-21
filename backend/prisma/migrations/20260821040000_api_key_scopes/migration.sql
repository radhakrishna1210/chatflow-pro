-- Per-key permissions. Every API key previously had unrestricted access to the
-- whole workspace API, and the middleware granted each caller the ADMIN role
-- outright, so a key issued for a read-only script could launch campaigns.
ALTER TABLE "ApiKey" ADD COLUMN "scopes" JSONB;

-- Keys issued before scopes existed keep working exactly as they did: NULL is
-- read as "full access" so nobody's integration breaks on deploy. New keys are
-- always issued with an explicit scope list.

-- A key hash must identify at most one key; lookups already assume it.
CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON "ApiKey"("keyHash");
