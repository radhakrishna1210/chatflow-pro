-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('NEW', 'OPEN', 'WAITING', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "TicketPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateTable
CREATE TABLE "CrmTicket" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "ticketNumber" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "description" TEXT,
    "status" "TicketStatus" NOT NULL DEFAULT 'NEW',
    "priority" "TicketPriority" NOT NULL DEFAULT 'NORMAL',
    "category" TEXT,
    "contactId" TEXT,
    "ownerUserId" TEXT,
    "teamId" TEXT,
    "conversationId" TEXT,
    "dueAt" TIMESTAMP(3),
    "firstRespondedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmTicket_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CrmTicket_workspaceId_status_dueAt_idx" ON "CrmTicket"("workspaceId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "CrmTicket_workspaceId_ownerUserId_idx" ON "CrmTicket"("workspaceId", "ownerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "CrmTicket_workspaceId_ticketNumber_key" ON "CrmTicket"("workspaceId", "ticketNumber");

-- AddForeignKey
ALTER TABLE "CrmTicket" ADD CONSTRAINT "CrmTicket_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmTicket" ADD CONSTRAINT "CrmTicket_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmTicket" ADD CONSTRAINT "CrmTicket_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmTicket" ADD CONSTRAINT "CrmTicket_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmTicket" ADD CONSTRAINT "CrmTicket_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

