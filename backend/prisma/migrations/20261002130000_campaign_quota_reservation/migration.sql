-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "quotaPeriodStart" TIMESTAMP(3),
ADD COLUMN     "quotaReleasedAt" TIMESTAMP(3),
ADD COLUMN     "quotaUnits" INTEGER NOT NULL DEFAULT 0;

