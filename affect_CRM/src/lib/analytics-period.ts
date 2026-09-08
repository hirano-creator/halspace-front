// 分析の期間指定
//
// 「今日／今週／今月／先月／今年／任意期間」を JST 基準の [start, end) に変換する。
// 日付境界の計算は必ず utils/time.ts を通す（Workers は UTC で動くため）。

import {
  formatJstDate,
  parseJstDateTime,
  startOfJstDay,
  startOfJstMonth,
  toJst,
} from "@/lib/utils/time";

export const PERIOD_KEYS = ["today", "week", "month", "lastMonth", "year", "custom"] as const;
export type PeriodKey = (typeof PERIOD_KEYS)[number];

export const PERIOD_LABELS: Record<PeriodKey, string> = {
  today: "今日",
  week: "今週",
  month: "今月",
  lastMonth: "先月",
  year: "今年",
  custom: "期間指定",
};

const DAY = 24 * 60 * 60 * 1000;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

export interface Period {
  key: PeriodKey;
  start: Date;
  /** この時刻は含まない */
  end: Date;
  label: string;
}

export function resolvePeriod(
  key: string,
  fromRaw?: string | null,
  toRaw?: string | null,
  now: Date = new Date(),
): Period {
  const jst = toJst(now);
  const y = jst.getUTCFullYear();
  const m = jst.getUTCMonth();

  const utcFromJst = (year: number, month: number, day: number) =>
    new Date(Date.UTC(year, month, day) - JST_OFFSET_MS);

  switch (key) {
    case "today": {
      const start = startOfJstDay(now);
      return { key: "today", start, end: new Date(start.getTime() + DAY), label: "今日" };
    }
    case "week": {
      // 日曜はじまり
      const start = new Date(startOfJstDay(now).getTime() - jst.getUTCDay() * DAY);
      const end = new Date(start.getTime() + 7 * DAY);
      return {
        key: "week",
        start,
        end,
        label: `今週（${formatJstDate(start)} 〜 ${formatJstDate(new Date(end.getTime() - DAY))}）`,
      };
    }
    case "lastMonth": {
      const start = utcFromJst(y, m - 1, 1);
      const end = startOfJstMonth(now);
      const lm = toJst(start);
      return {
        key: "lastMonth",
        start,
        end,
        label: `${lm.getUTCFullYear()}年${lm.getUTCMonth() + 1}月`,
      };
    }
    case "year": {
      return { key: "year", start: utcFromJst(y, 0, 1), end: utcFromJst(y + 1, 0, 1), label: `${y}年` };
    }
    case "custom": {
      const from = fromRaw ? parseJstDateTime(fromRaw) : null;
      const to = toRaw ? parseJstDateTime(toRaw) : null;
      if (from && to) {
        // to はその日を含める
        const end = new Date(to.getTime() + DAY);
        return { key: "custom", start: from, end, label: `${formatJstDate(from)} 〜 ${formatJstDate(to)}` };
      }
      break;
    }
  }

  const start = startOfJstMonth(now);
  return {
    key: "month",
    start,
    end: utcFromJst(y, m + 1, 1),
    label: `${y}年${m + 1}月`,
  };
}
