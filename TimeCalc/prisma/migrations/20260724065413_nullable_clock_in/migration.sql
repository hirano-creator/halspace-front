-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Attendance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "clockIn" TEXT,
    "clockOut" TEXT,
    "breakMinutes" INTEGER NOT NULL DEFAULT 0,
    "outingStart" TEXT,
    "outingEnd" TEXT,
    "note" TEXT,
    "lateReason" TEXT,
    "earlyLeaveReason" TEXT,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Attendance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Attendance" ("breakMinutes", "clockIn", "clockOut", "createdAt", "date", "earlyLeaveReason", "id", "lateReason", "note", "outingEnd", "outingStart", "source", "updatedAt", "userId") SELECT "breakMinutes", "clockIn", "clockOut", "createdAt", "date", "earlyLeaveReason", "id", "lateReason", "note", "outingEnd", "outingStart", "source", "updatedAt", "userId" FROM "Attendance";
DROP TABLE "Attendance";
ALTER TABLE "new_Attendance" RENAME TO "Attendance";
CREATE INDEX "Attendance_date_idx" ON "Attendance"("date");
CREATE UNIQUE INDEX "Attendance_userId_date_key" ON "Attendance"("userId", "date");
CREATE TABLE "new_CorrectionRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "clockIn" TEXT,
    "clockOut" TEXT,
    "breakMinutes" INTEGER NOT NULL DEFAULT 0,
    "outingStart" TEXT,
    "outingEnd" TEXT,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "reviewNote" TEXT,
    "reviewedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CorrectionRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CorrectionRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_CorrectionRequest" ("breakMinutes", "clockIn", "clockOut", "createdAt", "date", "id", "outingEnd", "outingStart", "reason", "reviewNote", "reviewedAt", "reviewedById", "status", "updatedAt", "userId") SELECT "breakMinutes", "clockIn", "clockOut", "createdAt", "date", "id", "outingEnd", "outingStart", "reason", "reviewNote", "reviewedAt", "reviewedById", "status", "updatedAt", "userId" FROM "CorrectionRequest";
DROP TABLE "CorrectionRequest";
ALTER TABLE "new_CorrectionRequest" RENAME TO "CorrectionRequest";
CREATE INDEX "CorrectionRequest_status_idx" ON "CorrectionRequest"("status");
CREATE INDEX "CorrectionRequest_userId_date_idx" ON "CorrectionRequest"("userId", "date");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
