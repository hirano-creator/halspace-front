-- CreateIndex
CREATE INDEX "AttendanceLog_actorId_idx" ON "AttendanceLog"("actorId");

-- CreateIndex
CREATE INDEX "ClockEvent_departmentId_idx" ON "ClockEvent"("departmentId");

-- CreateIndex
CREATE INDEX "CorrectionRequest_reviewedById_idx" ON "CorrectionRequest"("reviewedById");

-- CreateIndex
CREATE INDEX "Department_companyId_idx" ON "Department"("companyId");

-- CreateIndex
CREATE INDEX "ImportHistory_importedById_idx" ON "ImportHistory"("importedById");

-- CreateIndex
CREATE INDEX "User_departmentId_idx" ON "User"("departmentId");

