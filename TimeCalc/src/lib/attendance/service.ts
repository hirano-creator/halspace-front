// 勤怠データの取得と計算を束ねるサービス層
// （画面からはこの層を経由してデータを取得する）

import { prisma } from "@/lib/db";
import { getAllWorkRules, workRulesFor, type CompanyWorkRules } from "@/lib/settings";
import { attendanceScope } from "@/lib/auth/guard";
import { periodRange } from "@/lib/utils/time";
import type { SessionUser } from "@/lib/auth/session";
import { calcDaily, calcDailyPay, summarize } from "./calculator";
import type {
  DailyCalcResult,
  DailyPay,
  MonthlySummary,
  WorkRuleSettings,
} from "./types";
import type { Prisma } from "@/generated/prisma/client";

/** 閲覧者が見られる社員を絞る Prisma の where 条件を返す */
export function visibleUsersWhere(viewer: SessionUser): Prisma.UserWhereInput {
  switch (attendanceScope(viewer)) {
    case "all":
      return {};
    case "company":
      // 同じ会社（所属部署が属するグループ会社）に属する社員
      return { department: { companyId: viewer.companyId } };
    case "department":
      // 自部署（部署未設定の場合は自分のみ）
      return viewer.departmentId ? { departmentId: viewer.departmentId } : { id: viewer.id };
    case "self":
      return { id: viewer.id };
  }
}

/** 勤怠1件と計算結果のペア */
export interface AttendanceWithCalc {
  id: string;
  userId: string;
  userName: string;
  employeeCode: string;
  departmentName: string | null;
  date: string;
  clockIn: string;
  clockOut: string | null;
  breakMinutes: number;
  note: string | null;
  lateReason: string | null;
  earlyLeaveReason: string | null;
  hourlyWage: number;
  calc: DailyCalcResult;
  pay: DailyPay;
}

/** 社員ごとの月次集計 */
export interface EmployeeMonthlySummary {
  userId: string;
  employeeCode: string;
  userName: string;
  departmentName: string | null;
  hourlyWage: number;
  summary: MonthlySummary;
  /** 月次金額（日額の合計） */
  pay: DailyPay;
}

/**
 * 指定月度の勤怠明細（計算済み）を取得する。
 * 「月度」は締め日設定に従う（例: 締め25日 → 6月度 = 5/26〜6/25）。
 * 勤務ルールは会社ごとに解決し、各行は所属会社のルールで計算する。
 * 会社をまたぐ表示では締め日が異なりうるため、全社期間の和集合で取得し
 * 行ごとに所属会社の締め期間内かどうかで絞り込む。
 */
export async function getMonthlyAttendance(
  viewer: SessionUser,
  yearMonth: string,
  filter?: { userId?: string; departmentId?: string; companyId?: string; query?: string },
  // 呼び出し元が取得済みならDB往復を省くため受け取れるようにする
  knownRules?: CompanyWorkRules,
): Promise<{
  rows: AttendanceWithCalc[];
  rules: WorkRuleSettings;
  period: { start: string; end: string };
}> {
  const allRules = knownRules ?? (await getAllWorkRules());
  // 会社で絞り込んでいる場合はその会社のルール、それ以外は共通設定を基準にする
  const rules = workRulesFor(allRules, filter?.companyId ?? null);
  const period = periodRange(yearMonth, rules.closingDay);

  // 会社ごとの締め期間（会社絞り込み時は基準期間のみで足りる）
  const periodByCompany = new Map<string, { start: string; end: string }>();
  let fetchStart = period.start;
  let fetchEnd = period.end;
  if (!filter?.companyId) {
    for (const [companyId, companyRules] of allRules.byCompany) {
      const p = periodRange(yearMonth, companyRules.closingDay);
      periodByCompany.set(companyId, p);
      if (p.start < fetchStart) fetchStart = p.start;
      if (p.end > fetchEnd) fetchEnd = p.end;
    }
  }

  const userWhere: Prisma.UserWhereInput = {
    AND: [
      visibleUsersWhere(viewer),
      filter?.userId ? { id: filter.userId } : {},
      filter?.departmentId ? { departmentId: filter.departmentId } : {},
      filter?.companyId ? { department: { companyId: filter.companyId } } : {},
      filter?.query
        ? {
            OR: [
              { name: { contains: filter.query } },
              { employeeCode: { contains: filter.query } },
            ],
          }
        : {},
    ],
  };

  const records = await prisma.attendance.findMany({
    where: {
      date: { gte: fetchStart, lte: fetchEnd },
      user: userWhere,
    },
    include: { user: { include: { department: true } } },
    orderBy: [{ date: "asc" }, { user: { employeeCode: "asc" } }],
  });

  const rows: AttendanceWithCalc[] = [];
  for (const r of records) {
    const companyId = r.user.department?.companyId ?? null;
    const rowPeriod = (companyId && periodByCompany.get(companyId)) || period;
    // 和集合で取得しているため、所属会社の締め期間外の行は除外する
    if (r.date < rowPeriod.start || r.date > rowPeriod.end) continue;

    const rowRules = filter?.companyId ? rules : workRulesFor(allRules, companyId);
    const calc = calcDaily(
      { date: r.date, clockIn: r.clockIn, clockOut: r.clockOut, breakMinutes: r.breakMinutes },
      rowRules,
    );
    rows.push({
      id: r.id,
      userId: r.userId,
      userName: r.user.name,
      employeeCode: r.user.employeeCode,
      departmentName: r.user.department?.name ?? null,
      date: r.date,
      clockIn: r.clockIn,
      clockOut: r.clockOut,
      breakMinutes: r.breakMinutes,
      note: r.note,
      lateReason: r.lateReason,
      earlyLeaveReason: r.earlyLeaveReason,
      hourlyWage: r.user.hourlyWage,
      calc,
      pay: calcDailyPay(calc, r.user.hourlyWage, rowRules),
    });
  }

  return { rows, rules, period };
}

/** 指定月の社員別月次集計を取得する */
export async function getMonthlySummaries(
  viewer: SessionUser,
  yearMonth: string,
  filter?: { departmentId?: string; companyId?: string; query?: string },
  knownRules?: CompanyWorkRules,
): Promise<EmployeeMonthlySummary[]> {
  const { rows } = await getMonthlyAttendance(viewer, yearMonth, filter, knownRules);

  const byUser = new Map<
    string,
    { meta: AttendanceWithCalc; calcs: DailyCalcResult[]; pay: DailyPay }
  >();
  for (const row of rows) {
    const entry =
      byUser.get(row.userId) ??
      ({
        meta: row,
        calcs: [],
        pay: { normalPay: 0, earlyPay: 0, overtimePay: 0, totalPay: 0, basePay: 0, premiumPay: 0 },
      } as { meta: AttendanceWithCalc; calcs: DailyCalcResult[]; pay: DailyPay });
    entry.calcs.push(row.calc);
    entry.pay.normalPay += row.pay.normalPay;
    entry.pay.earlyPay += row.pay.earlyPay;
    entry.pay.overtimePay += row.pay.overtimePay;
    entry.pay.totalPay += row.pay.totalPay;
    entry.pay.basePay += row.pay.basePay;
    entry.pay.premiumPay += row.pay.premiumPay;
    byUser.set(row.userId, entry);
  }

  return [...byUser.values()]
    .map(({ meta, calcs, pay }) => ({
      userId: meta.userId,
      employeeCode: meta.employeeCode,
      userName: meta.userName,
      departmentName: meta.departmentName,
      hourlyWage: meta.hourlyWage,
      summary: summarize(calcs),
      pay,
    }))
    .sort((a, b) => a.employeeCode.localeCompare(b.employeeCode));
}
