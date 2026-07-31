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
  /** 部署ID → その部署が属する会社で次に割り当てる社員番号（新規登録時の自動入力用） */
  nextCodeByDepartment: Record<string, string>;
  /** 部署未設定のときに使う次の社員番号（接頭辞なしの既定ルール） */
  defaultNextCode: string;
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
  /** 会社での絞り込み用（社員番号を会社ごとの体系にしたため一覧でも会社単位で見たい） */
  companies: { id: string; name: string }[];
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
