// 汎用UIコンポーネント（カード・ボタン・バッジなど）

import type { ReactNode } from "react";

/** カード（白背景・角丸・薄い枠線） */
export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-xl border border-border bg-surface p-6 shadow-sm ${className}`}>
      {children}
    </div>
  );
}

/** ページタイトルとアクションの行 */
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
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {action && <div className="w-full sm:w-auto">{action}</div>}
    </div>
  );
}

/** 統計カード（社員詳細の月度サマリーなど） */
export function StatCard({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: string;
  sub?: string;
  /** カードの種類を色でほのめかす（default=通常項目、amber=割増系、primary=金額の主役） */
  tone?: "default" | "amber" | "primary";
}) {
  const toneClass = {
    default: "border-border bg-surface",
    amber: "border-amber-200/70 bg-amber-50/50",
    primary: "border-primary/25 bg-violet-50/60",
  }[tone];
  const valueClass = tone === "primary" ? "text-primary" : "text-foreground";

  return (
    <div className={`rounded-xl border px-4 py-3.5 shadow-sm ${toneClass}`}>
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className={`mt-1 text-2xl leading-tight font-semibold tracking-tight ${valueClass}`}>
        {value}
      </p>
      {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
    </div>
  );
}

/** ロール等の表示用バッジ */
export function Badge({
  children,
  tone = "gray",
}: {
  children: ReactNode;
  tone?: "gray" | "purple" | "green" | "red" | "amber";
}) {
  const tones = {
    gray: "bg-gray-100 text-gray-700",
    purple: "bg-violet-100 text-violet-700",
    green: "bg-emerald-100 text-emerald-700",
    red: "bg-red-100 text-red-700",
    amber: "bg-amber-100 text-amber-700",
  } as const;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

/** フォーム入力の共通クラス */
export const inputClass =
  "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20";

/** プライマリボタンの共通クラス */
export const buttonPrimaryClass =
  "inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50";

/** セカンダリボタンの共通クラス */
export const buttonSecondaryClass =
  "inline-flex items-center justify-center rounded-lg border border-border bg-white px-4 py-2 text-sm font-medium text-foreground transition hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50";

/** ラベルの共通クラス */
export const labelClass = "mb-1 block text-sm font-medium text-foreground";

/** テーブル用の共通クラス */
export const thClass =
  "px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted";
export const tdClass = "px-4 py-3 text-sm";
