CREATE TABLE IF NOT EXISTS "AuthenticationTransaction" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "waNumberId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "otpHash" TEXT,
    "source" TEXT NOT NULL DEFAULT 'CHATFLOW',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "metaMessageId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedAt" TIMESTAMP(3),

    CONSTRAINT "AuthenticationTransaction_pkey"
        PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AuthenticationTransaction_workspaceId_phone_status_idx"
    ON "AuthenticationTransaction"("workspaceId", "phone", "status");

CREATE INDEX IF NOT EXISTS "AuthenticationTransaction_phone_expiresAt_idx"
    ON "AuthenticationTransaction"("phone", "expiresAt");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'AuthenticationTransaction_workspaceId_fkey'
    ) THEN
        ALTER TABLE "AuthenticationTransaction"
        ADD CONSTRAINT "AuthenticationTransaction_workspaceId_fkey"
        FOREIGN KEY ("workspaceId")
        REFERENCES "Workspace"("id")
        ON DELETE CASCADE
        ON UPDATE CASCADE;
    END IF;
END $$;