import { describe, expect, it, beforeAll } from "vitest";
import { createSessionToken, verifySessionToken, buildSessionUser, type SessionUser } from "./session";

beforeAll(() => {
  process.env.SESSION_SECRET = "test-secret-for-session-token";
});

const sampleUser: SessionUser = {
  id: "user-1",
  employeeCode: "0001",
  name: "山田太郎",
  role: "EMPLOYEE",
  departmentId: "dept-1",
  companyId: "company-1",
  gpsCheckEnabled: true,
  companyAttendance: false,
  homeScreen: "my",
  mustChangePassword: false,
};

describe("createSessionToken / verifySessionToken", () => {
  it("発行したトークンを検証すると同じ内容が復元できる", async () => {
    const token = await createSessionToken(sampleUser);
    const result = await verifySessionToken(token);
    expect(result).toEqual(sampleUser);
  });

  it("不正なトークンは null になる", async () => {
    const result = await verifySessionToken("not-a-valid-jwt");
    expect(result).toBeNull();
  });

  it("別のシークレットで発行されたトークンは検証に失敗する", async () => {
    const token = await createSessionToken(sampleUser);
    const original = process.env.SESSION_SECRET;
    process.env.SESSION_SECRET = "different-secret";
    const result = await verifySessionToken(token);
    process.env.SESSION_SECRET = original;
    expect(result).toBeNull();
  });
});

describe("buildSessionUser", () => {
  const row = {
    id: "user-2",
    employeeCode: "0002",
    name: "佐藤花子",
    role: "MANAGER",
    departmentId: "dept-2",
    gpsCheckEnabled: false,
    featureOverrides: JSON.stringify({ companyAttendance: true, homeScreen: "scan" }),
    mustChangePassword: true,
  };

  it("DBの行から role・機能設定・会社IDを解決する", () => {
    expect(buildSessionUser(row, "company-2")).toEqual({
      id: "user-2",
      employeeCode: "0002",
      name: "佐藤花子",
      role: "MANAGER",
      departmentId: "dept-2",
      companyId: "company-2",
      gpsCheckEnabled: false,
      companyAttendance: true,
      homeScreen: "scan",
      mustChangePassword: true,
    });
  });

  it("不正な role はEMPLOYEEに、featureOverridesが無ければ既定値になる", () => {
    const user = buildSessionUser({ ...row, role: "BOGUS", featureOverrides: null }, null);
    expect(user.role).toBe("EMPLOYEE");
    expect(user.companyAttendance).toBe(false);
    expect(user.homeScreen).toBe("clock");
    expect(user.companyId).toBeNull();
  });
});
