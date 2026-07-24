// /api/my/* の各Route Handlerが共有するロジック

import { prisma } from "@/lib/db";
import { resolveFeatures } from "@/lib/auth/features";
import { getAllWorkRules, workRulesFor } from "@/lib/settings";
import { normalizeDate, nowTimeString, timeToMinutes, todayString } from "@/lib/utils/time";
import { fixedBreakMinutesFor, splitOutingMinutes } from "@/lib/attendance/clock";
import type { WorkRuleSettings } from "@/lib/attendance/types";

/** 本人の機能設定をDBの最新値から解決する */
export async function myFeatures(userId: string) {
  const me = await prisma.user.findUnique({ where: { id: userId } });
  return me ? resolveFeatures(me.featureOverrides) : null;
}

/** 本人の所属会社の勤務ルールを解決する（固定休憩時間の参照用） */
export async function myWorkRules(userId: string) {
  const [me, allRules] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, include: { department: true } }),
    getAllWorkRules(),
  ]);
  if (!me) return null;
  return workRulesFor(allRules, me.department?.companyId);
}

export interface ParsedCorrection {
  date: string;
  clockIn: string;
  /** 未退勤（未入力）の場合は null */
  clockOut: string | null;
  /** 固定休憩＋外出時間の合算（分） */
  breakMinutes: number;
  outingStart: string | null;
  outingEnd: string | null;
}

/**
 * 修正フォームの入力を解析する。休憩は個別入力させず、
 * 「外出」「戻り」の時刻から算出した外出時間に、会社の固定休憩時間を加算したものを
 * breakMinutes とする（外出は任意入力、未入力なら固定休憩のみ）。固定休憩は勤務時間帯と
 * 休憩時間帯が重なった分だけ加算する（休憩をまたがない半日勤務では控除しない）。
 * 外出が会社の休憩時間帯（breakStart〜breakEnd）と重なる場合は、重なった分を
 * 控除対象から除き、休憩と外出を二重に差し引かないようにする。
 * 退勤はまだ確定していない日（退勤前に出勤のみ修正したい等）を考慮し、
 * 未入力（空欄）を許容する（その場合 clockOut は null になり、勤務時間等は
 * 「エラー行」＝未確定として表示される）。
 */
export function parseCorrectionForm(
  formData: FormData,
  rules: WorkRuleSettings,
): ParsedCorrection | string {
  const date = normalizeDate(String(formData.get("date") ?? ""));
  const clockIn = String(formData.get("clockIn") ?? "").trim();
  const clockOutRaw = String(formData.get("clockOut") ?? "").trim();
  const outingStartRaw = String(formData.get("outingStart") ?? "").trim();
  const outingEndRaw = String(formData.get("outingEnd") ?? "").trim();

  if (!date) return "日付の形式が不正です";
  if (date > todayString()) return "未来の日付は指定できません";
  const inMinutes = timeToMinutes(clockIn);
  if (inMinutes === null) {
    return "出勤時刻は HH:mm 形式で入力してください";
  }
  const clockOut = clockOutRaw || null;
  const outMinutes = timeToMinutes(clockOut);
  if (clockOut !== null && outMinutes === null) {
    return "退勤時刻は HH:mm 形式で入力してください";
  }
  if (date === todayString()) {
    const nowMinutes = timeToMinutes(nowTimeString())!;
    if (inMinutes > nowMinutes || (outMinutes !== null && outMinutes > nowMinutes)) {
      return "本日のまだ来ていない時刻は指定できません";
    }
  }

  let outingStart: string | null = null;
  let outingEnd: string | null = null;
  if (outingStartRaw || outingEndRaw) {
    if (!outingStartRaw || !outingEndRaw) {
      return "外出時刻と戻り時刻は両方入力してください";
    }
    const outingStartMinutes = timeToMinutes(outingStartRaw);
    const outingEndMinutes = timeToMinutes(outingEndRaw);
    if (outingStartMinutes === null || outingEndMinutes === null) {
      return "外出・戻りの時刻は HH:mm 形式で入力してください";
    }
    if (outingEndMinutes <= outingStartMinutes) {
      return "戻り時刻は外出時刻より後にしてください";
    }
    outingStart = outingStartRaw;
    outingEnd = outingEndRaw;
  }

  const deductibleOutingMinutes =
    outingStart && outingEnd
      ? splitOutingMinutes([{ start: outingStart, end: outingEnd }], rules.breakStart, rules.breakEnd)
          .deductibleMinutes
      : 0;
  const breakMinutes = fixedBreakMinutesFor(rules, clockIn, clockOut) + deductibleOutingMinutes;

  return { date, clockIn, clockOut, breakMinutes, outingStart, outingEnd };
}
