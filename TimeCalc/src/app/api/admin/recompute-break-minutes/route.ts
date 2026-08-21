// 一時メンテナンスAPI: 打刻由来（source=CLOCK）の過去の勤怠を、休憩重複を丸め後の
// 時刻で判定する新ロジック（clock-service.ts の computeDerivedAttendance）で
// 再計算する。CLOCK は ClockEvent（打刻ログ）から100%自動導出される値のため、
// 打ち直しても入力自体は変わらず、breakMinutes の計算式だけが新しくなる。
//
// 管理者・CSV取込・手動修正で入力された breakMinutes（source が CLOCK 以外）には
// 触れない（意図的な入力値を上書きしないため）。
//
// GET  ?dryRun=1（既定）: 書き込みを行わず、変わる予定の行だけを一覧で返す
// POST ?dryRun=0        : 実際に再計算してAttendanceを更新する
//
// 用途を終えたら削除してよい一時対応。

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiPermission } from "@/lib/auth/api-guard";
import { computeDerivedAttendance, deriveAndSaveAttendance } from "@/lib/attendance/clock-service";

interface DiffRow {
  userId: string;
  employeeCode: string;
  userName: string;
  date: string;
  oldBreakMinutes: number;
  newBreakMinutes: number;
}

async function collectDiffs(): Promise<DiffRow[]> {
  const targets = await prisma.attendance.findMany({
    where: { source: "CLOCK" },
    include: { user: true },
    orderBy: [{ date: "asc" }, { userId: "asc" }],
  });

  const diffs: DiffRow[] = [];
  for (const record of targets) {
    const derived = await computeDerivedAttendance(record.userId, record.date);
    if (!derived) continue;
    if (derived.breakMinutes !== record.breakMinutes) {
      diffs.push({
        userId: record.userId,
        employeeCode: record.user.employeeCode,
        userName: record.user.name,
        date: record.date,
        oldBreakMinutes: record.breakMinutes,
        newBreakMinutes: derived.breakMinutes,
      });
    }
  }
  return diffs;
}

export async function GET(request: Request) {
  const auth = await requireApiPermission(request, "manageSettings");
  if (!auth.ok) return auth.response;

  const diffs = await collectDiffs();
  return NextResponse.json({ dryRun: true, changedCount: diffs.length, diffs });
}

export async function POST(request: Request) {
  const auth = await requireApiPermission(request, "manageSettings");
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  if (url.searchParams.get("dryRun") === "1") {
    const diffs = await collectDiffs();
    return NextResponse.json({ dryRun: true, changedCount: diffs.length, diffs });
  }

  const diffs = await collectDiffs();
  for (const d of diffs) {
    await deriveAndSaveAttendance(d.userId, d.date);
  }
  return NextResponse.json({ dryRun: false, updatedCount: diffs.length, diffs });
}
