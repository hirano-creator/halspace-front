// 勤怠一覧ページの共有型（Route Handler / クライアントコンポーネント両方から使う）

import type { EmployeeMonthlySummary } from "@/lib/attendance/service";

export interface AttendancePageResponse {
  month: string;
  year: number;
  monthNum: number;
  periodRangeLabel: string;
  closingDay: number;
  hasCompanyRules: boolean;
  canExport: boolean;
  showFilters: boolean;
  showMoney: boolean;
  companies: { id: string; name: string }[];
  departments: { id: string; name: string; companyName: string | null }[];
  summaries: EmployeeMonthlySummary[];
}
