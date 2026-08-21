// マイページまわりの共有型（Route Handler / クライアントコンポーネント両方から使う）

import type { SelfEditMode } from "@/lib/auth/features";
import type { MonthlySummary, WeeklyBucket, WeeklyTotals } from "@/lib/attendance/types";
import type { MyDailyRow } from "./my-attendance-table";
import type { MyRequestRow } from "./my-requests";

export interface MyActionState {
  error: string | null;
  success: boolean;
}

export interface MyPageResponse {
  me: { name: string; departmentName: string | null };
  month: string;
  year: number;
  monthNum: number;
  periodRangeLabel: string;
  openCount: number;
  showMonthlySummary: boolean;
  selfEditMode: SelfEditMode;
  summary: MonthlySummary;
  /** 月度合計（日別の合計。社員詳細画面と同じ集計） */
  monthTotal: {
    workMinutes: number;
    earlyOvertimeMinutes: number;
    overtimeMinutes: number;
    /** 控除時間の月度合計（分）。日別「控除時間」列（実外出＋遅刻＋早退）の合計 */
    deductionMinutes: number;
  };
  rows: MyDailyRow[];
  /** 週別集計（週単位管理でなければ空配列）。rows と同じく新しい週が先頭 */
  weeks: WeeklyBucket[];
  /** 週別集計の月度合計（週単位管理でなければ null） */
  weeklyTotals: WeeklyTotals | null;
  requests: MyRequestRow[];
}
