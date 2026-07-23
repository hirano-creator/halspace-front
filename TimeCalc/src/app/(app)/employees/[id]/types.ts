// 社員詳細ページの共有型（Route Handler / クライアントコンポーネント両方から使う）

import type { Role } from "@/lib/auth/roles";
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
  summary: { workDays: number; lateCount: number; earlyLeaveCount: number; lateMinutes: number; earlyLeaveMinutes: number };
  monthTotal: { workMinutes: number; earlyOvertimeMinutes: number; overtimeMinutes: number };
  payTotal: { basePay: number; premiumPay: number; totalPay: number };
  logs: AttendanceLogRow[];
}
