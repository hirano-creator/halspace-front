// 設定画面の共有型（Route Handler / クライアントコンポーネント両方から使う）

import type { WorkRuleSettings } from "@/lib/attendance/types";
import type { Role } from "@/lib/auth/roles";
import type { CompanyOption, DepartmentWithGps } from "./settings-forms";

export interface SettingsFormState {
  error: string | null;
  success: boolean;
}

export interface SettingsPageResponse {
  companies: CompanyOption[];
  selectedCompanyId: string | null;
  selectedCompanyName: string | null;
  /** 社員番号の接頭辞（会社タブを開いているときのみ。共通タブでは null） */
  codePrefix: string | null;
  /** 社員番号の連番の桁数（会社タブを開いているときのみ） */
  codeDigits: number | null;
  /** その会社で次に割り当てられる社員番号（会社タブを開いているときのみ） */
  nextEmployeeCode: string | null;
  rules: WorkRuleSettings;
  roleLabels: Record<Role, string>;
  showMoney: boolean;
  departments: DepartmentWithGps[];
  overrideKeys: string[];
}
