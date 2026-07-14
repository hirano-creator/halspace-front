"use server";

// 設定画面の Server Action（勤務ルール・部署管理）※管理者のみ

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/guard";
import { saveRoleLabels, saveWorkRules } from "@/lib/settings";
import { timeToMinutes } from "@/lib/utils/time";
import { ROLES, type Role } from "@/lib/auth/roles";
import type { WorkRuleSettings } from "@/lib/attendance/types";

export interface SettingsFormState {
  error: string | null;
  success: boolean;
}

const MONTH_DAY_RE = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** 勤務ルールを保存する */
export async function saveWorkRulesAction(
  _prev: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  await requirePermission("manageSettings");

  const get = (key: string) => String(formData.get(key) ?? "").trim();

  const rules: WorkRuleSettings = {
    summer: {
      startMonthDay: get("summerStart"),
      endMonthDay: get("summerEnd"),
      workStart: get("summerWorkStart"),
      workEnd: get("summerWorkEnd"),
    },
    winter: {
      startMonthDay: get("winterStart"),
      endMonthDay: get("winterEnd"),
      workStart: get("winterWorkStart"),
      workEnd: get("winterWorkEnd"),
    },
    overtimeStart: get("overtimeStart"),
    overtimePremiumRate: Number(get("overtimePremiumRate")) / 100,
    earlyPremiumRate: Number(get("earlyPremiumRate")) / 100,
    overtimeRoundingMinutes: Number(get("overtimeRoundingMinutes")),
    earlyWorkStart: get("earlyWorkStart"),
    closingDay: Number(get("closingDay")),
  };

  // 検証
  for (const [label, md] of [
    ["夏季開始", rules.summer.startMonthDay],
    ["夏季終了", rules.summer.endMonthDay],
    ["冬季開始", rules.winter.startMonthDay],
    ["冬季終了", rules.winter.endMonthDay],
  ] as const) {
    if (!MONTH_DAY_RE.test(md)) {
      return { error: `${label}は MM-DD 形式で入力してください（例: 04-01）`, success: false };
    }
  }
  for (const [label, time] of [
    ["夏季始業", rules.summer.workStart],
    ["夏季終業", rules.summer.workEnd],
    ["冬季始業", rules.winter.workStart],
    ["冬季終業", rules.winter.workEnd],
    ["残業開始", rules.overtimeStart],
    ["早出計算開始", rules.earlyWorkStart],
  ] as const) {
    if (timeToMinutes(time) === null) {
      return { error: `${label}の時刻形式が不正です`, success: false };
    }
  }
  for (const [label, rate] of [
    ["残業割増率", rules.overtimePremiumRate],
    ["早出割増率", rules.earlyPremiumRate],
  ] as const) {
    if (!Number.isFinite(rate) || rate < 0 || rate > 2) {
      return { error: `${label}は0〜200%の範囲で入力してください`, success: false };
    }
  }
  if (
    !Number.isInteger(rules.overtimeRoundingMinutes) ||
    rules.overtimeRoundingMinutes < 1 ||
    rules.overtimeRoundingMinutes > 60
  ) {
    return { error: "丸め単位は1〜60分の範囲で入力してください", success: false };
  }
  if (!Number.isInteger(rules.closingDay) || rules.closingDay < 1 || rules.closingDay > 31) {
    return { error: "締め日は1〜31の範囲で入力してください（31=月末締め）", success: false };
  }

  await saveWorkRules(rules);

  revalidatePath("/attendance");
  revalidatePath("/settings");
  return { error: null, success: true };
}

/** 権限の表示名を保存する（権限の中身・強さは変わらず、呼び方だけを変更する） */
export async function saveRoleLabelsAction(
  _prev: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  await requirePermission("manageSettings");

  const labels = {} as Record<Role, string>;
  for (const role of ROLES) {
    const label = String(formData.get(`label_${role}`) ?? "").trim();
    if (!label) {
      return { error: "権限の表示名はすべて入力してください", success: false };
    }
    labels[role] = label;
  }

  await saveRoleLabels(labels);

  revalidatePath("/attendance");
  revalidatePath("/employees");
  revalidatePath("/settings");
  return { error: null, success: true };
}

/** 部署を追加する */
export async function addDepartmentAction(
  _prev: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  await requirePermission("manageSettings");

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "部署名を入力してください", success: false };

  const dup = await prisma.department.findUnique({ where: { name } });
  if (dup) return { error: "同じ名前の部署が既に存在します", success: false };

  await prisma.department.create({ data: { name } });
  revalidatePath("/settings");
  return { error: null, success: true };
}

/** 部署を削除する（所属社員は「未設定」になる） */
export async function deleteDepartmentAction(
  _prev: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  await requirePermission("manageSettings");

  const id = String(formData.get("id") ?? "");
  try {
    await prisma.department.delete({ where: { id } });
  } catch (e) {
    console.error("部署削除エラー:", e);
    return { error: "部署の削除に失敗しました", success: false };
  }
  revalidatePath("/settings");
  return { error: null, success: true };
}
