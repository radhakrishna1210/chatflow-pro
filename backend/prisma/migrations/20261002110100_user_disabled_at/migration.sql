-- Lets a platform admin disable an account (sign-in and refresh refused).

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "disabledAt" TIMESTAMP(3);
