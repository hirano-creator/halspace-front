// ダッシュボードの「日別来店者数」グラフの横に置く要約。
//
// 追加の API 呼び出しはせず、グラフと同じ trend データから
// 「前月の同じ日までとの比較」と「曜日別の 1 日平均来店」を出す。
// 上段の指標カードにある「今月の来店」と重ならないよう、
// ここでは「前月と比べてどうか」「どの曜日に来るか」だけを見せる。

import { isRegularHoliday } from "@/lib/constants";
import { WEEKDAY_LABELS } from "@/lib/utils/time";
import type { DashboardDailyPoint, DashboardVisitTrend } from "./types";

function sumCount(points: DashboardDailyPoint[], maxDay = Infinity): number {
  return points.reduce((acc, d) => (d.day <= maxDay ? acc + d.count : acc), 0);
}

interface WeekdayAverage {
  weekday: number;
  /** 当月にその曜日がまだ来ていなければ null */
  current: number | null;
  previous: number | null;
}

/**
 * 曜日ごとの 1 日平均来店組数。
 * 当月は今日まで（例: 17 日間）、前月は丸 1 か月なので合計では比べられない。
 * 「その曜日が何回あったか」で割って平均にする。
 */
function weekdayAverages(trend: DashboardVisitTrend): WeekdayAverage[] {
  const acc = Array.from({ length: 7 }, () => ({ currSum: 0, currDays: 0, prevSum: 0, prevDays: 0 }));
  for (const d of trend.current) {
    acc[d.weekday].currSum += d.count;
    acc[d.weekday].currDays += 1;
  }
  for (const d of trend.previous) {
    acc[d.weekday].prevSum += d.count;
    acc[d.weekday].prevDays += 1;
  }
  return acc.map((a, weekday) => ({
    weekday,
    current: a.currDays > 0 ? a.currSum / a.currDays : null,
    previous: a.prevDays > 0 ? a.prevSum / a.prevDays : null,
  }));
}

function formatAverage(value: number | null): string {
  return value === null ? "—" : value.toFixed(1);
}

function AverageBar({ value, max, className }: { value: number | null; max: number; className: string }) {
  // 0 でも「その曜日はあった」と分かるよう、わずかに出しておく
  const width = value === null ? 0 : max > 0 ? Math.max(2, (value / max) * 100) : 2;
  return <span className={`block h-1.5 rounded-sm ${className}`} style={{ width: `${width}%` }} />;
}

export function VisitTrendSummary({
  trend,
  selectedWeekday,
}: {
  trend: DashboardVisitTrend;
  selectedWeekday: number | null;
}) {
  const currentTotal = sumCount(trend.current);
  // 前月の日数が今日の日にちより少ない月（例: 3/30 に見る 2 月）は前月末までになるが、
  // 年に数日しか起きないので表示上は同じ「1〜今日」として扱う
  const previousSameSpan = sumCount(trend.previous, trend.todayDay);
  const previousTotal = sumCount(trend.previous);
  const diff = currentTotal - previousSameSpan;
  const toPreviousTotal = previousTotal - currentTotal;

  // 明日以降の営業日数（定休日を除く）。「前月の合計まであと何組か」の目安に添える
  let remainingOpenDays = 0;
  for (let day = trend.todayDay + 1; day <= trend.currentMonthTotalDays; day++) {
    if (!isRegularHoliday(trend.currentWeekdays[day - 1] ?? 0)) remainingOpenDays += 1;
  }

  const rows = weekdayAverages(trend);
  const maxAverage = Math.max(0, ...rows.flatMap((r) => [r.current ?? 0, r.previous ?? 0]));

  // グラフの右に縦 1 列で置くのが基本。右に収まらず下に回る幅では 2 つを横に並べる
  return (
    <div className="grid gap-5 sm:grid-cols-2 2xl:grid-cols-1">
      <section>
        <h3 className="text-xs font-semibold tracking-wider text-gray-soft">前月の同じ日までと比較</h3>
        <p className="mt-1 text-[11px] text-gray-faint">1〜{trend.todayDay}日の来店</p>
        <div className="mt-2.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="tabular text-2xl leading-none font-semibold tracking-tight text-ink">
            {currentTotal}
            <span className="ml-0.5 text-xs font-medium text-gray-soft">組</span>
          </span>
          <span className="text-[11.5px] text-ink-2">
            前月 <span className="tabular font-semibold text-ink">{previousSameSpan}</span> 組
          </span>
          {diff !== 0 && (
            <span
              className={`tabular text-[11.5px] font-semibold ${diff > 0 ? "text-accent" : "text-gray-soft"}`}
            >
              {diff > 0 ? `+${diff}` : diff}
            </span>
          )}
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-gray-faint">
          前月（{trend.previousMonthNumber}月）の合計 {previousTotal} 組
          {toPreviousTotal > 0 ? (
            <>
              まで あと <span className="font-semibold text-ink-2">{toPreviousTotal}</span> 組
              {remainingOpenDays > 0 && `（残り営業日 ${remainingOpenDays} 日）`}
            </>
          ) : (
            previousTotal > 0 && <span className="font-semibold text-accent">に到達</span>
          )}
        </p>
      </section>

      <section>
        <h3 className="text-xs font-semibold tracking-wider text-gray-soft">曜日別の 1 日平均</h3>
        <p className="mt-1 text-[11px] text-gray-faint">当月 / 前月（組）</p>
        <ul className="mt-2 flex max-w-[360px] flex-col gap-0.5 2xl:max-w-none">
          {rows.map((r) => {
            const holiday = isRegularHoliday(r.weekday);
            const isSelected = r.weekday === selectedWeekday;
            const noVisits = (r.current ?? 0) === 0 && (r.previous ?? 0) === 0;
            return (
              <li
                key={r.weekday}
                className={`-mx-1.5 flex items-center gap-2.5 rounded-md px-1.5 py-1 ${
                  isSelected ? "bg-line-2" : ""
                }`}
              >
                <span
                  className={`w-4 flex-none text-[11px] font-semibold ${
                    r.weekday === 0 || holiday ? "text-danger" : "text-ink-2"
                  }`}
                >
                  {WEEKDAY_LABELS[r.weekday]}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  {!(holiday && noVisits) && (
                    <>
                      <AverageBar value={r.previous} max={maxAverage} className="bg-gray-faint" />
                      <AverageBar value={r.current} max={maxAverage} className="bg-accent" />
                    </>
                  )}
                </span>
                <span className="tabular w-[64px] flex-none text-right text-[11px] text-ink-2">
                  {holiday && noVisits ? (
                    <span className="text-gray-faint">定休</span>
                  ) : (
                    <>
                      <span className="font-semibold text-ink">{formatAverage(r.current)}</span>
                      {" / "}
                      {formatAverage(r.previous)}
                    </>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
