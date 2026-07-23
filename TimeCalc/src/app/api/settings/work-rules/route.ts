// 勤務ルールの保存API（POST）
// 旧 settings/actions.ts の saveWorkRulesAction をそのまま移植

import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-guard";
import { saveWorkRules } from "@/lib/settings";
import { timeToMinutes } from "@/lib/utils/time";
import type { WorkRuleSettings } from "@/lib/attendance/types";
import type { SettingsFormState } from "@/app/(app)/settings/types";
import { resolveCompanyId } from "../_shared";

const MONTH_DAY_RE = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export async function POST(request: Request) {
  const auth = await requireApiPermission(request, "manageSettings");
  if (!auth.ok) return auth.response;

  const formData = await request.formData();
  const companyId = await resolveCompanyId(formData);
  if (companyId === "invalid") {
    return NextResponse.json<SettingsFormState>({ error: "対象の会社が見つかりません", success: false });
  }

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
    overtimeThresholdMinutes: Number(get("overtimeThresholdMinutes")),
    closingDay: Number(get("closingDay")),
    breakStart: get("breakStart"),
    breakEnd: get("breakEnd"),
  };

  for (const [label, md] of [
    ["夏季開始", rules.summer.startMonthDay],
    ["夏季終了", rules.summer.endMonthDay],
    ["冬季開始", rules.winter.startMonthDay],
    ["冬季終了", rules.winter.endMonthDay],
  ] as const) {
    if (!MONTH_DAY_RE.test(md)) {
      return NextResponse.json<SettingsFormState>({
        error: `${label}は MM-DD 形式で入力してください（例: 04-01）`,
        success: false,
      });
    }
  }
  for (const [label, time] of [
    ["夏季始業", rules.summer.workStart],
    ["夏季終業", rules.summer.workEnd],
    ["冬季始業", rules.winter.workStart],
    ["冬季終業", rules.winter.workEnd],
    ["残業開始", rules.overtimeStart],
    ["早出計算開始", rules.earlyWorkStart],
    ["休憩開始", rules.breakStart],
    ["休憩終了", rules.breakEnd],
  ] as const) {
    if (timeToMinutes(time) === null) {
      return NextResponse.json<SettingsFormState>({ error: `${label}の時刻形式が不正です`, success: false });
    }
  }
  for (const [label, rate] of [
    ["残業割増率", rules.overtimePremiumRate],
    ["早出割増率", rules.earlyPremiumRate],
  ] as const) {
    if (!Number.isFinite(rate) || rate < 0 || rate > 2) {
      return NextResponse.json<SettingsFormState>({
        error: `${label}は0〜200%の範囲で入力してください`,
        success: false,
      });
    }
  }
  if (
    !Number.isInteger(rules.overtimeRoundingMinutes) ||
    rules.overtimeRoundingMinutes < 1 ||
    rules.overtimeRoundingMinutes > 60
  ) {
    return NextResponse.json<SettingsFormState>({
      error: "丸め単位は1〜60分の範囲で入力してください",
      success: false,
    });
  }
  if (
    !Number.isInteger(rules.overtimeThresholdMinutes) ||
    rules.overtimeThresholdMinutes < 0 ||
    rules.overtimeThresholdMinutes > 1440
  ) {
    return NextResponse.json<SettingsFormState>({
      error: "残業がつく実働時間は0〜1440分の範囲で入力してください（0=残業開始時刻以降を常に残業扱い）",
      success: false,
    });
  }
  if (!Number.isInteger(rules.closingDay) || rules.closingDay < 1 || rules.closingDay > 31) {
    return NextResponse.json<SettingsFormState>({
      error: "締め日は1〜31の範囲で入力してください（31=月末締め）",
      success: false,
    });
  }
  if (timeToMinutes(rules.breakEnd)! <= timeToMinutes(rules.breakStart)!) {
    return NextResponse.json<SettingsFormState>({
      error: "休憩終了は休憩開始より後にしてください",
      success: false,
    });
  }

  await saveWorkRules(rules, companyId);

  return NextResponse.json<SettingsFormState>({ error: null, success: true });
}
