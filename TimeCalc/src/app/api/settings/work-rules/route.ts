// 勤務ルールの保存API（POST）
// 旧 settings/actions.ts の saveWorkRulesAction をそのまま移植

import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-guard";
import { saveWorkRules } from "@/lib/settings";
import { timeToMinutes } from "@/lib/utils/time";
import type { WorkRuleSettings } from "@/lib/attendance/types";
import type { SettingsFormState } from "@/app/(app)/settings/types";
import { resolveCompanyId } from "../_shared";

export async function POST(request: Request) {
  const auth = await requireApiPermission(request, "manageSettings");
  if (!auth.ok) return auth.response;

  const formData = await request.formData();
  const companyId = await resolveCompanyId(formData);
  if (companyId === "invalid") {
    return NextResponse.json<SettingsFormState>({ error: "対象の会社が見つかりません", success: false });
  }

  const get = (key: string) => String(formData.get(key) ?? "").trim();
  // 時間単位で入力された週の労働時間を分に直す（0.5時間刻みを許容するため四捨五入する）
  const hoursToMinutes = (key: string) => Math.round(Number(get(key)) * 60);

  const rules: WorkRuleSettings = {
    workStart: get("workStart"),
    workEnd: get("workEnd"),
    overtimeStart: get("overtimeStart"),
    overtimePremiumRate: Number(get("overtimePremiumRate")) / 100,
    earlyPremiumRate: Number(get("earlyPremiumRate")) / 100,
    overtimeRoundingMinutes: Number(get("overtimeRoundingMinutes")),
    earlyWorkStart: get("earlyWorkStart"),
    overtimeThresholdMinutes: Number(get("overtimeThresholdMinutes")),
    legalDailyMinutes: hoursToMinutes("legalDailyHours"),
    closingDay: Number(get("closingDay")),
    breakStart: get("breakStart"),
    breakEnd: get("breakEnd"),
    weekly: {
      enabled: formData.get("weeklyEnabled") !== null,
      startDayOfWeek: Number(get("weeklyStartDayOfWeek")),
      // チェックボックス群のため getAll で受け、0〜6の整数だけを重複なく残す
      closedDays: [
        ...new Set(
          formData
            .getAll("weeklyClosedDays")
            .map((v) => Number(String(v)))
            .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6),
        ),
      ].sort((a, b) => a - b),
      standardMinutes: hoursToMinutes("weeklyStandardHours"),
      legalMinutes: hoursToMinutes("weeklyLegalHours"),
      withinLegalPremiumRate: Number(get("weeklyWithinLegalPremiumRate")) / 100,
      overLegalPremiumRate: Number(get("weeklyOverLegalPremiumRate")) / 100,
    },
  };

  for (const [label, time] of [
    ["始業", rules.workStart],
    ["終業", rules.workEnd],
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
    ["所定超〜法定内の割増率", rules.weekly.withinLegalPremiumRate],
    ["法定超の割増率", rules.weekly.overLegalPremiumRate],
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
  if (
    !Number.isInteger(rules.legalDailyMinutes) ||
    rules.legalDailyMinutes < 0 ||
    rules.legalDailyMinutes > 1440
  ) {
    return NextResponse.json<SettingsFormState>({
      error: "法定勤務時間は0〜24時間の範囲で入力してください",
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
  if (
    !Number.isInteger(rules.weekly.startDayOfWeek) ||
    rules.weekly.startDayOfWeek < 0 ||
    rules.weekly.startDayOfWeek > 6
  ) {
    return NextResponse.json<SettingsFormState>({
      error: "週の起算曜日を選択してください",
      success: false,
    });
  }
  for (const [label, minutes] of [
    ["所定労働時間", rules.weekly.standardMinutes],
    ["法定労働時間", rules.weekly.legalMinutes],
  ] as const) {
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > 168 * 60) {
      return NextResponse.json<SettingsFormState>({
        error: `${label}は0〜168時間の範囲で入力してください`,
        success: false,
      });
    }
  }
  if (rules.weekly.legalMinutes < rules.weekly.standardMinutes) {
    return NextResponse.json<SettingsFormState>({
      error: "法定労働時間は所定労働時間以上にしてください",
      success: false,
    });
  }

  await saveWorkRules(rules, companyId);

  return NextResponse.json<SettingsFormState>({ error: null, success: true });
}
