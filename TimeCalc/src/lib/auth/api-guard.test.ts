import { describe, expect, it, beforeAll, beforeEach, vi } from "vitest";
import { createSessionToken, type SessionUser } from "./session";

// ガードはトークンの sub をDBで引き直すので、prisma.user.findUnique だけ差し替える
const findUnique = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: { user: { findUnique: (...args: unknown[]) => findUnique(...args) } },
}));

const { getBearerUser, requireApiUser, requireApiPermission } = await import("./api-guard");

beforeAll(() => {
  process.env.SESSION_SECRET = "test-secret-for-api-guard";
});

beforeEach(() => {
  findUnique.mockReset();
});

const adminUser: SessionUser = {
  id: "user-admin",
  employeeCode: "0001",
  name: "管理者",
  role: "ADMIN",
  departmentId: null,
  companyId: null,
  gpsCheckEnabled: true,
  companyAttendance: false,
  homeScreen: "my",
  mustChangePassword: false,
};

const employeeUser: SessionUser = {
  id: "user-employee",
  employeeCode: "0002",
  name: "一般社員",
  role: "EMPLOYEE",
  departmentId: "dept-1",
  companyId: "company-1",
  gpsCheckEnabled: true,
  companyAttendance: false,
  homeScreen: "my",
  mustChangePassword: false,
};

/** SessionUser に対応するDB行（findUnique の戻り値）を作る */
function dbRow(user: SessionUser, overrides: Record<string, unknown> = {}) {
  return {
    id: user.id,
    employeeCode: user.employeeCode,
    name: user.name,
    role: user.role,
    departmentId: user.departmentId,
    gpsCheckEnabled: user.gpsCheckEnabled,
    featureOverrides: JSON.stringify({
      homeScreen: user.homeScreen,
      companyAttendance: user.companyAttendance,
    }),
    mustChangePassword: user.mustChangePassword,
    isActive: true,
    department: user.companyId ? { companyId: user.companyId } : null,
    ...overrides,
  };
}

function requestWithToken(token?: string): Request {
  const headers: HeadersInit = token ? { authorization: `Bearer ${token}` } : {};
  return new Request("http://localhost/api/dummy", { headers });
}

describe("getBearerUser", () => {
  it("Authorizationヘッダーがなければ null", async () => {
    expect(await getBearerUser(requestWithToken())).toBeNull();
  });

  it("正しいトークンならトークンの中身を返す（DBは見ない）", async () => {
    const token = await createSessionToken(adminUser);
    expect(await getBearerUser(requestWithToken(token))).toEqual(adminUser);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("不正なトークンなら null", async () => {
    expect(await getBearerUser(requestWithToken("invalid-token"))).toBeNull();
  });
});

describe("requireApiUser", () => {
  it("未ログインなら401（DBも見ない）", async () => {
    const result = await requireApiUser(requestWithToken());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("ログイン済みならDBの現在値でユーザーを返す", async () => {
    findUnique.mockResolvedValue(dbRow(employeeUser));
    const token = await createSessionToken(employeeUser);
    const result = await requireApiUser(requestWithToken(token));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.user).toEqual(employeeUser);
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: employeeUser.id } }),
    );
  });

  it("トークン発行後に無効化（isActive=false）されたユーザーは401", async () => {
    findUnique.mockResolvedValue(dbRow(employeeUser, { isActive: false }));
    const token = await createSessionToken(employeeUser);
    const result = await requireApiUser(requestWithToken(token));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
  });

  it("削除済みユーザーのトークンは401", async () => {
    findUnique.mockResolvedValue(null);
    const token = await createSessionToken(employeeUser);
    const result = await requireApiUser(requestWithToken(token));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
  });

  it("トークン発行後の降格・異動はDBの値が優先される", async () => {
    // トークンは ADMIN・所属なし、DBでは EMPLOYEE・dept-9 に変わっている
    findUnique.mockResolvedValue(
      dbRow(adminUser, {
        role: "EMPLOYEE",
        departmentId: "dept-9",
        department: { companyId: "company-9" },
      }),
    );
    const token = await createSessionToken(adminUser);
    const result = await requireApiUser(requestWithToken(token));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.user.role).toBe("EMPLOYEE");
      expect(result.user.departmentId).toBe("dept-9");
      expect(result.user.companyId).toBe("company-9");
    }
  });

  it("パスワード変更が必要なユーザーは403（コード付き）", async () => {
    findUnique.mockResolvedValue(dbRow(employeeUser, { mustChangePassword: true }));
    const token = await createSessionToken(employeeUser);
    const result = await requireApiUser(requestWithToken(token));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(403);
      expect(await result.response.json()).toMatchObject({ code: "PASSWORD_CHANGE_REQUIRED" });
    }
  });

  it("allowPasswordChangeRequired を指定すれば変更が必要なユーザーも通る", async () => {
    findUnique.mockResolvedValue(dbRow(employeeUser, { mustChangePassword: true }));
    const token = await createSessionToken(employeeUser);
    const result = await requireApiUser(requestWithToken(token), {
      allowPasswordChangeRequired: true,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.user.mustChangePassword).toBe(true);
  });
});

describe("requireApiPermission", () => {
  it("権限を持たないロールなら403", async () => {
    findUnique.mockResolvedValue(dbRow(employeeUser));
    const token = await createSessionToken(employeeUser);
    const result = await requireApiPermission(requestWithToken(token), "manageSettings");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
  });

  it("権限を持つロールならユーザーを返す", async () => {
    findUnique.mockResolvedValue(dbRow(adminUser));
    const token = await createSessionToken(adminUser);
    const result = await requireApiPermission(requestWithToken(token), "manageSettings");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.user).toEqual(adminUser);
  });

  it("トークンがADMINでもDB上で降格済みなら403", async () => {
    findUnique.mockResolvedValue(dbRow(adminUser, { role: "EMPLOYEE" }));
    const token = await createSessionToken(adminUser);
    const result = await requireApiPermission(requestWithToken(token), "manageSettings");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
  });

  it("未ログインなら401（権限チェック以前）", async () => {
    const result = await requireApiPermission(requestWithToken(), "manageSettings");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
  });
});
