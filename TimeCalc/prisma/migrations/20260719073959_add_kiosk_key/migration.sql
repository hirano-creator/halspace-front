-- AlterTable
ALTER TABLE "Department" ADD COLUMN "kioskKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Department_kioskKey_key" ON "Department"("kioskKey");

