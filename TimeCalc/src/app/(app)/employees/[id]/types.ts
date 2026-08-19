// 社員詳細ページの共有型（Route Handler / クライアントコンポーネント両方から使う）

import type { Role } from "@/lib/auth/roles";
import type { WeeklyBucket, WeeklyTotals } from "@/lib/attendance/types";
import type { DailyRow } from "./attendance-editor";

export interface AttendanceEditState {
  error: string | null;
  success: boolean;
}

export interface AttendanceLogRow {
  id: string;
  date: string;
  action: string; // "EDIT" | "DELETE" | "APPROVE" | "REJECT"
  before: string | null;
  after: string | null;
  note: string | null;
  actorName: string | null;
  createdAtLabel: string;
}

export interface EmployeeDetailResponse {
  employee: {
    id: string;
    name: string;
    employeeCode: string;
    departmentName: string | null;
    hourlyWage: number;
    isActive: boolean;
    role: Role;
  };
  roleLabels: Record<Role, string>;
  showMoney: boolean;
  editable: boolean;
  month: string;
  year: number;
  monthNum: number;
  periodRangeLabel: string;
  closingDay: number;
  rows: DailyRow[];
  summary: {
    workDays: number;
    /** 法定外残業の月度合計（分）。日ごとの「実働 − 法定勤務時間」の累計で、負にもなる */
    legalOvertimeMinutes: number;
    lateCount: number;
    earlyLeaveCount: number;
    lateMinutes: number;
    earlyLeaveMinutes: number;
  };
  monthTotal: { workMinutes: number; earlyOvertimeMinutes: number; overtimeMinutes: number };
  payTotal: { basePay: number; premiumPay: number; totalPay: number };
  /** 所属会社が週単位管理か（統計カードと列見出しの出し分けに使う） */
  weeklyEnabled: boolean;
  /** 週別集計（週単位管理でなければ空配列） */
  weeks: WeeklyBucket[];
  /** 週別集計の月度合計（週単位管理でなければ null） */
  weeklyTotals: WeeklyTotals | null;
  logs: AttendanceLogRow[];
}
