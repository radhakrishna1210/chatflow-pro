-- ChatFlow as an OAuth authorization server.
--
-- Everything called "OAuth" here until now was inbound — ChatFlow as a client of
-- Google, Meta or Instagram. These three tables are the other direction: another
-- application asks a ChatFlow user for permission, and receives a scoped ApiKey
-- instead of the user copying one out of Settings by hand.
--
-- The first client is Spandan (the voice-agent platform). It is a row, not a
-- constant, so a second application never needs a code change.
--
-- Written by hand rather than generated: this database has drifted from the
-- schema in this branch (see OPEN_ISSUES.md OPEN-002 — tables and columns from
-- another branch are live here), so `prisma migrate diff` emits DROP statements
-- for another branch's data and cannot be trusted. Everything below is additive
-- and IF NOT EXISTS, so it is safe to re-run.

CREATE TABLE IF NOT EXISTS "OAuthClient" (
  "id"               TEXT NOT NULL,
  "clientId"         TEXT NOT NULL,
  -- sha256, exactly like ApiKey.keyHash: this side only ever verifies a secret
  -- the client sends, never reproduces one, so storing it reversibly would be
  -- strictly worse for no benefit.
  "clientSecretHash" TEXT NOT NULL,
  "name"             TEXT NOT NULL,
  -- string[] of candidate redirect URIs, compared by EXACT STRING. Anything
  -- looser (prefix, same-origin) lets an attacker point the authorization
  -- response at a listener they control.
  "redirectUris"     JSONB NOT NULL,
  -- string[] ceiling on what this client may ever request.
  "allowedScopes"    JSONB NOT NULL,
  "disabledAt"       TIMESTAMP(3),
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OAuthClient_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "OAuthClient_clientId_key" ON "OAuthClient"("clientId");
CREATE UNIQUE INDEX IF NOT EXISTS "OAuthClient_clientSecretHash_key" ON "OAuthClient"("clientSecretHash");

-- Short-lived, single-use codes exchanged for an API key.
--
-- In the database rather than the Redis/Map store the Google-login flow uses:
-- there the browser redeems its own code seconds later on the same origin, here
-- the redeemer is a different process, the in-memory fallback is per-process,
-- and a deploy landing between authorize and exchange would silently break a
-- connect. One row per connect attempt is nothing, and it leaves a trail.
CREATE TABLE IF NOT EXISTS "OAuthAuthorizationCode" (
  "id"          TEXT NOT NULL,
  "code"        TEXT NOT NULL,
  "clientId"    TEXT NOT NULL,
  "userId"      TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  -- Re-checked at exchange against the value presented at the token endpoint.
  "redirectUri" TEXT NOT NULL,
  "scopes"      JSONB NOT NULL,
  "expiresAt"   TIMESTAMP(3) NOT NULL,
  "consumedAt"  TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OAuthAuthorizationCode_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "OAuthAuthorizationCode_code_key" ON "OAuthAuthorizationCode"("code");
CREATE INDEX IF NOT EXISTS "OAuthAuthorizationCode_expiresAt_idx" ON "OAuthAuthorizationCode"("expiresAt");

-- What a user has already approved, per workspace and application. Lets a
-- reconnect skip the consent screen, and gives a future "Connected apps" page
-- something to list and revoke.
CREATE TABLE IF NOT EXISTS "OAuthConsent" (
  "id"          TEXT NOT NULL,
  "userId"      TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "clientId"    TEXT NOT NULL,
  "scopes"      JSONB NOT NULL,
  "revokedAt"   TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OAuthConsent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "OAuthConsent_userId_workspaceId_clientId_key" ON "OAuthConsent"("userId", "workspaceId", "clientId");
CREATE INDEX IF NOT EXISTS "OAuthConsent_workspaceId_idx" ON "OAuthConsent"("workspaceId");

-- Foreign keys. Dropped first so this migration can be re-run against a database
-- where an earlier attempt got partway.
ALTER TABLE "OAuthAuthorizationCode" DROP CONSTRAINT IF EXISTS "OAuthAuthorizationCode_clientId_fkey";
ALTER TABLE "OAuthAuthorizationCode" ADD CONSTRAINT "OAuthAuthorizationCode_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "OAuthClient"("clientId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OAuthAuthorizationCode" DROP CONSTRAINT IF EXISTS "OAuthAuthorizationCode_workspaceId_fkey";
ALTER TABLE "OAuthAuthorizationCode" ADD CONSTRAINT "OAuthAuthorizationCode_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OAuthConsent" DROP CONSTRAINT IF EXISTS "OAuthConsent_clientId_fkey";
ALTER TABLE "OAuthConsent" ADD CONSTRAINT "OAuthConsent_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "OAuthClient"("clientId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OAuthConsent" DROP CONSTRAINT IF EXISTS "OAuthConsent_workspaceId_fkey";
ALTER TABLE "OAuthConsent" ADD CONSTRAINT "OAuthConsent_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
