// 打刻データの取得・導出を束ねるサービス層

import { prisma } from "@/lib/db";
import { getAllWorkRules, workRulesFor } from "@/lib/settings";
import { todayString } from "@/lib/utils/time";
import { roundClockTimes } from "./calculator";
import {
  applyAttendanceToTimeline,
  deriveDailyFromEvents,
  fixedBreakMinutesFor,
  outingIntervalsFromEvents,
  phaseOfLastEvent,
  splitOutingMinutes,
  type ClockEventType,
  type ClockPhase,
  type TimelineEntry,
} from "./clock";

export type { TimelineEntry };

export interface ClockStatus {
  /** 直近の打刻種別（当日の打刻がなければ null） */
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
  /** 直近の打刻（二重打刻ガードなどに使う。当日以外の打刻も含む） */
  lastEvent: { id: string; type: ClockEventType; time: string; date: string; timestamp: Date } | null;
}

/**
 * 打刻の現在状態を取得する。
 *
 * 判定は当日（date が today）の打刻のみで行う。前日以前の退勤打刻を忘れても
 * 翌日は「勤務外」から始まり、通常どおり出勤から打刻できる
 * （引き継ぐと、押し忘れた日以降ずっと「出勤中」のまま出勤できなくなるため）。
 * 押し忘れた日は findUnclosedDate で別途拾い、後から修正できるよう画面で知らせる。
 *
 * また、退勤打刻がされないまま修正申請などで当日の Attendance が退勤時刻ありで
 * 確定している場合は、打刻ログ上は未完結でも退勤済み扱いにする。
 */
export async function getClockStatus(
  userId: string,
  today: string = todayString(),
): Promise<ClockStatus> {
  const last = await prisma.clockEvent.findFirst({
    where: { userId },
    orderBy: { timestamp: "desc" },
  });

  // 前日以前の打刻は当日の状態に持ち越さない（打刻忘れとして扱う）
  const isToday = last?.date === today;
  let lastEventType = isToday ? ((last!.type as ClockEventType) ?? null) : null;

  if (isToday && lastEventType !== "OUT") {
    const attendance = await prisma.attendance.findUnique({
      where: { userId_date: { userId, date: last!.date } },
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
    lastEvent: last
      ? {
          id: last.id,
          type: last.type as ClockEventType,
          time: last.time,
          date: last.date,
          timestamp: last.timestamp,
        }
      : null,
  };
}

/**
 * 退勤打刻がないまま日付が変わった日（＝退勤打刻の押し忘れ）を返す。
 * 当日より前の直近の打刻日だけを見るため、当日すでに出勤していても通知は消えない。
 * 修正申請の承認・管理者編集で Attendance の退勤時刻が入っている日は、
 * 打刻ログが未完結でも修正済みとみなして null を返す。
 */
export async function findUnclosedDate(
  userId: string,
  today: string = todayString(),
): Promise<string | null> {
  const lastBeforeToday = await prisma.clockEvent.findFirst({
    where: { userId, date: { lt: today } },
    orderBy: { timestamp: "desc" },
  });
  if (!lastBeforeToday) return null;

  const date = lastBeforeToday.date;
  const [events, attendance] = await Promise.all([
    prisma.clockEvent.findMany({ where: { userId, date }, orderBy: { timestamp: "asc" } }),
    prisma.attendance.findUnique({ where: { userId_date: { userId, date } } }),
  ]);
  if (attendance?.clockOut) return null;
  const derived = deriveDailyFromEvents(
    events.map((e) => ({ type: e.type as ClockEventType, time: e.time })),
  );
  return derived.status === "open" ? date : null;
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

/**
 * 指定日のタイムラインを、確定している勤怠（Attendance）の修正内容を反映して返す。
 * 反映ルールは applyAttendanceToTimeline を参照。
 */
export async function getTimelineWithCorrections(
  userId: string,
  date: string = todayString(),
): Promise<TimelineEntry[]> {
  const [events, attendance] = await Promise.all([
    getTodayTimeline(userId, date),
    prisma.attendance.findUnique({ where: { userId_date: { userId, date } } }),
  ]);

  return applyAttendanceToTimeline(
    events.map((e) => ({
      id: e.id,
      type: e.type as ClockEventType,
      time: e.time,
      reason: e.reason,
    })),
    attendance,
  );
}

/** deriveAndSaveAttendance の計算部分（DB書き込みなし）。再計算バッチのプレビューにも使う */
export interface DerivedAttendance {
  clockIn: string;
  clockOut: string;
  breakMinutes: number;
  lateReason: string | null;
  earlyLeaveReason: string | null;
}

/**
 * 指定日の打刻イベントから1日分の勤怠を導出する（DB書き込みは行わない）。
 * 未退勤（status:"open"、外出中を含む）の場合は null を返す。
 */
export async function computeDerivedAttendance(
  userId: string,
  date: string,
): Promise<DerivedAttendance | null> {
  const [events, user, allRules] = await Promise.all([
    prisma.clockEvent.findMany({ where: { userId, date }, orderBy: { timestamp: "asc" } }),
    prisma.user.findUnique({ where: { id: userId }, include: { department: true } }),
    getAllWorkRules(),
  ]);

  const mappedEvents = events.map((e) => ({ type: e.type as ClockEventType, time: e.time }));
  const derived = deriveDailyFromEvents(mappedEvents);

  if (derived.status !== "closed") return null;

  const rules = workRulesFor(allRules, user?.department?.companyId);
  // 外出（中抜け）が会社の休憩時間帯と重なる分は、固定休憩と二重に控除しない
  const { deductibleMinutes } = splitOutingMinutes(
    outingIntervalsFromEvents(mappedEvents),
    rules.breakStart,
    rules.breakEnd,
  );
  // 固定休憩の重複は、丸め前の実打刻ではなく calcDaily と同じ丸め後の時刻で判定する。
  // 丸め前で判定すると、丸めで既に切り捨てられた時間（例: 退勤直前の数分）を
  // 休憩としてさらに二重に控除してしまう（例: 休憩12:00〜13:00・実退勤12:27の会社で、
  // 丸め後の退勤は12:00となり休憩と重ならないのに、12:27を基準にすると27分が
  // 誤って休憩扱いになり、実働3:00のはずが2:33に減ってしまう）。
  const rounded = roundClockTimes(derived.clockIn, derived.clockOut, rules);
  const breakMinutes =
    fixedBreakMinutesFor(
      rules,
      rounded?.roundedClockIn ?? derived.clockIn,
      rounded?.roundedClockOut ?? derived.clockOut,
    ) + deductibleMinutes;

  return {
    clockIn: derived.clockIn,
    clockOut: derived.clockOut,
    breakMinutes,
    lateReason: events.find((e) => e.type === "IN")?.reason ?? null,
    earlyLeaveReason: [...events].reverse().find((e) => e.type === "OUT")?.reason ?? null,
  };
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
  const result = await computeDerivedAttendance(userId, date);
  if (!result) return;

  await prisma.attendance.upsert({
    where: { userId_date: { userId, date } },
    update: {
      clockIn: result.clockIn,
      clockOut: result.clockOut,
      breakMinutes: result.breakMinutes,
      source: "CLOCK",
      // 打刻時の理由入力がある場合のみ転記する（undefined = 変更しない）
      lateReason: result.lateReason ?? undefined,
      earlyLeaveReason: result.earlyLeaveReason ?? undefined,
    },
    create: {
      userId,
      date,
      clockIn: result.clockIn,
      clockOut: result.clockOut,
      breakMinutes: result.breakMinutes,
      source: "CLOCK",
      lateReason: result.lateReason,
      earlyLeaveReason: result.earlyLeaveReason,
    },
  });
}
