"use client";

// 社員登録・編集フォーム（新規/編集で共用）

import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createEmployeeAction, updateEmployeeAction } from "./client-actions";
import type { EmployeeFormState } from "./types";
import { ROLES, type Role } from "@/lib/auth/roles";
import { SELF_EDIT_LABELS, CLOCK_MODE_LABELS, type FeatureSettings } from "@/lib/auth/features";
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
  gpsCheckEnabled: boolean;
  features: FeatureSettings;
}

const initialState: EmployeeFormState = { error: null };

export function EmployeeForm({
  departments,
  roleLabels,
  values,
  showMoney,
}: {
  departments: DepartmentOption[];
  roleLabels: Record<Role, string>;
  values?: EmployeeFormValues; // 未指定なら新規登録
  /** 金額（時給）欄を表示するか（設定画面の表示設定に従う） */
  showMoney: boolean;
}) {
  const isEdit = Boolean(values?.id);
  const router = useRouter();
  const [state, formAction, pending] = useActionState(
    isEdit ? updateEmployeeAction : createEmployeeAction,
    initialState,
  );
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (state.success) router.push("/employees");
  }, [state.success, router]);

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
        {showMoney ? (
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
        ) : (
          // 金額非表示中も既存の時給を維持したまま送信する
          <input type="hidden" name="hourlyWage" value={values?.hourlyWage ?? 0} />
        )}
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
          <div className="relative">
            <input
              id="password"
              name="password"
              type={showPassword ? "text" : "password"}
              required={!isEdit}
              autoComplete="new-password"
              className={`${inputClass} pr-16`}
              placeholder="8文字以上"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute inset-y-0 right-0 px-3 text-xs text-muted hover:text-foreground"
            >
              {showPassword ? "隠す" : "表示"}
            </button>
          </div>
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

      <fieldset className="rounded-lg border border-border p-4">
        <legend className="px-1 text-sm font-semibold">機能設定（このスタッフ個別）</legend>
        <div className="space-y-4">
          <div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="gpsCheckEnabled"
                defaultChecked={values?.gpsCheckEnabled ?? true}
                className="h-4 w-4 rounded border-border accent-[var(--primary)]"
              />
              打刻時にGPS位置情報チェックを行う
            </label>
            <p className="mt-1 ml-6 text-xs text-muted">
              オフにすると、所属部署にGPS設定があってもこの社員は範囲外からも打刻できます（外回り・複数店舗掛け持ち等）
            </p>
          </div>

          <div>
            <label htmlFor="selfEdit" className={labelClass}>
              打刻の修正（押し忘れ・誤打刻の対応）
            </label>
            <select
              id="selfEdit"
              name="selfEdit"
              defaultValue={values?.features.selfEdit ?? "request"}
              className={inputClass}
            >
              {(Object.keys(SELF_EDIT_LABELS) as (keyof typeof SELF_EDIT_LABELS)[]).map((mode) => (
                <option key={mode} value={mode}>
                  {SELF_EDIT_LABELS[mode]}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-muted">
              「本人直接修正可」は店長など信頼できるスタッフ向けです（修正履歴は必ず残ります）
            </p>
          </div>

          <div>
            <label htmlFor="clockMode" className={labelClass}>
              打刻方式
            </label>
            <select
              id="clockMode"
              name="clockMode"
              defaultValue={values?.features.clockMode ?? "free"}
              className={inputClass}
            >
              {(Object.keys(CLOCK_MODE_LABELS) as (keyof typeof CLOCK_MODE_LABELS)[]).map(
                (mode) => (
                  <option key={mode} value={mode}>
                    {CLOCK_MODE_LABELS[mode]}
                  </option>
                ),
              )}
            </select>
            <p className="mt-1 text-xs text-muted">
              「QRタップ打刻」「スキャン即打刻」はログイン後の打刻ページからは打刻できず、店舗掲示のQRコードを読み取った場合のみ打刻できます。「スキャン即打刻」は先に部署の打刻QR画面（出勤・退勤QR/外出・戻りQR）を店舗に掲示してから設定してください
            </p>
          </div>

          <div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="showMonthlySummary"
                defaultChecked={values?.features.showMonthlySummary ?? true}
                className="h-4 w-4 rounded border-border accent-[var(--primary)]"
              />
              マイページに月次集計（勤務時間・遅刻回数など）を表示する
            </label>
          </div>

          <div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="companyAttendance"
                defaultChecked={values?.features.companyAttendance ?? false}
                className="h-4 w-4 rounded border-border accent-[var(--primary)]"
              />
              同じ会社の他のスタッフの勤怠を閲覧・修正できる
            </label>
            <p className="mt-1 ml-6 text-xs text-muted">
              一般社員のままでも、所属部署と同じ会社（グループ会社）のスタッフの勤怠一覧・修正・修正申請の承認ができるようになります。会社が異なるスタッフや、部署が未設定で会社を特定できない場合は対象外です（設定変更後は本人が再ログインすると反映されます）
            </p>
          </div>
        </div>
      </fieldset>

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
