// 社員管理まわりの共有型（Route Handler / クライアントコンポーネント両方から使う）

import type { Role } from "@/lib/auth/roles";
import type { DepartmentOption } from "./employee-form";

export interface EmployeeFormState {
  error: string | null;
  /** 保存成功後に立つ（クライアント側でリダイレクトを判断するため） */
  success?: boolean;
}

export interface EmployeeDeleteState {
  error: string | null;
}

export interface FormOptionsResponse {
  departments: DepartmentOption[];
  roleLabels: Record<Role, string>;
  showMoney: boolean;
}

export interface EmployeeRow {
  id: string;
  employeeCode: string;
  name: string;
  email: string | null;
  departmentLabel: string | null;
  role: Role;
  hourlyWage: number;
  isActive: boolean;
}

export interface EmployeesPageResponse {
  viewerId: string;
  employees: EmployeeRow[];
  total: number;
  totalPages: number;
  page: number;
  departments: DepartmentOption[];
  roleLabels: Record<Role, string>;
  showMoney: boolean;
}

export interface EmployeeDetailValues {
  id: string;
  employeeCode: string;
  name: string;
  email: string;
  role: Role;
  hourlyWage: number;
  departmentId: string;
  isActive: boolean;
  gpsCheckEnabled: boolean;
  features: import("@/lib/auth/features").FeatureSettings;
}
