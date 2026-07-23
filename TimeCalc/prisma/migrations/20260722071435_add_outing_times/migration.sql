-- AlterTable
ALTER TABLE "Attendance" ADD COLUMN "outingEnd" TEXT;
ALTER TABLE "Attendance" ADD COLUMN "outingStart" TEXT;

-- AlterTable
ALTER TABLE "CorrectionRequest" ADD COLUMN "outingEnd" TEXT;
ALTER TABLE "CorrectionRequest" ADD COLUMN "outingStart" TEXT;
