import { describe, expect, it, beforeAll } from "vitest";
import { createSessionToken, verifySessionToken, type SessionUser } from "./session";

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
