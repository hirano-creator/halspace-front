// 汎用UIコンポーネント（カード・ボタン・バッジなど）

import type { ReactNode } from "react";

/**
 * カード（白背景・角丸・薄い枠線）
 *
 * 余白はスマホで詰める（p-4）。呼び出し側で余白を打ち消す場合は、
 * メディアクエリの `sm:p-6` に負けないよう `p-0!` のように `!` を付けること。
 */
export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-xl border border-border bg-surface p-4 shadow-sm sm:p-6 ${className}`}>
      {children}
    </div>
  );
}

/**
 * 横幅の広い表を載せるカード。
 * スマホでは表が画面幅に収まらず横スクロールになるため、スクロールできることを一言添える
 * （見えている範囲が全てだと誤解されるのを防ぐ）。見出しやボタンは header に渡すと
 * スクロール領域の外に固定される。
 */
export function TableCard({
  children,
  header,
  className = "",
}: {
  children: ReactNode;
  /** 表の上に置く見出し・操作（横スクロールしても動かない） */
  header?: ReactNode;
  className?: string;
}) {
  return (
    <Card className={`p-0! ${className}`}>
      {header}
      <p className="border-b border-border bg-gray-50/50 px-4 py-1.5 text-xs text-muted md:hidden">
        ← 横にスクロールできます
      </p>
      <div className="overflow-x-auto">{children}</div>
    </Card>
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
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3 sm:mb-6 sm:gap-4">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
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

/**
 * 入力欄とボタンで共有する高さ。
 * 横に並べたときに高さが揃うよう、両方に同じ値を当てる（スマホは指で押しやすい44px、PCは40px）。
 * min-h なので文字が折り返しても潰れない。
 */
export const controlHeightClass = "min-h-11 sm:min-h-10";

/**
 * フォーム入力の共通クラス。
 * スマホだけ16pxにするのは、iOS Safariが16px未満の入力にフォーカスすると画面を
 * 自動ズームしてしまうため（PCは sm: で従来の14pxに戻す）。
 */
export const inputClass = `w-full ${controlHeightClass} rounded-lg border border-border bg-white px-3 py-2 text-base outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 sm:text-sm`;

/** プライマリボタンの共通クラス */
export const buttonPrimaryClass = `inline-flex ${controlHeightClass} items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50`;

/** セカンダリボタンの共通クラス */
export const buttonSecondaryClass = `inline-flex ${controlHeightClass} items-center justify-center rounded-lg border border-border bg-white px-4 py-2 text-sm font-medium text-foreground transition hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50`;

/** ラベルの共通クラス */
export const labelClass = "mb-1 block text-sm font-medium text-foreground";

/** テーブル用の共通クラス */
export const thClass =
  "px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted";
export const tdClass = "px-4 py-3 text-sm";
