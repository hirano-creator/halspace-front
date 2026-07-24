// 打刻データの取得・導出を束ねるサービス層

import { prisma } from "@/lib/db";
import { getAllWorkRules, workRulesFor } from "@/lib/settings";
import { todayString } from "@/lib/utils/time";
import {
  deriveDailyFromEvents,
  fixedBreakMinutesOf,
  outingIntervalsFromEvents,
  phaseOfLastEvent,
  splitOutingMinutes,
  type ClockEventType,
  type ClockPhase,
} from "./clock";

export interface ClockStatus {
  /** 直近の打刻種別（打刻したことがなければ null） */
  lastEventType: ClockEventType | null;
  /** 現在のフェーズ（勤務外/出勤中/外出中/退勤済み） */
  phase: ClockPhase;
  /** 出勤ボタンを押せるか（勤務外のとき） */
  canClockIn: boolean;
  /** 退勤ボタンを押せるか（出勤中・外出中のとき） */
  canClockOut: boolean;
  /** 外出ボタンを押せるか（出勤中のとき） */
  canOutStart: boolean;
  /** 戻りボタンを押せるか（外出中のとき） */
  canOutEnd: boolean;
}

/**
 * 打刻の現在状態を取得する。
 * 日付を跨いだ未退勤（前日出勤したまま退勤し忘れ）も引き継げるよう、
 * 当日に絞らずユーザーの最新 ClockEvent 1件から判定する。
 *
 * ただし、退勤打刻がされないまま修正申請などでその日の Attendance が
 * 退勤時刻ありで確定している場合は、打刻ログ上は未完結でも退勤済み扱いにする
 * （そうしないと退勤打刻を忘れた日以降、ずっと「出勤中」のまま出勤できなくなる）。
 */
export async function getClockStatus(userId: string): Promise<ClockStatus> {
  const last = await prisma.clockEvent.findFirst({
    where: { userId },
    orderBy: { timestamp: "desc" },
  });
  let lastEventType = (last?.type as ClockEventType | undefined) ?? null;

  if (last && lastEventType !== "OUT") {
    const attendance = await prisma.attendance.findUnique({
      where: { userId_date: { userId, date: last.date } },
    });
    if (attendance?.clockOut) lastEventType = "OUT";
  }

  const phase = phaseOfLastEvent(lastEventType);
  return {
    lastEventType,
    phase,
    canClockIn: phase === "beforeWork" || phase === "offWork",
    canClockOut: phase === "working" || phase === "outing",
    canOutStart: phase === "working",
    canOutEnd: phase === "outing",
  };
}

/** 指定した打刻種別が現在の状態で受理できるか検証する（不可なら理由を返す） */
export function validatePunch(status: ClockStatus, type: ClockEventType): string | null {
  switch (type) {
    case "IN":
      return status.canClockIn ? null : "既に出勤中です";
    case "OUT":
      return status.canClockOut ? null : "出勤の打刻がありません";
    case "OUT_START":
      return status.canOutStart ? null : "出勤中のみ外出できます";
    case "OUT_END":
      return status.canOutEnd ? null : "外出中のみ戻りを打刻できます";
  }
}

/** 指定日のユーザーの打刻タイムライン（timestamp昇順）を取得する */
export async function getTodayTimeline(userId: string, date: string = todayString()) {
  return prisma.clockEvent.findMany({
    where: { userId, date },
    orderBy: { timestamp: "asc" },
  });
}

export interface TimelineEntry {
  id: string;
  type: ClockEventType;
  time: string;
  reason: string | null;
  /** 打刻ログの時刻ではなく、修正後の勤怠（Attendance）の時刻を表示している */
  corrected: boolean;
}

/**
 * 指定日のタイムラインを「確定している勤怠（Attendance）」で上書きして返す。
 *
 * 修正申請の承認・管理者による勤怠編集は Attendance のみを更新し、
 * 打刻ログ（ClockEvent）は監査用に元の時刻のまま残す。そのため打刻ログをそのまま
 * 表示すると、修正が反映されず本人には「直っていない」ように見えてしまう。
 * ここで Attendance の値を優先し、打刻がないぶん（退勤忘れを管理者が補完した等）は
 * 行を補って表示する。
 *
 * Attendance は1日1組（出勤・退勤・外出・戻り）しか保持しないため、
 * 導出（deriveDailyFromEvents）と同じ対応付けで
 * 最初のIN / 最後のOUT / 最初のOUT_START / 最後のOUT_END を上書き対象とする。
 */
export async function getTimelineWithCorrections(
  userId: string,
  date: string = todayString(),
): Promise<TimelineEntry[]> {
  const [events, attendance] = await Promise.all([
    getTodayTimeline(userId, date),
    prisma.attendance.findUnique({ where: { userId_date: { userId, date } } }),
  ]);

  const entries: TimelineEntry[] = events.map((e) => ({
    id: e.id,
    type: e.type as ClockEventType,
    time: e.time,
    reason: e.reason,
    corrected: false,
  }));

  if (!attendance) return entries;

  // [種別, 確定値, 対象が「最後の」打刻か（false = 最初の打刻）]
  const slots: [ClockEventType, string | null, boolean][] = [
    ["IN", attendance.clockIn, false],
    ["OUT_START", attendance.outingStart, false],
    ["OUT_END", attendance.outingEnd, true],
    ["OUT", attendance.clockOut, true],
  ];

  for (const [type, fixed, useLast] of slots) {
    if (!fixed) continue;
    const matched = entries.filter((e) => e.type === type);
    const target = useLast ? matched[matched.length - 1] : matched[0];
    if (target) {
      if (target.time !== fixed) {
        target.time = fixed;
        target.corrected = true;
      }
    } else {
      // 打刻がないのに勤怠側に時刻がある（退勤忘れの補完・CSV取込など）→ 行を補う
      entries.push({ id: `${type}-corrected`, type, time: fixed, reason: null, corrected: true });
    }
  }

  return entries.sort((a, b) => a.time.localeCompare(b.time));
}

/**
 * 指定日の打刻イベントから1日分の勤怠を導出し、確定していれば Attendance に書き戻す。
 * 未退勤（status:"open"、外出中を含む）の場合は書き戻さない
 * （計算前提が崩れた仮データを保存しないため）。
 *
 * 打刻時に入力された理由は、最初の出勤の理由 → lateReason、
 * 最後の退勤の理由 → earlyLeaveReason として転記する
 * （入力がなければ既存値を保持し、後からの記入を上書きしない）。
 */
export async function deriveAndSaveAttendance(userId: string, date: string): Promise<void> {
  const [events, user, allRules] = await Promise.all([
    prisma.clockEvent.findMany({ where: { userId, date }, orderBy: { timestamp: "asc" } }),
    prisma.user.findUnique({ where: { id: userId }, include: { department: true } }),
    getAllWorkRules(),
  ]);

  const mappedEvents = events.map((e) => ({ type: e.type as ClockEventType, time: e.time }));
  const derived = deriveDailyFromEvents(mappedEvents);

  if (derived.status !== "closed") return;

  const rules = workRulesFor(allRules, user?.department?.companyId);
  // 外出（中抜け）が会社の休憩時間帯と重なる分は、固定休憩と二重に控除しない
  const { deductibleMinutes } = splitOutingMinutes(
    outingIntervalsFromEvents(mappedEvents),
    rules.breakStart,
    rules.breakEnd,
  );
  const breakMinutes = fixedBreakMinutesOf(rules) + deductibleMinutes;

  const firstInReason = events.find((e) => e.type === "IN")?.reason ?? null;
  const lastOutReason = [...events].reverse().find((e) => e.type === "OUT")?.reason ?? null;

  await prisma.attendance.upsert({
    where: { userId_date: { userId, date } },
    update: {
      clockIn: derived.clockIn,
      clockOut: derived.clockOut,
      breakMinutes,
      source: "CLOCK",
      // 打刻時の理由入力がある場合のみ転記する（undefined = 変更しない）
      lateReason: firstInReason ?? undefined,
      earlyLeaveReason: lastOutReason ?? undefined,
    },
    create: {
      userId,
      date,
      clockIn: derived.clockIn,
      clockOut: derived.clockOut,
      breakMinutes,
      source: "CLOCK",
      lateReason: firstInReason,
      earlyLeaveReason: lastOutReason,
    },
  });
}
