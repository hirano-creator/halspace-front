"use client";

// グラフ
//
// 外部ライブラリは使わない（運用コスト 0 円・バンドルを軽く保つ方針）。
// 色は案F の方針どおりアクセント 1 色系。系列の違いは濃淡と位置で示し、色相を増やさない。
//
// 使い分けの目安（データ分析画面）:
//   - 構成比（男女比・来店目的など、全体を 100% とした内訳）  → PieChart
//   - 順序のある区分（時間帯・曜日・年代）                       → ColumnChart（縦棒）
//   - 項目名が長いランキング（地域・商品名）                     → BarList（横棒）
//   - 1 つの比率（購入率・充足率）                               → RatioDonut
//   - 分母つきの率の一覧                                         → RateList
//   - 曜日 × 時間帯のような格子                                  → HeatmapGrid
//   - 単独の数字（開催数・売上など。棒 1 本のグラフにしない）    → MiniStats
//
// 値はスマホでも読めるよう、ホバーに頼らず必ず直接ラベルで出す。

export interface BarRow {
  label: string;
  value: number;
  /** 補助表示（"46%" や "12 件" など） */
  note?: string;
}

/**
 * 横棒グラフ。項目名が日本語で長くなりがちなランキングに使う。
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
 * 複数系列を色で塗り分けることはしない（内訳は PieChart）。
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

// ---------------------------------------------------------------------------
// 円グラフ

/**
 * 円グラフの塗り。大きい順に濃 → 淡の同系色（順序ランプ）。
 * dataviz スキルの validate_palette.js（--ordinal, 白地）で全チェック通過済み。
 * 薄い側は白地に 2:1 以上のコントラストを保つため、これより淡くしない。
 */
const PIE_RAMP = ["#063f55", "#08536f", "#0b86ab", "#3ea5c4", "#6bbcd3"];
/** 「未設定」「不明」など情報が無い区分は灰色にして、選択肢の一つに見えないようにする */
const PIE_NEUTRAL = "#93aab3";
/** 表示上限を超えた残りをまとめた区分 */
const PIE_REST = "#c9d6db";
const NEUTRAL_LABELS = new Set(["未設定", "不明", "未分類"]);

export interface PieSegment {
  label: string;
  value: number;
}

/** 円弧のパス（ドーナツ形）。角度は 12 時を 0 とした時計回りのラジアン */
function donutPath(cx: number, cy: number, outer: number, inner: number, from: number, to: number) {
  const point = (r: number, a: number) => [cx + r * Math.sin(a), cy - r * Math.cos(a)] as const;
  const [x1, y1] = point(outer, from);
  const [x2, y2] = point(outer, to);
  const [x3, y3] = point(inner, to);
  const [x4, y4] = point(inner, from);
  const large = to - from > Math.PI ? 1 : 0;
  return [
    `M ${x1} ${y1}`,
    `A ${outer} ${outer} 0 ${large} 1 ${x2} ${y2}`,
    `L ${x3} ${y3}`,
    `A ${inner} ${inner} 0 ${large} 0 ${x4} ${y4}`,
    "Z",
  ].join(" ");
}

/**
 * 構成比の円グラフ（ドーナツ）。全体を 100% とした内訳に使う。
 * 区分は多くても 6 つまで（超えた分は「残り n 項目」にまとめる）。
 * 値は必ず凡例に出す（スマホではホバーできないため）。
 */
export function PieChart({
  segments,
  unit = "",
  maxSegments = PIE_RAMP.length,
  format = (v) => v.toLocaleString("ja-JP"),
  centerText,
  emptyText = "データがありません",
}: {
  /** 大きい順に並んでいること（サーバー側で並べ替え済み） */
  segments: PieSegment[];
  unit?: string;
  /** 色を割り当てる区分の上限（塗りの数まで）。これを超えた分は 1 つにまとめる */
  maxSegments?: number;
  format?: (value: number) => string;
  /** 中央の表示。省略時は合計 */
  centerText?: string;
  emptyText?: string;
}) {
  const nonZero = segments.filter((s) => s.value > 0);
  const total = nonZero.reduce((sum, s) => sum + s.value, 0);
  if (total === 0) {
    return <p className="py-6 text-center text-[13px] text-gray-faint">{emptyText}</p>;
  }

  // 塗りの数を超えた区分は末尾に 1 つにまとめる（同じ色が隣り合わないように）。
  // 「未設定」等は灰色で塗るので上限に数えず、元の位置に残す。
  const limit = Math.min(maxSegments, PIE_RAMP.length);
  const kept: (PieSegment & { rest?: boolean })[] = [];
  const rest: PieSegment[] = [];
  let coloredCount = 0;
  for (const s of nonZero) {
    if (NEUTRAL_LABELS.has(s.label)) kept.push(s);
    else if (coloredCount < limit) {
      kept.push(s);
      coloredCount += 1;
    } else rest.push(s);
  }
  const shown: (PieSegment & { rest?: boolean })[] =
    rest.length === 0
      ? kept
      : rest.length === 1
        ? [...kept, { ...rest[0], rest: true }]
        : [
            ...kept,
            {
              label: `残り ${rest.length} 項目`,
              value: rest.reduce((sum, s) => sum + s.value, 0),
              rest: true,
            },
          ];

  // 色は「情報のある区分」だけが濃淡ランプを消費する。角度は 12 時から時計回りに積む
  const arcs: (PieSegment & { rest?: boolean; color: string; percent: number; from: number; to: number })[] =
    [];
  let rampIndex = 0;
  let angle = 0;
  for (const s of shown) {
    let color: string;
    if (s.rest) color = PIE_REST;
    else if (NEUTRAL_LABELS.has(s.label)) color = PIE_NEUTRAL;
    else color = PIE_RAMP[Math.min(rampIndex++, PIE_RAMP.length - 1)];
    const to = angle + (s.value / total) * Math.PI * 2;
    arcs.push({ ...s, color, percent: Math.round((s.value / total) * 100), from: angle, to });
    angle = to;
  }

  const size = 120;
  const cx = size / 2;
  const outer = 56;
  const inner = 33;

  return (
    <div className="flex items-center gap-5 py-1">
      <svg viewBox={`0 0 ${size} ${size}`} className="h-[120px] w-[120px] flex-none" role="img">
        {arcs.length === 1 ? (
          <circle
            cx={cx}
            cy={cx}
            r={(outer + inner) / 2}
            fill="none"
            stroke={arcs[0].color}
            strokeWidth={outer - inner}
          />
        ) : (
          arcs.map((a) => (
            <path
              key={a.label}
              d={donutPath(cx, cx, outer, inner, a.from, a.to)}
              fill={a.color}
              // 区分の境目は線で囲まず、地の色で 2px 空ける
              stroke="var(--card)"
              strokeWidth={2}
              strokeLinejoin="round"
            >
              <title>
                {a.label}: {format(a.value)}
                {unit}（{a.percent}%）
              </title>
            </path>
          ))
        )}
        <text
          x={cx}
          y={cx}
          textAnchor="middle"
          dominantBaseline="central"
          className="fill-ink"
          style={{ fontSize: 15, fontWeight: 600 }}
        >
          {centerText ?? `${format(total)}${unit}`}
        </text>
      </svg>
      <ul className="min-w-0 flex-1 space-y-1.5">
        {arcs.map((s) => (
          <li key={s.label} className="flex items-center gap-2 text-[12.5px]">
            <span
              className="h-2.5 w-2.5 flex-none rounded-[2px]"
              style={{ backgroundColor: s.color }}
              aria-hidden
            />
            <span className={`min-w-0 flex-1 truncate ${s.rest ? "text-gray-soft" : ""}`}>{s.label}</span>
            <span className="tabular flex-none font-semibold">
              {format(s.value)}
              {unit}
            </span>
            <span className="tabular w-9 flex-none text-right text-gray-soft">{s.percent}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 縦棒グラフ

export interface ColumnRow {
  label: string;
  value: number;
  /** ラベルの下に出す小さな補足（"2.3/日" など） */
  note?: string;
  /** 棒を灰色にする（定休日・未設定など、比較の対象にしない列） */
  muted?: boolean;
  /** ラベルの色クラス（日曜・定休日を赤くする等） */
  labelClass?: string;
}

const COLUMN_PLOT_HEIGHT = 112;
// 最大値の列は値ラベルがプロットの上にはみ出すので、その分の余白
const COLUMN_TOP_PAD = 20;

/**
 * 縦棒グラフ。時間帯・曜日・年代のように「並び順に意味がある区分」に使う。
 * 項目名が短い前提（長い名前は BarList）。列は 14 本程度までを想定。
 * 列が少ないときに横いっぱいに間延びしないよう、1 列の幅に上限を付けている。
 */
export function ColumnChart({
  rows,
  unit = "",
  format = (v) => v.toLocaleString("ja-JP"),
  emptyText = "データがありません",
}: {
  rows: ColumnRow[];
  unit?: string;
  format?: (value: number) => string;
  emptyText?: string;
}) {
  const max = Math.max(0, ...rows.map((r) => r.value));
  if (rows.length === 0 || max === 0) {
    return <p className="py-6 text-center text-[13px] text-gray-faint">{emptyText}</p>;
  }

  return (
    <div className="py-1">
      <div className="relative" style={{ height: COLUMN_PLOT_HEIGHT + COLUMN_TOP_PAD }}>
        <div className="absolute inset-x-0 bottom-0 flex items-end gap-1" style={{ height: COLUMN_PLOT_HEIGHT }}>
          {rows.map((r) => {
            const height = r.value === 0 ? 2 : Math.max(3, (r.value / max) * COLUMN_PLOT_HEIGHT);
            return (
              <div
                key={r.label}
                className="flex h-full min-w-0 max-w-24 flex-1 flex-col items-center justify-end"
                title={`${r.label}: ${format(r.value)}${unit}`}
              >
                <span
                  className={`tabular mb-1 text-[10.5px] font-semibold ${
                    r.value === 0 ? "text-gray-faint" : "text-ink"
                  }`}
                >
                  {format(r.value)}
                  {unit}
                </span>
                <div
                  className={`w-full max-w-8 rounded-t-[4px] ${
                    r.value === 0 ? "bg-line" : r.muted ? "bg-gray-faint" : "bg-accent"
                  }`}
                  style={{ height }}
                />
              </div>
            );
          })}
        </div>
      </div>
      <div className="flex gap-1 border-t border-line pt-1">
        {rows.map((r) => (
          <div key={r.label} className="min-w-0 max-w-24 flex-1 text-center leading-[1.4]">
            <span className={`block truncate text-[10.5px] font-semibold ${r.labelClass ?? "text-gray-soft"}`}>
              {r.label}
            </span>
            {r.note && <span className="tabular block truncate text-[10px] text-gray-faint">{r.note}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ヒートマップ

/** 多い順に 4 段階（少 → 多）。0 は地の色（--line-2）で塗って数字も出さない */
const HEAT_RAMP = ["#b9dfe9", "#6fbdd3", "#2b9cbe", "#08536f"];

export interface HeatmapRow {
  label: string;
  /** ラベルの色クラス（日曜・定休日を赤くする等） */
  labelClass?: string;
}

/**
 * 曜日 × 時間帯のような格子。1 色の濃淡で多さを示し、セルに件数を出す。
 * values[row][col] の並びで渡す。
 */
export function HeatmapGrid({
  rows,
  cols,
  values,
  unit = "",
  emptyText = "データがありません",
}: {
  rows: HeatmapRow[];
  cols: string[];
  values: number[][];
  unit?: string;
  emptyText?: string;
}) {
  const max = Math.max(0, ...values.flat());
  if (max === 0) {
    return <p className="py-6 text-center text-[13px] text-gray-faint">{emptyText}</p>;
  }

  return (
    <div className="py-1">
      <div
        className="grid gap-0.5"
        style={{ gridTemplateColumns: `28px repeat(${cols.length}, minmax(0, 1fr))` }}
      >
        <div />
        {cols.map((c) => (
          <div key={c} className="truncate text-center text-[10px] text-gray-faint">
            {c}
          </div>
        ))}
        {rows.map((r, ri) => (
          <div key={r.label} className="contents">
            <div className={`flex items-center text-[11px] font-semibold ${r.labelClass ?? "text-gray-soft"}`}>
              {r.label}
            </div>
            {cols.map((c, ci) => {
              const v = values[ri]?.[ci] ?? 0;
              const level = v === 0 ? 0 : Math.max(1, Math.ceil((v / max) * HEAT_RAMP.length));
              return (
                <div
                  key={c}
                  className={`tabular flex h-7 items-center justify-center rounded-[3px] text-[10.5px] ${
                    level === 0 ? "bg-line-2" : level >= 3 ? "font-semibold text-white" : "font-semibold text-ink"
                  }`}
                  style={level === 0 ? undefined : { backgroundColor: HEAT_RAMP[level - 1] }}
                  title={`${r.label} ${c}: ${v}${unit}`}
                >
                  {v > 0 ? v : ""}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-end gap-1 text-[10px] text-gray-faint">
        <span className="mr-0.5">少</span>
        {HEAT_RAMP.map((c) => (
          <span key={c} className="h-2.5 w-4 rounded-[2px]" style={{ backgroundColor: c }} />
        ))}
        <span className="ml-0.5">多</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 数値タイル

/**
 * 単独の数字を並べる（開催数・参加人数など）。
 * 種類の違う数字を横棒で並べても比較にならないので、グラフにせず数字で見せる。
 */
export function MiniStats({
  items,
}: {
  items: { label: string; value: string | number; unit?: string; sub?: string }[];
}) {
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 py-1 sm:grid-cols-4">
      {items.map((it) => (
        <div key={it.label}>
          <dt className="text-[11px] text-gray-soft">{it.label}</dt>
          <dd className="mt-0.5 text-xl leading-none font-semibold tracking-tight text-ink">
            {it.value}
            {it.unit && <span className="ml-0.5 text-xs font-medium text-gray-soft">{it.unit}</span>}
          </dd>
          {it.sub && <dd className="mt-1 text-[11px] text-gray-faint">{it.sub}</dd>}
        </div>
      ))}
    </dl>
  );
}
