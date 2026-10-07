-- AlterTable
ALTER TABLE "ClockEvent" ADD COLUMN     "photoKey" TEXT,
ADD COLUMN     "via" TEXT NOT NULL DEFAULT 'SELF';

-- AlterTable
ALTER TABLE "Department" ADD COLUMN     "kioskPunchEnabled" BOOLEAN NOT NULL DEFAULT false;
