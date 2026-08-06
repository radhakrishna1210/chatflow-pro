-- Shareable invite links, alongside the existing email invitations.
--
-- An email invite names exactly who may accept it: the address is stored and
-- checked against the accepting account. A link invite has no address — that
-- is the point — so `email` becomes nullable and `kind` records which of the
-- two an invitation is, rather than inferring it from a null.
--
-- Links are also reusable, which email invites never are: `maxUses` caps how
-- many people can join through one (null = unlimited until it expires or is
-- revoked) and `useCount` tracks how many have. An email invite leaves
-- maxUses null and simply moves to ACCEPTED on its single use.
--
-- Existing rows are all email invitations, so `kind` backfills to EMAIL via
-- the column default and nothing else has to change.

DO $$ BEGIN
  CREATE TYPE "InviteKind" AS ENUM ('EMAIL', 'LINK');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "Invitation"
  ADD COLUMN IF NOT EXISTS "kind"     "InviteKind" NOT NULL DEFAULT 'EMAIL',
  ADD COLUMN IF NOT EXISTS "maxUses"  INTEGER,
  ADD COLUMN IF NOT EXISTS "useCount" INTEGER NOT NULL DEFAULT 0;

-- Safe to relax unconditionally: dropping NOT NULL cannot invalidate any
-- existing row, and every current invitation already carries an address.
ALTER TABLE "Invitation"
  ALTER COLUMN "email" DROP NOT NULL;
