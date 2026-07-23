"use client";

// 設定画面のフォーム（勤務ルール・部署管理）
// 勤務ルール・権限の呼び方・表示設定は会社ごとに保存できる。
// companyId が null のフォームは共通設定（全社のデフォルト）を編集する。

import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { WorkRuleSettings } from "@/lib/attendance/types";
import { ROLES, type Role } from "@/lib/auth/roles";
import {
  KEY_DISPLAY,
  KEY_ROLE_LABELS,
  KEY_WORK_RULES,
  type CompanySettingKey,
} from "@/lib/settings-keys";
import {
  addCompanyAction,
  addDepartmentAction,
  deleteCompanyAction,
  deleteDepartmentAction,
  resetCompanySettingAction,
  saveDisplaySettingsAction,
  saveRoleLabelsAction,
  saveWorkRulesAction,
  updateDepartmentCompanyAction,
  updateDepartmentGpsAction,
  updateDepartmentQrKindsAction,
  updateDepartmentQrModeAction,
} from "./client-actions";
import type { SettingsFormState } from "./types";
import {
  Card,
  buttonPrimaryClass,
  buttonSecondaryClass,
  inputClass,
  labelClass,
} from "@/components/ui";

const initialState: SettingsFormState = { error: null, success: false };

/** 会社スコープ（設定画面で選択中の会社。null = 共通設定） */
export interface CompanyScope {
  companyId: string | null;
  companyName: string;
  /** この会社に個別設定が保存されているか（共通タブでは常に false） */
  hasOverride: boolean;
}

/** 会社別の上書き状態バッジ＋「共通設定に戻す」ボタン */
function CompanyOverrideStatus({
  scope,
  settingKey,
  sectionLabel,
}: {
  scope: CompanyScope;
  settingKey: CompanySettingKey;
  sectionLabel: string;
}) {
  const [state, formAction, pending] = useActionState(resetCompanySettingAction, initialState);

  // フォームの入力欄は非制御（defaultValue）のため、リセット成功後は
  // ページを再読み込みして共通設定の値を画面に反映する
  useEffect(() => {
    if (state.success && !state.error) window.location.reload();
  }, [state.success, state.error]);

  if (!scope.companyId) return null;
  if (!scope.hasOverride) {
    return (
      <p className="mb-4 rounded-lg bg-gray-50 px-3 py-2 text-xs text-muted">
        現在は共通設定を使用しています。保存すると「{scope.companyName}」専用の設定になります
      </p>
    );
  }
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg bg-sky-50 px-3 py-2">
      <span className="text-xs font-medium text-sky-700">
        「{scope.companyName}」の個別設定を使用中
      </span>
      <form
        action={formAction}
        onSubmit={(e) => {
          if (
            !confirm(
              `「${scope.companyName}」の${sectionLabel}の個別設定を削除して共通設定に戻しますか？`,
            )
          )
            e.preventDefault();
        }}
      >
        <input type="hidden" name="companyId" value={scope.companyId} />
        <input type="hidden" name="key" value={settingKey} />
        <button
          type="submit"
          disabled={pending}
          className="text-xs text-sky-700 underline hover:no-underline"
        >
          {pending ? "戻しています..." : "共通設定に戻す"}
        </button>
      </form>
      {state.error && <span className="text-xs text-red-600">{state.error}</span>}
    </div>
  );
}

/** 勤務ルール設定フォーム */
export function WorkRulesForm({
  rules,
  scope,
  onSaved,
}: {
  rules: WorkRuleSettings;
  scope: CompanyScope;
  onSaved?: () => void;
}) {
  const [state, formAction, pending] = useActionState(saveWorkRulesAction, initialState);

  useEffect(() => {
    if (state.success && !state.error) onSaved?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.success, state.error]);

  return (
    <Card>
      <h2 className="mb-1 text-base font-semibold">勤務ルール（{scope.companyName}）</h2>
      <p className="mb-4 text-sm text-muted">
        保存すると過去分も含めた全期間の計算に反映されます（打刻データ自体は変わりません）
      </p>
      <CompanyOverrideStatus scope={scope} settingKey={KEY_WORK_RULES} sectionLabel="勤務ルール" />

      <form action={formAction} className="space-y-6">
        <input type="hidden" name="companyId" value={scope.companyId ?? ""} />
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
          <div className="grid gap-4 sm:grid-cols-3">
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
              <label className={labelClass}>残業がつく実働時間（分）</label>
              <input
                type="number"
                name="overtimeThresholdMinutes"
                defaultValue={rules.overtimeThresholdMinutes}
                min={0}
                max={1440}
                step={1}
                className={inputClass}
              />
              <p className="mt-1 text-xs text-muted">
                早出・通常勤務との合計がこの時間（既定480分＝8時間）を超えた分のみ残業になります（例:
                11:00〜19:00 休憩60分は実働7時間のため残業なし）。0にすると残業開始時刻以降を常に残業扱いにします
              </p>
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
          <legend className="mb-3 text-sm font-semibold">休憩</legend>
          <div className="grid gap-4 sm:grid-cols-5">
            <div>
              <label className={labelClass}>休憩開始</label>
              <input
                type="time"
                name="breakStart"
                defaultValue={rules.breakStart}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>休憩終了</label>
              <input
                type="time"
                name="breakEnd"
                defaultValue={rules.breakEnd}
                className={inputClass}
              />
              <p className="mt-1 text-xs text-muted">
                打刻・本人修正・修正申請の勤務時間から自動で差し引きます（マイページの修正フォームでは別途「外出」時間も入力可。休憩時間帯と重なる外出は二重に控除しません）。CSV取込データには適用されません
              </p>
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
export function RoleLabelsForm({
  roleLabels,
  scope,
  onSaved,
}: {
  roleLabels: Record<Role, string>;
  scope: CompanyScope;
  onSaved?: () => void;
}) {
  const [state, formAction, pending] = useActionState(saveRoleLabelsAction, initialState);

  useEffect(() => {
    if (state.success && !state.error) onSaved?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.success, state.error]);

  return (
    <Card>
      <h2 className="mb-1 text-base font-semibold">権限の呼び方（{scope.companyName}）</h2>
      <p className="mb-4 text-sm text-muted">
        各権限の表示名を変更できます（見られる範囲・できる操作は変わりません）
      </p>
      <CompanyOverrideStatus
        scope={scope}
        settingKey={KEY_ROLE_LABELS}
        sectionLabel="権限の呼び方"
      />

      <form action={formAction} className="space-y-5">
        <input type="hidden" name="companyId" value={scope.companyId ?? ""} />
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

export interface CompanyOption {
  id: string;
  name: string;
  departmentCount: number;
}

export interface DepartmentWithGps {
  id: string;
  name: string;
  userCount: number;
  companyId: string | null;
  latitude: number | null;
  longitude: number | null;
  allowedRadiusMeters: number | null;
  dailyQrEnabled: boolean;
  standardQrEnabled: boolean;
  attendQrEnabled: boolean;
  outingQrEnabled: boolean;
}

/** 会社（グループ会社）管理 */
export function CompanyManager({
  companies,
  onSaved,
}: {
  companies: CompanyOption[];
  onSaved?: () => void;
}) {
  const [addState, addAction, addPending] = useActionState(addCompanyAction, initialState);
  const [deleteState, deleteAction] = useActionState(deleteCompanyAction, initialState);

  useEffect(() => {
    if ((addState.success && !addState.error) || (deleteState.success && !deleteState.error)) {
      onSaved?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addState.success, addState.error, deleteState.success, deleteState.error]);

  return (
    <Card>
      <h2 className="mb-1 text-base font-semibold">グループ会社管理</h2>
      <p className="mb-4 text-sm text-muted">
        会社を登録し、部署管理で各部署（店舗）を会社に紐付けると、勤怠一覧を会社単位で絞り込めます
      </p>

      <ul className="mb-5 divide-y divide-border">
        {companies.map((c) => (
          <li key={c.id} className="flex items-center justify-between py-2.5 text-sm">
            <span>
              {c.name}
              <span className="ml-2 text-xs text-muted">{c.departmentCount}部署</span>
            </span>
            <form
              action={deleteAction}
              onSubmit={(e) => {
                if (
                  !confirm(`会社「${c.name}」を削除しますか？\n所属部署は「未所属」になります。`)
                )
                  e.preventDefault();
              }}
            >
              <input type="hidden" name="id" value={c.id} />
              <button type="submit" className="text-xs text-red-500 hover:underline">
                削除
              </button>
            </form>
          </li>
        ))}
        {companies.length === 0 && (
          <li className="py-2.5 text-sm text-muted">会社が登録されていません</li>
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
          placeholder="新しい会社名"
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

/** 表示設定（金額表示のON/OFF） */
export function DisplaySettingsForm({
  showMoney,
  scope,
  onSaved,
}: {
  showMoney: boolean;
  scope: CompanyScope;
  onSaved?: () => void;
}) {
  const [state, formAction, pending] = useActionState(saveDisplaySettingsAction, initialState);

  useEffect(() => {
    if (state.success && !state.error) onSaved?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.success, state.error]);

  return (
    <Card>
      <h2 className="mb-1 text-base font-semibold">表示設定（{scope.companyName}）</h2>
      <p className="mb-4 text-sm text-muted">
        金額表示をオフにしても時給データ・計算ロジックは保持され、オンに戻すと再表示されます
      </p>
      <CompanyOverrideStatus scope={scope} settingKey={KEY_DISPLAY} sectionLabel="表示設定" />

      <form action={formAction} className="space-y-4">
        <input type="hidden" name="companyId" value={scope.companyId ?? ""} />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="showMoney"
            defaultChecked={showMoney}
            className="h-4 w-4 rounded border-border accent-[var(--primary)]"
          />
          金額（時給・残業代・支給額）を画面・CSVに表示する
        </label>

        {state.error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{state.error}</p>
        )}
        {state.success && !state.error && (
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            表示設定を保存しました
          </p>
        )}

        <button type="submit" disabled={pending} className={buttonPrimaryClass}>
          {pending ? "保存中..." : "表示設定を保存"}
        </button>
      </form>
    </Card>
  );
}

/** 部署の所属会社の選択行 */
function DepartmentCompanyRow({
  department,
  companies,
  onSaved,
}: {
  department: { id: string; companyId: string | null };
  companies: CompanyOption[];
  onSaved?: () => void;
}) {
  const [state, formAction, pending] = useActionState(
    updateDepartmentCompanyAction,
    initialState,
  );

  useEffect(() => {
    if (state.success && !state.error) onSaved?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.success, state.error]);

  return (
    <form action={formAction} className="mt-2 flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={department.id} />
      <label className="text-xs text-muted">所属会社</label>
      <select
        name="companyId"
        defaultValue={department.companyId ?? ""}
        className={`${inputClass} w-auto`}
      >
        <option value="">未所属</option>
        {companies.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <button type="submit" disabled={pending} className={buttonSecondaryClass}>
        {pending ? "保存中..." : "保存"}
      </button>
      {state.error && (
        <p className="w-full rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{state.error}</p>
      )}
      {state.success && !state.error && (
        <p className="w-full rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          保存しました
        </p>
      )}
    </form>
  );
}

/** 部署の日替わりQRモード切り替え行 */
function DepartmentQrModeRow({
  department,
  onSaved,
}: {
  department: { id: string; dailyQrEnabled: boolean };
  onSaved?: () => void;
}) {
  const [state, formAction, pending] = useActionState(updateDepartmentQrModeAction, initialState);

  useEffect(() => {
    if (state.success && !state.error) onSaved?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.success, state.error]);

  return (
    <form action={formAction} className="mt-2 flex flex-wrap items-center gap-3">
      <input type="hidden" name="id" value={department.id} />
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="dailyQrEnabled"
          defaultChecked={department.dailyQrEnabled}
          className="h-4 w-4 rounded border-border accent-[var(--primary)]"
        />
        毎日QRコードを変更する（不正打刻防止。印刷は不可、店舗にタブレット/モニタの常設が必要）
      </label>
      <button type="submit" disabled={pending} className={buttonSecondaryClass}>
        {pending ? "保存中..." : "保存"}
      </button>
      {state.error && (
        <p className="w-full rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
          {state.error}
        </p>
      )}
      {state.success && !state.error && (
        <p className="w-full rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          保存しました
        </p>
      )}
    </form>
  );
}

/** 部署のQR表示画面に表示するQRの種類を選ぶ行 */
function DepartmentQrKindsRow({
  department,
  onSaved,
}: {
  department: {
    id: string;
    standardQrEnabled: boolean;
    attendQrEnabled: boolean;
    outingQrEnabled: boolean;
  };
  onSaved?: () => void;
}) {
  const [state, formAction, pending] = useActionState(updateDepartmentQrKindsAction, initialState);

  useEffect(() => {
    if (state.success && !state.error) onSaved?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.success, state.error]);

  return (
    <form action={formAction} className="mt-2 flex flex-wrap items-center gap-4">
      <input type="hidden" name="id" value={department.id} />
      <span className="text-xs text-muted">表示するQR</span>
      <label className="flex items-center gap-1.5 text-sm">
        <input
          type="checkbox"
          name="standardQrEnabled"
          defaultChecked={department.standardQrEnabled}
          className="h-4 w-4 rounded border-border accent-[var(--primary)]"
        />
        標準QR
      </label>
      <label className="flex items-center gap-1.5 text-sm">
        <input
          type="checkbox"
          name="attendQrEnabled"
          defaultChecked={department.attendQrEnabled}
          className="h-4 w-4 rounded border-border accent-[var(--primary)]"
        />
        出勤・退勤QR
      </label>
      <label className="flex items-center gap-1.5 text-sm">
        <input
          type="checkbox"
          name="outingQrEnabled"
          defaultChecked={department.outingQrEnabled}
          className="h-4 w-4 rounded border-border accent-[var(--primary)]"
        />
        外出・戻りQR
      </label>
      <button type="submit" disabled={pending} className={buttonSecondaryClass}>
        {pending ? "保存中..." : "保存"}
      </button>
      {state.error && (
        <p className="w-full rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
          {state.error}
        </p>
      )}
      {state.success && !state.error && (
        <p className="w-full rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          保存しました
        </p>
      )}
    </form>
  );
}

/** 1部署分のGPS打刻設定行（緯度・経度・許容半径・QR表示リンク） */
function DepartmentGpsRow({
  department,
  onSaved,
}: {
  department: DepartmentWithGps;
  onSaved?: () => void;
}) {
  const [state, formAction, pending] = useActionState(updateDepartmentGpsAction, initialState);
  const latRef = useRef<HTMLInputElement>(null);
  const lngRef = useRef<HTMLInputElement>(null);
  const [locating, setLocating] = useState(false);

  useEffect(() => {
    if (state.success && !state.error) onSaved?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.success, state.error]);

  function useCurrentLocation() {
    if (!("geolocation" in navigator)) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (latRef.current) latRef.current.value = String(pos.coords.latitude);
        if (lngRef.current) lngRef.current.value = String(pos.coords.longitude);
        setLocating(false);
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  return (
    <form action={formAction} className="mt-2 flex flex-wrap items-end gap-2">
      <input type="hidden" name="id" value={department.id} />
      <div className="w-28">
        <label className="mb-1 block text-xs text-muted">緯度</label>
        <input
          ref={latRef}
          type="text"
          inputMode="decimal"
          name="latitude"
          defaultValue={department.latitude ?? ""}
          className={inputClass}
        />
      </div>
      <div className="w-28">
        <label className="mb-1 block text-xs text-muted">経度</label>
        <input
          ref={lngRef}
          type="text"
          inputMode="decimal"
          name="longitude"
          defaultValue={department.longitude ?? ""}
          className={inputClass}
        />
      </div>
      <div className="w-24">
        <label className="mb-1 block text-xs text-muted">半径(m)</label>
        <input
          type="number"
          name="allowedRadiusMeters"
          defaultValue={department.allowedRadiusMeters ?? ""}
          min={10}
          max={5000}
          className={inputClass}
        />
      </div>
      <button
        type="button"
        onClick={useCurrentLocation}
        disabled={locating}
        className={buttonSecondaryClass}
      >
        {locating ? "取得中..." : "現在地を使用"}
      </button>
      <button type="submit" disabled={pending} className={buttonPrimaryClass}>
        {pending ? "保存中..." : "GPS設定を保存"}
      </button>
      <Link href={`/settings/qr/${department.id}`} className={buttonSecondaryClass}>
        QR表示
      </Link>

      {state.error && (
        <p className="w-full rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
          {state.error}
        </p>
      )}
      {state.success && !state.error && (
        <p className="w-full rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          GPS設定を保存しました
        </p>
      )}
    </form>
  );
}

/** 部署管理（選択中の会社の部署のみ表示。共通タブでは未所属の部署を表示） */
export function DepartmentManager({
  departments,
  companies,
  scope,
  onSaved,
}: {
  departments: DepartmentWithGps[];
  companies: CompanyOption[];
  scope: CompanyScope;
  onSaved?: () => void;
}) {
  const [addState, addAction, addPending] = useActionState(addDepartmentAction, initialState);
  const [deleteState, deleteAction] = useActionState(deleteDepartmentAction, initialState);

  useEffect(() => {
    if ((addState.success && !addState.error) || (deleteState.success && !deleteState.error)) {
      onSaved?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addState.success, addState.error, deleteState.success, deleteState.error]);

  return (
    <Card>
      <h2 className="mb-1 text-base font-semibold">部署管理（{scope.companyName}）</h2>
      <p className="mb-4 text-sm text-muted">
        緯度・経度・許容半径をすべて設定すると、その部署をQRコード経由やこの部署に所属する社員が打刻する際にGPS位置情報チェックが有効になります
      </p>

      <ul className="mb-5 divide-y divide-border">
        {departments.map((d) => (
          <li key={d.id} className="py-3 text-sm">
            <div className="flex items-center justify-between">
              <span>
                {d.name}
                <span className="ml-2 text-xs text-muted">{d.userCount}名</span>
              </span>
              <form
                action={deleteAction}
                onSubmit={(e) => {
                  if (
                    !confirm(`部署「${d.name}」を削除しますか？\n所属社員は「未設定」になります。`)
                  )
                    e.preventDefault();
                }}
              >
                <input type="hidden" name="id" value={d.id} />
                <button type="submit" className="text-xs text-red-500 hover:underline">
                  削除
                </button>
              </form>
            </div>
            {scope.companyId === null && companies.length > 0 && (
              <DepartmentCompanyRow department={d} companies={companies} onSaved={onSaved} />
            )}
            <DepartmentGpsRow department={d} onSaved={onSaved} />
            <DepartmentQrModeRow department={d} onSaved={onSaved} />
            <DepartmentQrKindsRow department={d} onSaved={onSaved} />
          </li>
        ))}
        {departments.length === 0 && (
          <li className="py-2.5 text-sm text-muted">
            {scope.companyId
              ? "この会社に紐付いた部署がありません"
              : "未所属の部署はありません"}
          </li>
        )}
      </ul>

      {(addState.error || deleteState.error) && (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
          {addState.error ?? deleteState.error}
        </p>
      )}

      <form action={addAction} className="flex gap-2">
        <input type="hidden" name="companyId" value={scope.companyId ?? ""} />
        <input
          type="text"
          name="name"
          placeholder={
            scope.companyId
              ? `${scope.companyName}に部署を追加`
              : "新しい部署名（未所属で作成）"
          }
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
