"use client";

// グラフ
//
// 外部ライブラリは使わない（運用コスト 0 円・バンドルを軽く保つ方針）。
// 色は案F の方針どおりアクセント 1 色。系列の違いは濃淡と位置で示し、色数を増やさない。

export interface BarRow {
  label: string;
  value: number;
  /** 補助表示（"46%" や "12 件" など） */
  note?: string;
}

/**
 * 横棒グラフ。項目名が日本語で長くなりがちなので、縦棒ではなく横棒にする。
 * 値は棒の右端に置き、目で追う距離を短くする。
 */
export function BarList({
  rows,
  max,
  unit = "",
  emptyText = "データがありません",
  limit,
}: {
  rows: BarRow[];
  /** 目盛りの最大値。省略時は最大値を使う */
  max?: number;
  unit?: string;
  emptyText?: string;
  limit?: number;
}) {
  const shown = limit ? rows.slice(0, limit) : rows;
  const top = max ?? Math.max(1, ...shown.map((r) => r.value));

  if (shown.length === 0) {
    return <p className="py-6 text-center text-[13px] text-gray-faint">{emptyText}</p>;
  }

  return (
    <ul className="space-y-2.5 py-1">
      {shown.map((r) => (
        <li key={r.label}>
          <div className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate text-[12.5px]">{r.label}</span>
            <span className="tabular flex-none text-[12.5px] font-semibold">
              {r.value.toLocaleString("ja-JP")}
              {unit}
              {r.note && <span className="ml-1.5 font-normal text-gray-soft">{r.note}</span>}
            </span>
          </div>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-line-2">
            <div
              className="h-full rounded-full bg-accent"
              style={{ width: `${Math.max(2, (r.value / top) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * 割合のドーナツ。1 つの比率（購入率など）を示すためだけに使う。
 * 複数系列を色で塗り分けることはしない。
 */
export function RatioDonut({
  value,
  label,
  sub,
}: {
  /** 0〜100 */
  value: number;
  label: string;
  sub?: string;
}) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const filled = (Math.min(100, Math.max(0, value)) / 100) * c;

  return (
    <div className="flex items-center gap-4">
      <svg viewBox="0 0 130 130" className="h-[104px] w-[104px] flex-none -rotate-90">
        <circle cx="65" cy="65" r={r} fill="none" stroke="var(--line-2)" strokeWidth="13" />
        <circle
          cx="65"
          cy="65"
          r={r}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="13"
          strokeLinecap="round"
          strokeDasharray={`${filled} ${c - filled}`}
        />
        <text
          x="65"
          y="65"
          textAnchor="middle"
          dominantBaseline="central"
          className="rotate-90 fill-ink"
          style={{ transformOrigin: "65px 65px", fontSize: 26, fontWeight: 600 }}
        >
          {value}%
        </text>
      </svg>
      <div className="min-w-0">
        <p className="text-[13px] font-semibold">{label}</p>
        {sub && <p className="mt-1 text-[12px] text-gray-soft">{sub}</p>}
      </div>
    </div>
  );
}

/** 率つきの一覧（購入率・未購入率）。分母も出さないと判断を誤るので必ず併記する */
export function RateList({
  rows,
  emptyText = "データがありません",
}: {
  rows: { label: string; total: number; hit: number; rate: number }[];
  emptyText?: string;
}) {
  if (rows.length === 0) {
    return <p className="py-6 text-center text-[13px] text-gray-faint">{emptyText}</p>;
  }
  return (
    <ul className="space-y-2.5 py-1">
      {rows.map((r) => (
        <li key={r.label}>
          <div className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate text-[12.5px]">{r.label}</span>
            <span className="tabular flex-none text-[12.5px]">
              <span className="font-semibold">{r.rate}%</span>
              <span className="ml-1.5 text-gray-soft">
                {r.hit} / {r.total}
              </span>
            </span>
          </div>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-line-2">
            <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(2, r.rate)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
