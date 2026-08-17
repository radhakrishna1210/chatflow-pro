-- CreateTable
CREATE TABLE "Cluster" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Cluster_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClusterContact" (
    "clusterId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,

    CONSTRAINT "ClusterContact_pkey" PRIMARY KEY ("clusterId","contactId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Cluster_workspaceId_name_key" ON "Cluster"("workspaceId", "name");

-- AddForeignKey
ALTER TABLE "Cluster" ADD CONSTRAINT "Cluster_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClusterContact" ADD CONSTRAINT "ClusterContact_clusterId_fkey" FOREIGN KEY ("clusterId") REFERENCES "Cluster"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClusterContact" ADD CONSTRAINT "ClusterContact_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
