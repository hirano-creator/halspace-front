// ダッシュボードの「日別来店者数」グラフ。
// モック: docs/mockups/dashboard-visit-chart.html
//
// 31 日分を横に並べると幅を取るため、Y 軸ラベルだけ sticky で固定して
// プロット部分のみ横スクロールさせる。詳細は日付にタップ／マウスオーバーで
// パネル上部の固定エリアに表示する（浮遊ツールチップは横スクロール領域から
// はみ出てクリップされるため採用しない）。

import { useEffect, useRef, useState } from "react";
import type { DashboardVisitTrend } from "./types";

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];
const DAY_COL_WIDTH = 30;
const PLOT_HEIGHT = 200;
// 最大値のグリッド線はプロット最上部に来るため、その目盛りラベルの上半分が
// はみ出さないよう確保する余白
const PLOT_TOP_PAD = 24;
const Y_STEP_COUNT = 4;

function niceMax(value: number): number {
  const steps = [2, 4, 5, 8, 10, 12, 15, 20, 25, 30];
  for (const step of steps) {
    if (value <= step) return step;
  }
  return Math.ceil(value / 10) * 10;
}

export function VisitTrendChart({ trend }: { trend: DashboardVisitTrend }) {
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollLeft = Math.max(0, (trend.todayDay - 7) * DAY_COL_WIDTH);
  }, [trend.todayDay]);

  const days = trend.currentMonthTotalDays;
  const currentByDay = new Map(trend.current.map((d) => [d.day, d]));
  const previousByDay = new Map(trend.previous.map((d) => [d.day, d]));

  const maxValue = Math.max(
    0,
    ...trend.current.map((d) => d.count),
    ...trend.previous.filter((d) => d.day <= days).map((d) => d.count),
  );
  const yMax = niceMax(maxValue);
  // yMax が小さいと丸めで同じ値が並ぶことがあるため（例: yMax=2 → 0,1,1,2,2）重複を除く
  const ySteps = Array.from(
    new Set(Array.from({ length: Y_STEP_COUNT + 1 }, (_, i) => Math.round((yMax / Y_STEP_COUNT) * i))),
  );

  const selectedCurr = selectedDay !== null ? currentByDay.get(selectedDay) : undefined;
  const selectedPrev = selectedDay !== null ? previousByDay.get(selectedDay) : undefined;
  const selectedWeekday = selectedCurr?.weekday ?? selectedPrev?.weekday ?? 0;
  const selectedIsFuture = selectedDay !== null && selectedCurr === undefined;

  return (
    <div className="border-y border-line bg-card px-5 pt-4 pb-5 sm:px-8">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xs font-semibold tracking-wider text-gray-soft">日別来店者数</h2>
          <p className="mt-1 text-[11px] text-gray-faint">
            前月（{trend.previousMonthNumber}月）と当月（{trend.currentMonthNumber}月）を日ごとに比較
          </p>
        </div>
        <div className="flex items-center gap-3.5 pt-0.5 text-[11px] text-ink-2">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-gray-faint" />
            前月
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-accent" />
            当月
          </span>
        </div>
      </div>

      <div className="mb-2.5 flex min-h-10 flex-wrap items-center gap-4 rounded-lg bg-line-2 px-3 py-2 text-[12.5px]">
        {selectedDay === null ? (
          <span className="text-gray-faint">日付にタップ／マウスオーバーすると来店者数を表示します</span>
        ) : (
          <>
            <span className="flex-none font-semibold text-ink">
              {trend.currentMonthNumber}/{selectedDay}（{WEEKDAY_LABELS[selectedWeekday]}）
            </span>
            <span className="inline-flex items-center gap-1.5 text-ink-2">
              <span className="h-2 w-2 rounded-sm bg-gray-faint" />
              前月 <span className="font-bold text-ink">{selectedPrev?.count ?? 0}</span> 組
            </span>
            {selectedIsFuture ? (
              <span className="inline-flex items-center gap-1.5 text-ink-2">
                <span className="h-2 w-2 rounded-sm bg-accent" />
                当月 まだ来店なし（未来日）
              </span>
            ) : (
              <>
                <span className="inline-flex items-center gap-1.5 text-ink-2">
                  <span className="h-2 w-2 rounded-sm bg-accent" />
                  当月 <span className="font-bold text-ink">{selectedCurr?.count ?? 0}</span> 組
                </span>
                {selectedCurr && selectedCurr.count !== (selectedPrev?.count ?? 0) && (
                  <span
                    className={`text-[11.5px] ${
                      selectedCurr.count > (selectedPrev?.count ?? 0) ? "text-accent" : "text-gray-soft"
                    }`}
                  >
                    {selectedCurr.count > (selectedPrev?.count ?? 0)
                      ? `前月より +${selectedCurr.count - (selectedPrev?.count ?? 0)}`
                      : `前月より ${selectedCurr.count - (selectedPrev?.count ?? 0)}`}
                  </span>
                )}
              </>
            )}
          </>
        )}
      </div>

      <div ref={scrollRef} className="-mx-1 overflow-x-auto overflow-y-hidden px-1">
        <div className="relative flex">
          <div
            className="sticky left-0 z-2 flex-none bg-card"
            style={{ width: DAY_COL_WIDTH, height: PLOT_HEIGHT + PLOT_TOP_PAD }}
          >
            {ySteps.map((val) => (
              <div
                key={val}
                className="tabular absolute inset-x-0 -translate-y-1/2 text-right text-[10px] text-gray-faint"
                style={{ bottom: (val / yMax) * PLOT_HEIGHT }}
              >
                {val}
              </div>
            ))}
          </div>

          <div className="relative flex-none" style={{ width: days * DAY_COL_WIDTH }}>
            <div className="pointer-events-none absolute inset-0">
              {ySteps.map((val, i) => (
                <div
                  key={val}
                  className={`absolute inset-x-0 border-t ${i === 0 ? "border-line" : "border-line-2"}`}
                  style={{ bottom: (val / yMax) * PLOT_HEIGHT }}
                />
              ))}
            </div>

            <div className="relative flex items-end" style={{ height: PLOT_HEIGHT + PLOT_TOP_PAD }}>
              {Array.from({ length: days }, (_, i) => i + 1).map((day) => {
                const curr = currentByDay.get(day);
                const prev = previousByDay.get(day);
                const isFuture = curr === undefined;
                const isToday = day === trend.todayDay;
                const isSelected = day === selectedDay;
                const weekday = (curr ?? prev)?.weekday ?? 0;
                const isWeekend = weekday === 0 || weekday === 6;
                const prevHeight = prev ? (prev.count / yMax) * PLOT_HEIGHT : 0;
                const currHeight = curr ? (curr.count / yMax) * PLOT_HEIGHT : 0;

                return (
                  <div
                    key={day}
                    className="relative flex h-full flex-none items-end justify-center gap-0.5"
                    style={{ width: DAY_COL_WIDTH }}
                    onMouseEnter={() => setSelectedDay(day)}
                    onMouseLeave={() => setSelectedDay(null)}
                    onTouchStart={() => setSelectedDay((d) => (d === day ? null : day))}
                  >
                    {isWeekend && <div className="absolute inset-0 bg-line-2 opacity-60" />}
                    <div
                      className={`relative z-1 w-3 rounded-t-[3px] bg-gray-faint transition-opacity ${
                        isSelected ? "opacity-75" : ""
                      }`}
                      style={{ height: prevHeight }}
                    />
                    {isFuture ? (
                      <div
                        className="relative z-1 w-3 rounded-t-[3px] border-[1.5px] border-dashed border-line"
                        style={{ height: 10 }}
                      />
                    ) : (
                      <div
                        className={`relative z-1 w-3 rounded-t-[3px] transition-opacity ${
                          isToday ? "bg-navy" : "bg-accent"
                        } ${isSelected ? "opacity-85" : ""}`}
                        style={{ height: currHeight }}
                      />
                    )}
                  </div>
                );
              })}
            </div>

            <div className="mt-1.5 flex">
              {Array.from({ length: days }, (_, i) => i + 1).map((day) => {
                const curr = currentByDay.get(day);
                const prev = previousByDay.get(day);
                const weekday = (curr ?? prev)?.weekday ?? 0;
                const isToday = day === trend.todayDay;
                return (
                  <div
                    key={day}
                    className="flex-none text-center text-[9.5px] leading-[1.5]"
                    style={{ width: DAY_COL_WIDTH }}
                  >
                    <span className={`block font-semibold ${isToday ? "text-accent" : "text-gray-soft"}`}>
                      {trend.currentMonthNumber}/{day}
                    </span>
                    <span className={weekday === 0 ? "text-danger" : "text-gray-faint"}>
                      {WEEKDAY_LABELS[weekday]}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
      <p className="mt-2.5 text-[10.5px] text-gray-faint">横にスクロールできます。</p>
    </div>
  );
}
