"use client";

// 設定画面のフォーム（勤務ルール・部署管理）

import { useActionState } from "react";
import type { WorkRuleSettings } from "@/lib/attendance/types";
import { ROLES, type Role } from "@/lib/auth/roles";
import {
  addDepartmentAction,
  deleteDepartmentAction,
  saveRoleLabelsAction,
  saveWorkRulesAction,
  type SettingsFormState,
} from "./actions";
import {
  Card,
  buttonPrimaryClass,
  buttonSecondaryClass,
  inputClass,
  labelClass,
} from "@/components/ui";

const initialState: SettingsFormState = { error: null, success: false };

/** 勤務ルール設定フォーム */
export function WorkRulesForm({ rules }: { rules: WorkRuleSettings }) {
  const [state, formAction, pending] = useActionState(saveWorkRulesAction, initialState);

  return (
    <Card>
      <h2 className="mb-1 text-base font-semibold">勤務ルール</h2>
      <p className="mb-5 text-sm text-muted">
        保存すると過去分も含めた全期間の計算に反映されます（打刻データ自体は変わりません）
      </p>

      <form action={formAction} className="space-y-6">
        <fieldset>
          <legend className="mb-3 text-sm font-semibold">夏季勤務</legend>
          <div className="grid gap-4 sm:grid-cols-4">
            <div>
              <label className={labelClass}>期間開始（MM-DD）</label>
              <input
                name="summerStart"
                defaultValue={rules.summer.startMonthDay}
                className={inputClass}
                placeholder="04-01"
              />
            </div>
            <div>
              <label className={labelClass}>期間終了（MM-DD）</label>
              <input
                name="summerEnd"
                defaultValue={rules.summer.endMonthDay}
                className={inputClass}
                placeholder="10-31"
              />
            </div>
            <div>
              <label className={labelClass}>始業</label>
              <input
                type="time"
                name="summerWorkStart"
                defaultValue={rules.summer.workStart}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>終業</label>
              <input
                type="time"
                name="summerWorkEnd"
                defaultValue={rules.summer.workEnd}
                className={inputClass}
              />
            </div>
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-3 text-sm font-semibold">冬季勤務</legend>
          <div className="grid gap-4 sm:grid-cols-4">
            <div>
              <label className={labelClass}>期間開始（MM-DD）</label>
              <input
                name="winterStart"
                defaultValue={rules.winter.startMonthDay}
                className={inputClass}
                placeholder="11-01"
              />
            </div>
            <div>
              <label className={labelClass}>期間終了（MM-DD）</label>
              <input
                name="winterEnd"
                defaultValue={rules.winter.endMonthDay}
                className={inputClass}
                placeholder="03-31"
              />
            </div>
            <div>
              <label className={labelClass}>始業</label>
              <input
                type="time"
                name="winterWorkStart"
                defaultValue={rules.winter.workStart}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>終業</label>
              <input
                type="time"
                name="winterWorkEnd"
                defaultValue={rules.winter.workEnd}
                className={inputClass}
              />
            </div>
          </div>
          <p className="mt-2 text-xs text-muted">
            冬季の終業〜残業開始の間は通常勤務扱いとして計算されます
          </p>
        </fieldset>

        <fieldset>
          <legend className="mb-3 text-sm font-semibold">残業・早出</legend>
          <div className="grid gap-4 sm:grid-cols-5">
            <div>
              <label className={labelClass}>残業開始時刻</label>
              <input
                type="time"
                name="overtimeStart"
                defaultValue={rules.overtimeStart}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>残業割増率（%）</label>
              <input
                type="number"
                name="overtimePremiumRate"
                defaultValue={Math.round(rules.overtimePremiumRate * 100)}
                min={0}
                max={200}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>早出割増率（%）</label>
              <input
                type="number"
                name="earlyPremiumRate"
                defaultValue={Math.round(rules.earlyPremiumRate * 100)}
                min={0}
                max={200}
                className={inputClass}
              />
              <p className="mt-1 text-xs text-muted">
                退勤が残業開始時刻以降の日のみ適用（それ以外の日の早出は通常時給）
              </p>
            </div>
            <div>
              <label className={labelClass}>丸め単位（分）</label>
              <input
                type="number"
                name="overtimeRoundingMinutes"
                defaultValue={rules.overtimeRoundingMinutes}
                min={1}
                max={60}
                className={inputClass}
              />
              <p className="mt-1 text-xs text-muted">
                早出・残業の両方に適用。単位未満は切り捨て
              </p>
            </div>
            <div>
              <label className={labelClass}>早出の計算開始時刻</label>
              <input
                type="time"
                name="earlyWorkStart"
                defaultValue={rules.earlyWorkStart}
                className={inputClass}
              />
              <p className="mt-1 text-xs text-muted">これより前の打刻は集計しない</p>
            </div>
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-3 text-sm font-semibold">締め日</legend>
          <div className="grid gap-4 sm:grid-cols-5">
            <div>
              <label className={labelClass}>締め日（日）</label>
              <input
                type="number"
                name="closingDay"
                defaultValue={rules.closingDay}
                min={1}
                max={31}
                className={inputClass}
              />
              <p className="mt-1 text-xs text-muted">
                25 → 6月度 = 5/26〜6/25。31 = 月末締め（1日〜末日）
              </p>
            </div>
          </div>
        </fieldset>

        {state.error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{state.error}</p>
        )}
        {state.success && !state.error && (
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            勤務ルールを保存しました
          </p>
        )}

        <button type="submit" disabled={pending} className={buttonPrimaryClass}>
          {pending ? "保存中..." : "勤務ルールを保存"}
        </button>
      </form>
    </Card>
  );
}

/**
 * 権限の呼び方（表示名）を変更するフォーム。
 * 「誰が何を見られるか」という権限の中身は変わらず、画面上の呼び名だけを変更する。
 */
export function RoleLabelsForm({ roleLabels }: { roleLabels: Record<Role, string> }) {
  const [state, formAction, pending] = useActionState(saveRoleLabelsAction, initialState);

  return (
    <Card>
      <h2 className="mb-1 text-base font-semibold">権限の呼び方</h2>
      <p className="mb-5 text-sm text-muted">
        各権限の表示名を変更できます（見られる範囲・できる操作は変わりません）
      </p>

      <form action={formAction} className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {ROLES.map((role) => (
            <div key={role}>
              <label className={labelClass}>{roleLabels[role]}</label>
              <input
                type="text"
                name={`label_${role}`}
                defaultValue={roleLabels[role]}
                required
                className={inputClass}
              />
            </div>
          ))}
        </div>

        {state.error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{state.error}</p>
        )}
        {state.success && !state.error && (
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            権限の呼び方を保存しました
          </p>
        )}

        <button type="submit" disabled={pending} className={buttonPrimaryClass}>
          {pending ? "保存中..." : "権限の呼び方を保存"}
        </button>
      </form>
    </Card>
  );
}

/** 部署管理 */
export function DepartmentManager({
  departments,
}: {
  departments: { id: string; name: string; userCount: number }[];
}) {
  const [addState, addAction, addPending] = useActionState(addDepartmentAction, initialState);
  const [deleteState, deleteAction] = useActionState(deleteDepartmentAction, initialState);

  return (
    <Card>
      <h2 className="mb-4 text-base font-semibold">部署管理</h2>

      <ul className="mb-5 divide-y divide-border">
        {departments.map((d) => (
          <li key={d.id} className="flex items-center justify-between py-2.5 text-sm">
            <span>
              {d.name}
              <span className="ml-2 text-xs text-muted">{d.userCount}名</span>
            </span>
            <form
              action={deleteAction}
              onSubmit={(e) => {
                if (!confirm(`部署「${d.name}」を削除しますか？\n所属社員は「未設定」になります。`))
                  e.preventDefault();
              }}
            >
              <input type="hidden" name="id" value={d.id} />
              <button type="submit" className="text-xs text-red-500 hover:underline">
                削除
              </button>
            </form>
          </li>
        ))}
        {departments.length === 0 && (
          <li className="py-2.5 text-sm text-muted">部署が登録されていません</li>
        )}
      </ul>

      {(addState.error || deleteState.error) && (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
          {addState.error ?? deleteState.error}
        </p>
      )}

      <form action={addAction} className="flex gap-2">
        <input
          type="text"
          name="name"
          placeholder="新しい部署名"
          required
          className={inputClass}
        />
        <button type="submit" disabled={addPending} className={buttonSecondaryClass}>
          追加
        </button>
      </form>
    </Card>
  );
}
