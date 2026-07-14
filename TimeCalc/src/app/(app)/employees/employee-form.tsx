"use client";

// 社員登録・編集フォーム（新規/編集で共用）

import { useActionState } from "react";
import Link from "next/link";
import {
  createEmployeeAction,
  updateEmployeeAction,
  type EmployeeFormState,
} from "./actions";
import { ROLES, type Role } from "@/lib/auth/roles";
import {
  buttonPrimaryClass,
  buttonSecondaryClass,
  inputClass,
  labelClass,
} from "@/components/ui";

export interface DepartmentOption {
  id: string;
  name: string;
}

export interface EmployeeFormValues {
  id?: string;
  employeeCode: string;
  name: string;
  email: string;
  role: Role;
  hourlyWage: number;
  departmentId: string;
  isActive: boolean;
}

const initialState: EmployeeFormState = { error: null };

export function EmployeeForm({
  departments,
  roleLabels,
  values,
}: {
  departments: DepartmentOption[];
  roleLabels: Record<Role, string>;
  values?: EmployeeFormValues; // 未指定なら新規登録
}) {
  const isEdit = Boolean(values?.id);
  const [state, formAction, pending] = useActionState(
    isEdit ? updateEmployeeAction : createEmployeeAction,
    initialState,
  );

  return (
    <form action={formAction} className="space-y-5">
      {isEdit && <input type="hidden" name="id" value={values!.id} />}

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="employeeCode" className={labelClass}>
            社員番号 <span className="text-red-500">*</span>
          </label>
          <input
            id="employeeCode"
            name="employeeCode"
            type="text"
            required
            defaultValue={values?.employeeCode ?? ""}
            className={inputClass}
            placeholder="0005"
          />
        </div>
        <div>
          <label htmlFor="name" className={labelClass}>
            氏名 <span className="text-red-500">*</span>
          </label>
          <input
            id="name"
            name="name"
            type="text"
            required
            defaultValue={values?.name ?? ""}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="email" className={labelClass}>
            メールアドレス
          </label>
          <input
            id="email"
            name="email"
            type="email"
            defaultValue={values?.email ?? ""}
            className={inputClass}
            placeholder="任意（メールでもログイン可能になります）"
          />
        </div>
        <div>
          <label htmlFor="role" className={labelClass}>
            権限 <span className="text-red-500">*</span>
          </label>
          <select
            id="role"
            name="role"
            defaultValue={values?.role ?? "EMPLOYEE"}
            className={inputClass}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {roleLabels[r]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="hourlyWage" className={labelClass}>
            時給（円） <span className="text-red-500">*</span>
          </label>
          <input
            id="hourlyWage"
            name="hourlyWage"
            type="number"
            min={0}
            max={100000}
            required
            defaultValue={values?.hourlyWage ?? 0}
            className={inputClass}
            placeholder="1200"
          />
          <p className="mt-1 text-xs text-muted">金額計算に使用します（0円のままだと金額は表示されません）</p>
        </div>
        <div>
          <label htmlFor="departmentId" className={labelClass}>
            部署
          </label>
          <select
            id="departmentId"
            name="departmentId"
            defaultValue={values?.departmentId ?? ""}
            className={inputClass}
          >
            <option value="">未設定</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="password" className={labelClass}>
            {isEdit ? "新しいパスワード（変更する場合のみ）" : "初期パスワード"}
            {!isEdit && <span className="ml-1 text-red-500">*</span>}
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required={!isEdit}
            autoComplete="new-password"
            className={inputClass}
            placeholder="8文字以上"
          />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="isActive"
          defaultChecked={values?.isActive ?? true}
          className="h-4 w-4 rounded border-border accent-[var(--primary)]"
        />
        在籍中（オフにするとログインできなくなります）
      </label>

      {state.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{state.error}</p>
      )}

      <div className="flex gap-3">
        <button type="submit" disabled={pending} className={buttonPrimaryClass}>
          {pending ? "保存中..." : isEdit ? "更新する" : "登録する"}
        </button>
        <Link href="/employees" className={buttonSecondaryClass}>
          キャンセル
        </Link>
      </div>
    </form>
  );
}
