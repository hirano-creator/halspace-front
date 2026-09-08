// 共通 UI
//
// Button コンポーネントは作らず、クラス文字列の定数を export する。
// <button> にも <Link> にも同じ見た目を当てられて取り回しが良いため。
//
// スマホ優先の決めごと:
//   - 入力欄のフォントは 16px 以上（text-base）。iOS Safari の自動ズーム対策。PC は sm:text-sm
//   - 入力欄・ボタンの高さは 44px 以上（min-h-11）。PC は sm:min-h-10

import type { ReactNode } from "react";

export const controlHeightClass = "min-h-11 sm:min-h-10";

export const inputClass =
  "w-full rounded-md border border-line bg-card px-3 text-base sm:text-sm text-ink " +
  "placeholder:text-gray-faint focus:border-accent focus:outline-none " +
  controlHeightClass;

export const labelClass = "block text-xs font-semibold tracking-wide text-gray-soft mb-2";

export const buttonPrimaryClass =
  "inline-flex items-center justify-center gap-2 rounded-md bg-accent px-4 text-base sm:text-sm " +
  "font-semibold text-white hover:opacity-90 disabled:opacity-50 " +
  controlHeightClass;

export const buttonSecondaryClass =
  "inline-flex items-center justify-center gap-2 rounded-md border border-line bg-card px-4 " +
  "text-base sm:text-sm text-ink hover:bg-line-2 disabled:opacity-50 " +
  controlHeightClass;

export const buttonDangerClass =
  "inline-flex items-center justify-center gap-2 rounded-md border border-danger bg-card px-4 " +
  "text-base sm:text-sm text-danger hover:bg-red-50 disabled:opacity-50 " +
  controlHeightClass;

/** 選択チップ（未選択） */
export const chipClass =
  "inline-flex items-center rounded-md border border-line bg-card px-3.5 py-2 text-sm text-ink-2 " +
  "min-h-10 cursor-pointer select-none";
/** 選択チップ（選択中・単一選択） */
export const chipOnClass =
  "inline-flex items-center rounded-md border border-navy bg-navy px-3.5 py-2 text-sm font-semibold " +
  "text-white min-h-10 cursor-pointer select-none";
/** 選択チップ（選択中・複数選択） */
export const chipMultiOnClass =
  "inline-flex items-center rounded-md border border-accent bg-accent-soft px-3.5 py-2 text-sm " +
  "font-semibold text-accent min-h-10 cursor-pointer select-none";

/**
 * 一覧の絞り込みボタン。
 * 指が触れる面積を確保するため、スマホでは 44px（min-h-11）を必ず取る。
 * PC では詰めて情報密度を上げる。
 */
const filterBase =
  "inline-flex min-h-11 flex-none items-center rounded-md border px-3.5 text-[13px] sm:min-h-9";
export const filterOnClass = `${filterBase} border-navy bg-navy font-semibold text-white`;
export const filterOffClass = `${filterBase} border-line bg-card text-ink-2`;
export const filterClass = (on: boolean) => (on ? filterOnClass : filterOffClass);

/**
 * 本文中の補助リンク（「すべて見る」「購入履歴を見る」など）。
 * 行の高さは変えずに、上下の余白ぶんをタップ領域として広げる。
 */
export const inlineLinkClass =
  "inline-flex items-center py-2 -my-2 text-[11px] font-medium text-accent hover:underline";

export const thClass =
  "px-4 py-2.5 text-left text-xs font-semibold tracking-wide text-gray-soft whitespace-nowrap";
export const tdClass = "px-4 py-3 text-sm align-middle";

/** 白い帯のカード。枠で囲わず、上下の罫線で区切る（案F の骨格） */
export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <section className={`border-y border-line bg-card ${className}`}>{children}</section>
  );
}

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 px-5 pt-6 sm:px-8">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
        {description && <p className="mt-1.5 text-xs text-gray-soft sm:text-sm">{description}</p>}
      </div>
      {action && <div className="flex-none">{action}</div>}
    </div>
  );
}

/** 指標カード。数字を主役にする */
export function StatCard({
  label,
  value,
  unit,
  sub,
  highlight = false,
}: {
  label: string;
  value: string | number;
  unit?: string;
  sub?: string;
  highlight?: boolean;
}) {
  return (
    <div className="border-r border-line-2 px-4 py-4 last:border-r-0 sm:px-5">
      <div className={`text-[11px] tracking-wide ${highlight ? "font-semibold text-accent" : "text-gray-soft"}`}>
        {label}
      </div>
      <div
        className={`tabular mt-1.5 text-2xl leading-none font-semibold tracking-tight sm:text-3xl ${
          highlight ? "text-accent" : "text-ink"
        }`}
      >
        {value}
        {unit && <span className="ml-0.5 text-xs font-medium text-gray-soft sm:text-sm">{unit}</span>}
      </div>
      {sub && <div className="mt-2 text-[11px] text-gray-faint">{sub}</div>}
    </div>
  );
}

/** ステータス表示。色で塗らず「ドット＋文字」で示す（状態が増えても破綻しないため） */
export function StatusDot({
  tone,
  children,
}: {
  tone: "ok" | "wait" | "off";
  children: ReactNode;
}) {
  const dot =
    tone === "ok"
      ? "bg-accent"
      : tone === "wait"
        ? "border-[1.5px] border-accent bg-white"
        : "bg-gray-faint";
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] whitespace-nowrap text-gray-soft">
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {children}
    </span>
  );
}

export function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="ml-1.5 inline-block rounded-sm bg-accent-soft px-1.5 py-0.5 text-[10.5px] text-accent">
      {children}
    </span>
  );
}

/** 入力欄ひとまとまり。エラーは項目名を含めた文言で表示する */
export function Field({
  label,
  required,
  error,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="py-4">
      <label className={labelClass}>
        {label}
        {required && <span className="ml-1.5 text-[10.5px] font-normal text-accent">必須</span>}
      </label>
      {children}
      {hint && <p className="mt-1.5 text-[11px] text-gray-soft">{hint}</p>}
      {error && <p className="mt-1.5 text-[11px] font-medium text-danger">{error}</p>}
    </div>
  );
}

/** 読み込み中・データなしの共通表示 */
export function Empty({ children }: { children: ReactNode }) {
  return <p className="px-5 py-10 text-center text-sm text-gray-soft sm:px-8">{children}</p>;
}
