-- CreateTable
CREATE TABLE "PipelineStage" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "probability" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PipelineStage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PipelineStage_workspaceId_sortOrder_idx" ON "PipelineStage"("workspaceId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "PipelineStage_workspaceId_key_key" ON "PipelineStage"("workspaceId", "key");

-- AddForeignKey
ALTER TABLE "PipelineStage" ADD CONSTRAINT "PipelineStage_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

