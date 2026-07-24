// /api/employees/* の各Route Handlerが共有するロジック

import { ROLES } from "@/lib/auth/roles";
import { serializeFeatures, toClockMode, type SelfEditMode } from "@/lib/auth/features";

export interface EmployeeInput {
  employeeCode: string;
  name: string;
  email: string | null;
  role: string;
  hourlyWage: number;
  departmentId: string | null;
  isActive: boolean;
  gpsCheckEnabled: boolean;
  /** スタッフ単位の機能設定（デフォルトと同じなら null） */
  featureOverrides: string | null;
  password: string; // 空なら変更しない（新規時は必須）
}

export function parseEmployeeForm(formData: FormData): EmployeeInput | string {
  const employeeCode = String(formData.get("employeeCode") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim() || null;
  const role = String(formData.get("role") ?? "EMPLOYEE");
  const hourlyWage = Number(formData.get("hourlyWage") ?? 0);
  const departmentId = String(formData.get("departmentId") ?? "") || null;
  const isActive = formData.get("isActive") === "on";
  const gpsCheckEnabled = formData.get("gpsCheckEnabled") === "on";
  const password = String(formData.get("password") ?? "");

  const selfEditRaw = String(formData.get("selfEdit") ?? "request");
  const selfEdit: SelfEditMode =
    selfEditRaw === "direct" || selfEditRaw === "none" ? selfEditRaw : "request";
  const featureOverrides = serializeFeatures({
    selfEdit,
    clockMode: toClockMode(formData.get("clockMode")),
    showMonthlySummary: formData.get("showMonthlySummary") === "on",
    companyAttendance: formData.get("companyAttendance") === "on",
  });

  if (!employeeCode) return "社員番号を入力してください";
  if (!name) return "氏名を入力してください";
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return "メールアドレスの形式が不正です";
  }
  if (!(ROLES as readonly string[]).includes(role)) return "権限の指定が不正です";
  if (!Number.isInteger(hourlyWage) || hourlyWage < 0 || hourlyWage > 100000) {
    return "時給は0〜100,000円の整数で入力してください";
  }
  if (password && password.length < 8) return "パスワードは8文字以上にしてください";

  return {
    employeeCode,
    name,
    email,
    role,
    hourlyWage,
    departmentId,
    isActive,
    gpsCheckEnabled,
    featureOverrides,
    password,
  };
}
