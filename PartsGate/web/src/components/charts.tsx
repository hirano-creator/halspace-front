import { Fragment, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';

/**
 * 小さなグラフの部品（SVG。グラフのライブラリは入れない）。
 * 色: 量は青 1 色、結果は「正常・読み取り済み・要確認・未登録」の 4 色（色覚の違いでも見分けられることを
 * validate_palette.js で確認済み。黄は背景との差が小さいので、凡例・数字・表で補う）。
 * どのグラフもマウスを乗せると件数が出る（data-tip）。
 */

export const SERIES = '#2a78d6';
export const RESULT_COLORS = { ok: '#1f9a3a', duplicate: '#e3a600', review: '#d0501a', error: '#9b1c1c' } as const;
export const RESULT_LABELS = { ok: '正常', duplicate: '読み取り済み', review: '要確認', error: '未登録・エラー' } as const;
export type ResultKey = keyof typeof RESULT_COLORS;

/** 画面に 1 つだけ置く吹き出し。data-tip を持つ要素の上で出す */
export function TooltipLayer() {
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  useEffect(() => {
    const move = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest?.('[data-tip]');
      setTip(el ? { x: e.clientX, y: e.clientY, text: el.getAttribute('data-tip') ?? '' } : null);
    };
    document.addEventListener('mousemove', move);
    return () => document.removeEventListener('mousemove', move);
  }, []);
  if (!tip) return null;
  return (
    <div className="pointer-events-none fixed z-50 max-w-64 rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs leading-relaxed whitespace-pre-line text-white shadow-lg"
      style={{ left: Math.min(tip.x + 14, window.innerWidth - 260), top: tip.y + 14 }}>{tip.text}</div>
  );
}

/** 幅を親に合わせる */
function useWidth(): [RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(600);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="flex flex-wrap gap-3 text-xs text-slate-600">
      {items.map((i) => <span key={i.label} className="flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: i.color }} />{i.label}</span>)}
    </div>
  );
}

const niceMax = (v: number) => {
  if (v <= 4) return 4;
  const p = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / p) * p;
};

/** 日ごとの積み上げ棒（結果別） */
export function StackedBars({ data, height = 190 }: { data: { label: string; values: Record<ResultKey, number> }[]; height?: number }) {
  const [ref, w] = useWidth();
  const keys = Object.keys(RESULT_COLORS) as ResultKey[];
  const totals = data.map((d) => keys.reduce((s, k) => s + d.values[k], 0));
  const max = niceMax(Math.max(...totals, 1));
  const pad = { l: 34, r: 8, t: 14, b: 22 };
  const iw = Math.max(w - pad.l - pad.r, 50), ih = height - pad.t - pad.b;
  const gap = iw / Math.max(data.length, 1);
  const bw = Math.min(46, gap * 0.6);
  const ticks = [0, max / 2, max];
  return (
    <div ref={ref} className="w-full">
      <svg width={w} height={height} role="img" aria-label="日別の読み取り件数">
        {ticks.map((t) => { const y = pad.t + ih - (t / max) * ih; return <g key={t}><line x1={pad.l} x2={w - pad.r} y1={y} y2={y} stroke="#e8e7e2" /><text x={pad.l - 6} y={y + 4} fontSize="10" fill="#8a8984" textAnchor="end">{t}</text></g>; })}
        {data.map((d, i) => {
          const x = pad.l + gap * i + (gap - bw) / 2;
          let y0 = pad.t + ih;
          const total = totals[i]!;
          const tip = `${d.label}  計 ${total} 件\n` + keys.map((k) => `${RESULT_LABELS[k]} ${d.values[k]}`).join('\n');
          const segs = keys.filter((k) => d.values[k] > 0);
          return (
            <g key={d.label}>
              {segs.map((k, si) => {
                const h = (d.values[k] / max) * ih;
                y0 -= h;
                const top = si === segs.length - 1;
                // 一番上だけ角を丸め、段の間に 2px のすき間を空ける
                return top
                  ? <path key={k} d={`M${x},${y0 + h} V${y0 + Math.min(4, h)} q0,-${Math.min(4, h)} ${Math.min(4, bw / 2)},-${Math.min(4, h)} h${bw - 2 * Math.min(4, bw / 2)} q${Math.min(4, bw / 2)},0 ${Math.min(4, bw / 2)},${Math.min(4, h)} V${y0 + h} Z`} fill={RESULT_COLORS[k]} />
                  : <rect key={k} x={x} y={y0} width={bw} height={Math.max(h - 2, 1)} fill={RESULT_COLORS[k]} />;
              })}
              {total > 0 && <text x={x + bw / 2} y={y0 - 4} fontSize="11" fill="#0b0b0b" textAnchor="middle">{total}</text>}
              <text x={x + bw / 2} y={height - 6} fontSize="11" fill="#52514e" textAnchor="middle">{d.label}</text>
              <rect x={x - 6} y={pad.t} width={bw + 12} height={ih} fill="transparent" data-tip={tip} />
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** 横棒（量は青 1 色）。total を渡すと「全体のうち済み」の形（薄い色が全体） */
export function HBars({ items, unit = '件', labelWidth = 120 }: { items: { label: string; value: number; total?: number; note?: string }[]; unit?: string; labelWidth?: number }) {
  const max = Math.max(...items.map((i) => i.total ?? i.value), 1);
  if (!items.length) return <p className="py-4 text-center text-xs text-slate-500">データがありません</p>;
  return (
    <div className="grid items-center gap-x-2 gap-y-1.5 text-[12.5px]" style={{ gridTemplateColumns: `${labelWidth}px 1fr auto` }}>
      {items.map((i) => (
        <Fragment key={i.label}>
          <span className="truncate text-slate-600" title={i.label}>{i.label}</span>
          <span className="relative h-3.5" data-tip={`${i.label}\n${i.value.toLocaleString()} ${unit}${i.total !== undefined ? ` / ${i.total.toLocaleString()}` : ''}${i.note ? `\n${i.note}` : ''}`}>
            {i.total !== undefined && <span className="absolute inset-y-0 left-0 rounded-r bg-blue-100" style={{ width: `${(i.total / max) * 100}%` }} />}
            <span className="absolute inset-y-0 left-0 rounded-r" style={{ width: `${(i.value / max) * 100}%`, background: SERIES }} />
          </span>
          <span className="text-right whitespace-nowrap tabular-nums">{i.value.toLocaleString()}{i.total !== undefined ? ` / ${i.total.toLocaleString()}` : ''}{i.note ? <span className="ml-1 text-[11px] text-slate-400">{i.note}</span> : null}</span>
        </Fragment>
      ))}
    </div>
  );
}

/** 小さな折れ線（得意先ごとの推移を同じ形で並べる） */
export function Sparkline({ values, width = 96, height = 36 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 1) * 1.1;
  const X = (i: number) => 4 + ((width - 8) * i) / (values.length - 1);
  const Y = (v: number) => 4 + (height - 8) * (1 - v / max);
  return (
    <svg width={width} height={height} aria-hidden="true">
      <polyline points={values.map((v, i) => `${X(i)},${Y(v)}`).join(' ')} fill="none" stroke={SERIES} strokeWidth="2" />
      <circle cx={X(values.length - 1)} cy={Y(values[values.length - 1]!)} r="3.5" fill={SERIES} />
    </svg>
  );
}

/** 月別の折れ線（締まった月だけを渡す。途中の月を入れると急に減ったように見えるため） */
export function LineChart({ points, height = 160 }: { points: { label: string; value: number }[]; height?: number }) {
  const [ref, w] = useWidth();
  if (!points.length) return <div ref={ref}><p className="py-4 text-center text-xs text-slate-500">データがありません</p></div>;
  const max = niceMax(Math.max(...points.map((p) => p.value), 1));
  const pad = { l: 40, r: 16, t: 18, b: 22 };
  const iw = Math.max(w - pad.l - pad.r, 50), ih = height - pad.t - pad.b;
  const X = (i: number) => pad.l + (points.length === 1 ? iw / 2 : (iw * i) / (points.length - 1));
  const Y = (v: number) => pad.t + ih - (v / max) * ih;
  const last = points[points.length - 1]!;
  return (
    <div ref={ref} className="w-full">
      <svg width={w} height={height} role="img" aria-label="月別の推移">
        {[0, max / 2, max].map((t) => <g key={t}><line x1={pad.l} x2={w - pad.r} y1={Y(t)} y2={Y(t)} stroke="#e8e7e2" /><text x={pad.l - 6} y={Y(t) + 4} fontSize="10" fill="#8a8984" textAnchor="end">{t.toLocaleString()}</text></g>)}
        <polyline points={points.map((p, i) => `${X(i)},${Y(p.value)}`).join(' ')} fill="none" stroke={SERIES} strokeWidth="2" />
        {points.map((p, i) => (
          <g key={p.label}>
            <circle cx={X(i)} cy={Y(p.value)} r="4.5" fill={SERIES} stroke="#fcfcfb" strokeWidth="2" />
            <circle cx={X(i)} cy={Y(p.value)} r="14" fill="transparent" data-tip={`${p.label}  ${p.value.toLocaleString()} 件`} />
            <text x={X(i)} y={height - 6} fontSize="11" fill="#52514e" textAnchor="middle">{p.label}</text>
          </g>
        ))}
        <text x={X(points.length - 1)} y={Y(last.value) - 9} fontSize="11" fill="#0b0b0b" textAnchor="end">{last.value.toLocaleString()}</text>
      </svg>
    </div>
  );
}

/** 大きな数字の枠 */
export function Tile({ label, value, unit, note, tone }: { label: string; value: ReactNode; unit?: string; note?: ReactNode; tone?: 'ok' | 'warn' | 'ng' }) {
  const color = tone === 'ok' ? 'text-green-700' : tone === 'warn' ? 'text-amber-700' : tone === 'ng' ? 'text-red-700' : '';
  return (
    <div className="card px-3.5 py-2.5">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`text-2xl leading-tight font-extrabold tabular-nums ${color}`}>{value}{unit && <span className="ml-1 text-xs font-semibold text-slate-500">{unit}</span>}</div>
      {note && <div className="text-[11px] text-slate-500">{note}</div>}
    </div>
  );
}

export function Panel({ title, sub, actions, children, className = '' }: { title: string; sub?: string; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card min-w-0 p-3.5 ${className}`} style={{ background: '#fcfcfb' }}>
      <div className="mb-2 flex items-start gap-2">
        <div className="min-w-0"><h2 className="text-sm font-bold">{title}</h2>{sub && <p className="text-[11px] text-slate-500">{sub}</p>}</div>
        {actions && <div className="ml-auto flex gap-1">{actions}</div>}
      </div>
      {children}
    </section>
  );
}
