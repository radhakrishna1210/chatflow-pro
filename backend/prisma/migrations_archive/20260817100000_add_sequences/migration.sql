-- CreateEnum
CREATE TYPE "SequenceStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'PAUSED');

-- CreateEnum
CREATE TYPE "EnrollmentStatus" AS ENUM ('ACTIVE', 'WAITING', 'COMPLETED', 'EXITED', 'FAILED');

-- CreateTable
CREATE TABLE "Sequence" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "SequenceStatus" NOT NULL DEFAULT 'DRAFT',
    "steps" JSONB NOT NULL,
    "respectBusinessHours" BOOLEAN NOT NULL DEFAULT true,
    "exitOnReply" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Sequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SequenceEnrollment" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "sequenceId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "leadId" TEXT,
    "status" "EnrollmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "cursor" INTEGER NOT NULL DEFAULT 0,
    "nextRunAt" TIMESTAMP(3),
    "steps" JSONB NOT NULL,
    "exitReason" TEXT,
    "lastError" TEXT,
    "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SequenceEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SequenceStepRun" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "stepIndex" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "detail" TEXT,
    "ranAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SequenceStepRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Sequence_workspaceId_status_idx" ON "Sequence"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "SequenceEnrollment_workspaceId_status_nextRunAt_idx" ON "SequenceEnrollment"("workspaceId", "status", "nextRunAt");

-- CreateIndex
CREATE UNIQUE INDEX "SequenceEnrollment_sequenceId_contactId_key" ON "SequenceEnrollment"("sequenceId", "contactId");

-- CreateIndex
CREATE INDEX "SequenceStepRun_workspaceId_enrollmentId_ranAt_idx" ON "SequenceStepRun"("workspaceId", "enrollmentId", "ranAt");

-- AddForeignKey
ALTER TABLE "Sequence" ADD CONSTRAINT "Sequence_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SequenceEnrollment" ADD CONSTRAINT "SequenceEnrollment_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SequenceEnrollment" ADD CONSTRAINT "SequenceEnrollment_sequenceId_fkey" FOREIGN KEY ("sequenceId") REFERENCES "Sequence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SequenceEnrollment" ADD CONSTRAINT "SequenceEnrollment_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SequenceEnrollment" ADD CONSTRAINT "SequenceEnrollment_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SequenceStepRun" ADD CONSTRAINT "SequenceStepRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SequenceStepRun" ADD CONSTRAINT "SequenceStepRun_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "SequenceEnrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

