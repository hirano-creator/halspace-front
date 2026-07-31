// マイページまわりの共有型（Route Handler / クライアントコンポーネント両方から使う）

import type { SelfEditMode } from "@/lib/auth/features";
import type { MonthlySummary, WeeklyBucket } from "@/lib/attendance/types";
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
  rows: MyDailyRow[];
  /** 週別集計（週単位管理でなければ空配列）。rows と同じく新しい週が先頭 */
  weeks: WeeklyBucket[];
  requests: MyRequestRow[];
}
