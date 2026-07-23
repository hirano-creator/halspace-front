-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Department" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "companyId" TEXT,
    "latitude" REAL,
    "longitude" REAL,
    "allowedRadiusMeters" INTEGER,
    "dailyQrEnabled" BOOLEAN NOT NULL DEFAULT false,
    "standardQrEnabled" BOOLEAN NOT NULL DEFAULT true,
    "attendQrEnabled" BOOLEAN NOT NULL DEFAULT true,
    "outingQrEnabled" BOOLEAN NOT NULL DEFAULT true,
    "kioskKey" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Department_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Department" ("allowedRadiusMeters", "companyId", "createdAt", "dailyQrEnabled", "id", "kioskKey", "latitude", "longitude", "name", "updatedAt") SELECT "allowedRadiusMeters", "companyId", "createdAt", "dailyQrEnabled", "id", "kioskKey", "latitude", "longitude", "name", "updatedAt" FROM "Department";
DROP TABLE "Department";
ALTER TABLE "new_Department" RENAME TO "Department";
CREATE UNIQUE INDEX "Department_name_key" ON "Department"("name");
CREATE UNIQUE INDEX "Department_kioskKey_key" ON "Department"("kioskKey");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
