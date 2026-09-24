// ページ上部の共通見出し（社員詳細・マイページ・勤怠一覧・社員管理で共通）。
// 印刷で1ページ目に表を多く入れるため、旧PageHeader（title+説明文で2段）をやめ、
// タイトル・属性・右側情報を1段にまとめて下線で区切る。月度サマリーはカードではなく
// 「上に項目名・下に数字」を均等幅で並べて縦線で区切る帯にする。

import type { ReactNode } from "react";
import { formatMinutes } from "@/lib/utils/time";
import type { WeeklyTotals } from "@/lib/attendance/types";

export type SummaryItem = {
  label: string;
  value: string;
  sub?: string;
  /** 数字の色で種類をほのめかす（amber=割増系・要注意、primary=金額の主役） */
  tone?: "amber" | "primary";
};

/** 名前の右に並べる「ラベル 値」の小さな表記（社員番号・所属など） */
export function MetaItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span>
      <span className="mr-1 text-muted">{label}</span>
      {children}
    </span>
  );
}

/**
 * タイトル・属性（meta）・右側情報（period）・操作（actions）を1段にまとめ、下線で区切る見出し。
 * 社員詳細・マイページでは period に月度、勤怠一覧では period に対象月度、
 * 社員管理のように月度の概念がないページでは period を省略できる。
 * actions は印刷時に隠す。
 */
export function SheetHeader({
  name,
  meta,
  period,
  actions,
}: {
  name: string;
  meta: ReactNode;
  period?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-b-2 border-foreground pb-2">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-xl font-semibold tracking-tight">{name}</h1>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-700">
          {meta}
        </div>
      </div>
      {(period || actions) && (
        <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-2 sm:w-auto">
          {period && <span className="text-xs text-gray-700">{period}</span>}
          {actions && <div className="w-full sm:w-auto print:hidden">{actions}</div>}
        </div>
      )}
    </div>
  );
}

/**
 * 月度サマリーの勤務系の項目（勤務日数〜遅刻・早退）。
 * 社員詳細とマイページで同じ月度が違う数字に見えないよう、項目・並びをここで一本化する。
 */
export function monthSummaryItems({
  summary,
  monthTotal,
  weeklyTotals,
}: {
  summary: {
    workDays: number;
    legalOvertimeMinutes: number;
    lateCount: number;
    earlyLeaveCount: number;
  };
  monthTotal: {
    workMinutes: number;
    earlyOvertimeMinutes: number;
    overtimeMinutes: number;
    deductionMinutes: number;
  };
  weeklyTotals: WeeklyTotals | null;
}): SummaryItem[] {
  const deduction: SummaryItem = {
    label: "控除時間",
    value: formatMinutes(monthTotal.deductionMinutes),
    tone: monthTotal.deductionMinutes > 0 ? "amber" : undefined,
  };
  const legalOvertime: SummaryItem = {
    label: "法定外残業",
    value: formatMinutes(summary.legalOvertimeMinutes),
    tone: "amber",
  };
  return [
    { label: "勤務日数", value: `${summary.workDays}日` },
    // 週単位管理の会社は残業を週合計で区分するため、早出残業・残業の代わりに2区分を出す
    ...(weeklyTotals
      ? [
          { label: "勤務時間", value: formatMinutes(weeklyTotals.totalMinutes) },
          deduction,
          legalOvertime,
          {
            label: "36H超44H以内",
            value: formatMinutes(weeklyTotals.withinLegalOvertimeMinutes),
            tone: "amber" as const,
          },
          {
            label: "44H超",
            value: formatMinutes(weeklyTotals.overLegalOvertimeMinutes),
            tone: "amber" as const,
          },
        ]
      : [
          { label: "勤務時間", value: formatMinutes(monthTotal.workMinutes) },
          deduction,
          legalOvertime,
          {
            label: "早出残業",
            value: formatMinutes(monthTotal.earlyOvertimeMinutes),
            tone: "amber" as const,
          },
          {
            label: "残業時間",
            value: formatMinutes(monthTotal.overtimeMinutes),
            tone: "amber" as const,
          },
        ]),
    {
      label: "遅刻・早退",
      value: `${summary.lateCount}・${summary.earlyLeaveCount}回`,
      tone: summary.lateCount + summary.earlyLeaveCount > 0 ? "amber" : undefined,
    },
  ];
}

/**
 * 月度サマリーの帯。スマホは4列で折り返すため、各行の先頭では縦線を消す
 * （md以上は1行に並ぶので先頭だけ消す）。
 */
export function SummaryStrip({
  items,
  className = "",
}: {
  items: SummaryItem[];
  className?: string;
}) {
  const colsClass = items.length > 7 ? "md:grid-cols-8" : "md:grid-cols-7";
  return (
    <div
      className={`mt-3 grid grid-cols-4 gap-y-3 rounded-lg border border-border bg-surface py-2.5 ${colsClass} ${className}`}
    >
      {items.map((item, i) => {
        const dividerClass = i === 0 ? "" : i % 4 === 0 ? "md:border-l-2" : "border-l-2";
        const valueClass =
          item.tone === "amber"
            ? "text-amber-700"
            : item.tone === "primary"
              ? "text-primary"
              : "text-foreground";
        return (
          <div
            key={item.label}
            className={`flex min-w-0 flex-col items-center gap-0.5 border-slate-300 px-2 text-center ${dividerClass}`}
          >
            <p className="text-[11px] whitespace-nowrap text-muted">{item.label}</p>
            <p className={`text-lg leading-tight font-bold tabular-nums ${valueClass}`}>
              {item.value}
            </p>
            {item.sub && <p className="text-[10px] leading-tight text-muted">{item.sub}</p>}
          </div>
        );
      })}
    </div>
  );
}
