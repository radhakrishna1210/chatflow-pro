-- Refresh tokens: hashed at rest, rotation families for reuse detection, and
-- the session's workspace. Existing plaintext rows are left as they are and
-- hashed on first use, so no live session is signed out by this migration.

-- AlterTable
ALTER TABLE "RefreshToken" ADD COLUMN     "familyId" TEXT,
ADD COLUMN     "rotatedAt" TIMESTAMP(3),
ADD COLUMN     "tokenHash" TEXT,
ADD COLUMN     "workspaceId" TEXT,
ALTER COLUMN "token" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_familyId_idx" ON "RefreshToken"("familyId");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");
