-- RFC 7636 PKCE for the OAuth provider (CF-225).

-- A public client (SPA, mobile, desktop) has no secret; it proves possession
-- of the code with a PKCE code_verifier instead.
ALTER TABLE "OAuthClient" ADD COLUMN IF NOT EXISTS "publicClient" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "OAuthClient" ALTER COLUMN "clientSecretHash" DROP NOT NULL;

-- A confidential client must still have a secret.
ALTER TABLE "OAuthClient" DROP CONSTRAINT IF EXISTS "OAuthClient_secret_or_public_check";
ALTER TABLE "OAuthClient" ADD CONSTRAINT "OAuthClient_secret_or_public_check"
  CHECK ("publicClient" OR "clientSecretHash" IS NOT NULL);

-- The challenge an authorization code was issued against.
ALTER TABLE "OAuthAuthorizationCode" ADD COLUMN IF NOT EXISTS "codeChallenge" TEXT;
ALTER TABLE "OAuthAuthorizationCode" ADD COLUMN IF NOT EXISTS "codeChallengeMethod" TEXT;
