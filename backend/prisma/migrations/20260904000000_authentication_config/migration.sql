CREATE TABLE "AuthenticationConfig" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "apiKeyId" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "templateId" TEXT,
    "waNumberId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthenticationConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AuthenticationConfig_workspaceId_key" ON "AuthenticationConfig"("workspaceId");
CREATE UNIQUE INDEX "AuthenticationConfig_apiKeyId_key" ON "AuthenticationConfig"("apiKeyId");

ALTER TABLE "AuthenticationConfig"
    ADD CONSTRAINT "AuthenticationConfig_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AuthenticationConfig"
    ADD CONSTRAINT "AuthenticationConfig_apiKeyId_fkey"
    FOREIGN KEY ("apiKeyId") REFERENCES "ApiKey"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
