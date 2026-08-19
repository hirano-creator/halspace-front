// 週単位管理（金曜起算など）の週小計行と、日別行を週ごとにまとめる共通処理。
//
// 社員詳細（AttendanceEditor）とマイページ（MyAttendanceTable）は同じ列構成の
// 日別テーブルを持つため、週の小計行もここで一本化して両方から使う。
// 週単位管理が有効な会社では「早出残業」「残業」列が常に0になるので、
// その2列を「所定超〜法定内」「法定超」に置き換え、値は週行だけが持つ。

import type { WeeklyBucket } from "@/lib/attendance/types";
import { formatDateWithWeekday, minutesToHHMM } from "@/lib/utils/time";
import { Badge } from "@/components/ui";

/** 週の表示ラベル（例: "8/28（金）〜9/2（水）"。1日だけの端数週は1つだけ出す） */
export function weekRangeLabel(week: WeeklyBucket): string {
  const start = formatDateWithWeekday(week.labelStart);
  if (week.labelStart === week.labelEnd) return start;
  return `${start}〜${formatDateWithWeekday(week.labelEnd)}`;
}

/**
 * 日別行を週ブロックごとにまとめる。
 * 週に属さない日（締め期間外のはみ出しなど）は落とさず末尾にまとめて返す。
 */
export function groupRowsByWeek<T extends { date: string }>(
  rows: T[],
  weeks: WeeklyBucket[],
): { groups: { week: WeeklyBucket; rows: T[] }[]; ungrouped: T[] } {
  const groups = weeks.map((week) => ({
    week,
    rows: rows.filter((r) => r.date >= week.start && r.date <= week.end),
  }));
  const grouped = new Set(groups.flatMap((g) => g.rows.map((r) => r.date)));
  return { groups, ungrouped: rows.filter((r) => !grouped.has(r.date)) };
}

/**
 * 週の小計（スマホのカード一覧用）。
 * テーブルの WeekSubtotalRow と同じ値を、列ではなくラベル付きで並べる。
 */
export function WeekSubtotalBar({ week }: { week: WeeklyBucket }) {
  return (
    <div className="border-y border-violet-200/70 bg-violet-50/50 px-4 py-2 text-sm font-semibold">
      <span className="flex flex-wrap items-center gap-2">
        <span>{weekRangeLabel(week)}</span>
        <Badge tone="gray">{week.workDays}日</Badge>
        {week.isPartial && <Badge tone="gray">端数週</Badge>}
        {week.closedDayWorkDates.length > 0 && <Badge tone="amber">定休日出勤</Badge>}
      </span>
      <span className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs font-normal">
        <span>
          勤務 <span className="font-mono tabular-nums">{minutesToHHMM(week.totalMinutes)}</span>
        </span>
        <span className={week.withinLegalOvertimeMinutes > 0 ? "text-amber-600" : "text-muted"}>
          36H超44H以内{" "}
          <span className="font-mono tabular-nums">
            {minutesToHHMM(week.withinLegalOvertimeMinutes)}
          </span>
        </span>
        <span className={week.overLegalOvertimeMinutes > 0 ? "text-orange-700" : "text-muted"}>
          44H超{" "}
          <span className="font-mono tabular-nums">
            {minutesToHHMM(week.overLegalOvertimeMinutes)}
          </span>
        </span>
      </span>
    </div>
  );
}

/**
 * 週の小計行。日別テーブルの中に差し込んで使う。
 * 列構成は日別行と同じで、日付〜控除外出の9列をラベルに使い、
 * 勤務時間・所定超法定内・法定超の3列に週の集計値を入れる。
 * 間に挟まる「法定外残業」列は日単位の指標のため、週行では空にする。
 */
export function WeekSubtotalRow({
  week,
  showMoney,
}: {
  week: WeeklyBucket;
  /** 金額3列を表示中か（週行では金額を出さないため、空セルの数を合わせるのに使う） */
  showMoney: boolean;
}) {
  const cell = "px-2 py-2 text-sm font-semibold whitespace-nowrap";
  return (
    <tr className="border-y border-violet-200/70 bg-violet-50/50">
      <td colSpan={9} className={`${cell} text-left`}>
        <span className="flex flex-wrap items-center gap-2">
          <span>{weekRangeLabel(week)}</span>
          <Badge tone="gray">{week.workDays}日</Badge>
          {week.isPartial && <Badge tone="gray">端数週</Badge>}
          {week.closedDayWorkDates.length > 0 && <Badge tone="amber">定休日出勤</Badge>}
        </span>
      </td>
      <td className={`${cell} text-right`}>{minutesToHHMM(week.totalMinutes)}</td>
      {/* 法定外残業は日単位の指標で、合計は月度のみ出す方針のため週行では空にする */}
      <td className={cell} />
      <td
        className={`${cell} text-right ${
          week.withinLegalOvertimeMinutes > 0 ? "text-amber-600" : "text-muted"
        }`}
      >
        {minutesToHHMM(week.withinLegalOvertimeMinutes)}
      </td>
      <td
        className={`${cell} text-right ${
          week.overLegalOvertimeMinutes > 0 ? "text-orange-700" : "text-muted"
        }`}
      >
        {minutesToHHMM(week.overLegalOvertimeMinutes)}
      </td>
      <td className={cell} />
      {showMoney && <td className={cell} />}
      {showMoney && <td className={cell} />}
      {showMoney && <td className={cell} />}
      <td className={cell} />
    </tr>
  );
}
