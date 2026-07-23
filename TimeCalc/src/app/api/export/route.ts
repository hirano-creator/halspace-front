// CSV出力エンドポイント
// GET /api/export?month=YYYY-MM&type=summary|daily&department=&q=
// type=summary: 社員別月次集計 / type=daily: 日別明細

import { NextResponse, type NextRequest } from "next/server";
import { requireApiUser } from "@/lib/auth/api-guard";
import { can } from "@/lib/auth/roles";
import { getMonthlyAttendance, getMonthlySummaries } from "@/lib/attendance/service";
import {
  getAllWorkRules,
  getCompanyIdForDepartment,
  getDisplaySettings,
  workRulesFor,
} from "@/lib/settings";
import { currentPeriod, minutesToHHMM } from "@/lib/utils/time";

/** CSVフィールドのエスケープ（カンマ・引用符・改行対応） */
function csvField(value: string | number): string {
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows: (string | number)[][]): string {
  // Excelで文字化けしないようUTF-8 BOMを付ける
  return String.fromCharCode(0xfeff) + rows.map((row) => row.map(csvField).join(",")).join("\r\n");
}

export async function GET(request: NextRequest) {
  const auth = await requireApiUser(request);
  if (!auth.ok) return auth.response;
  const user = auth.user;
  if (!can(user.role, "exportCsv")) {
    return NextResponse.json({ error: "CSV出力の権限がありません" }, { status: 403 });
  }

  const params = request.nextUrl.searchParams;
  const type = params.get("type") === "daily" ? "daily" : "summary";
  const departmentId = params.get("department") || undefined;
  const companyId = params.get("company") || undefined;
  const query = params.get("q")?.trim() || undefined;

  const viewerCompanyId = await getCompanyIdForDepartment(user.departmentId);
  const [allRules, { showMoney }] = await Promise.all([
    getAllWorkRules(),
    getDisplaySettings(viewerCompanyId),
  ]);
  // 月度の既定値は絞り込み対象の会社（未指定なら共通設定）の締め日に従う
  const month = /^\d{4}-\d{2}$/.test(params.get("month") ?? "")
    ? params.get("month")!
    : currentPeriod(workRulesFor(allRules, companyId ?? null).closingDay);

  let csv: string;
  if (type === "summary") {
    const summaries = await getMonthlySummaries(
      user,
      month,
      { departmentId, companyId, query },
      allRules,
    );
    csv = toCsv([
      [
        "社員番号",
        "氏名",
        "部署",
        ...(showMoney ? ["時給"] : []),
        "勤務日数",
        "勤務時間",
        "早出残業",
        "残業時間",
        "遅刻回数",
        "早退回数",
        ...(showMoney ? ["金額", "残業代", "支給額合計"] : []),
      ],
      ...summaries.map((s) => [
        s.employeeCode,
        s.userName,
        s.departmentName ?? "",
        ...(showMoney ? [s.hourlyWage] : []),
        s.summary.workDays,
        minutesToHHMM(
          s.summary.normalMinutes + (s.summary.earlyMinutes - s.summary.earlyOvertimeMinutes),
        ),
        minutesToHHMM(s.summary.earlyOvertimeMinutes),
        minutesToHHMM(s.summary.overtimeMinutes),
        s.summary.lateCount,
        s.summary.earlyLeaveCount,
        ...(showMoney ? [s.pay.basePay, s.pay.premiumPay, s.pay.totalPay] : []),
      ]),
    ]);
  } else {
    const { rows } = await getMonthlyAttendance(
      user,
      month,
      { departmentId, companyId, query },
      allRules,
    );
    csv = toCsv([
      [
        "社員番号",
        "氏名",
        "部署",
        "日付",
        "実出勤",
        "実退勤",
        "出勤時間",
        "退勤時間",
        "休憩(分)",
        "勤務時間",
        "早出残業",
        "残業時間",
        "遅刻(分)",
        "早退(分)",
        "遅刻理由",
        "早退理由",
        ...(showMoney ? ["金額", "残業代", "支給額"] : []),
        "備考",
      ],
      ...rows.map((r) => [
        r.employeeCode,
        r.userName,
        r.departmentName ?? "",
        r.date,
        r.clockIn,
        r.clockOut,
        r.calc.error ? "" : r.calc.roundedClockIn,
        r.calc.error ? "" : r.calc.roundedClockOut,
        r.breakMinutes,
        r.calc.error ? `エラー: ${r.calc.error}` : minutesToHHMM(r.calc.totalMinutes),
        r.calc.error
          ? ""
          : minutesToHHMM(r.calc.earlyPremiumApplies ? r.calc.earlyMinutes : 0),
        r.calc.error ? "" : minutesToHHMM(r.calc.overtimeMinutes),
        r.calc.error ? "" : r.calc.lateMinutes || "",
        r.calc.error ? "" : r.calc.earlyLeaveMinutes || "",
        r.lateReason ?? "",
        r.earlyLeaveReason ?? "",
        ...(showMoney
          ? [
              r.calc.error ? "" : r.pay.basePay,
              r.calc.error ? "" : r.pay.premiumPay,
              r.calc.error ? "" : r.pay.totalPay,
            ]
          : []),
        r.note ?? "",
      ]),
    ]);
  }

  const fileName = `kintai_${type === "summary" ? "shukei" : "meisai"}_${month}.csv`;
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
}
