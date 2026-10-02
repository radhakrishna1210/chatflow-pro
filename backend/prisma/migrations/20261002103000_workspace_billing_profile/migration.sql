-- CreateTable
CREATE TABLE "WorkspaceBillingProfile" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "businessName" TEXT,
    "email" TEXT,
    "address" TEXT,
    "taxId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceBillingProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceBillingProfile_workspaceId_key" ON "WorkspaceBillingProfile"("workspaceId");

-- AddForeignKey
ALTER TABLE "WorkspaceBillingProfile" ADD CONSTRAINT "WorkspaceBillingProfile_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

