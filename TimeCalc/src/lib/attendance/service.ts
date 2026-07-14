// 勤怠データの取得と計算を束ねるサービス層
// （画面からはこの層を経由してデータを取得する）

import { prisma } from "@/lib/db";
import { getWorkRules } from "@/lib/settings";
import { can } from "@/lib/auth/roles";
import { periodRange } from "@/lib/utils/time";
import type { SessionUser } from "@/lib/auth/session";
import { calcDaily, calcDailyPay, summarize } from "./calculator";
import type {
  DailyCalcResult,
  DailyPay,
  MonthlySummary,
  WorkRuleSettings,
} from "./types";
import type { Prisma } from "@prisma/client";

/** 閲覧者が見られる社員を絞る Prisma の where 条件を返す */
export function visibleUsersWhere(viewer: SessionUser): Prisma.UserWhereInput {
  if (can(viewer.role, "viewAllEmployees")) return {};
  if (can(viewer.role, "viewDepartment")) {
    // 自部署（部署未設定の場合は自分のみ）
    return viewer.departmentId
      ? { departmentId: viewer.departmentId }
      : { id: viewer.id };
  }
  return { id: viewer.id };
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
  clockOut: string;
  breakMinutes: number;
  note: string | null;
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
 */
export async function getMonthlyAttendance(
  viewer: SessionUser,
  yearMonth: string,
  filter?: { userId?: string; departmentId?: string; query?: string },
  // 呼び出し元が取得済みならDB往復を省くため受け取れるようにする
  knownRules?: WorkRuleSettings,
): Promise<{
  rows: AttendanceWithCalc[];
  rules: WorkRuleSettings;
  period: { start: string; end: string };
}> {
  const rules = knownRules ?? (await getWorkRules());
  const period = periodRange(yearMonth, rules.closingDay);

  const userWhere: Prisma.UserWhereInput = {
    AND: [
      visibleUsersWhere(viewer),
      filter?.userId ? { id: filter.userId } : {},
      filter?.departmentId ? { departmentId: filter.departmentId } : {},
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
      date: { gte: period.start, lte: period.end },
      user: userWhere,
    },
    include: { user: { include: { department: true } } },
    orderBy: [{ date: "asc" }, { user: { employeeCode: "asc" } }],
  });

  const rows: AttendanceWithCalc[] = records.map((r) => {
    const calc = calcDaily(
      { date: r.date, clockIn: r.clockIn, clockOut: r.clockOut, breakMinutes: r.breakMinutes },
      rules,
    );
    return {
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
      hourlyWage: r.user.hourlyWage,
      calc,
      pay: calcDailyPay(calc, r.user.hourlyWage, rules),
    };
  });

  return { rows, rules, period };
}

/** 指定月の社員別月次集計を取得する */
export async function getMonthlySummaries(
  viewer: SessionUser,
  yearMonth: string,
  filter?: { departmentId?: string; query?: string },
  knownRules?: WorkRuleSettings,
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
