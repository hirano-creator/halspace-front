import { useState } from 'react';
import { toCsv } from '@partsgate/shared';
import { apiGet, saveBlob } from '../api/client';
import { Alert, Button, Loading, PageHeader, useLoad } from '../components/ui';
import { HBars, Legend, LineChart, Panel, RESULT_COLORS, RESULT_LABELS, Sparkline, StackedBars, Tile, TooltipLayer, type ResultKey } from '../components/charts';
import { addMonths, jstDay, md, monthStart } from '../report/util';

/**
 * データ分析（モック _mock-import-analytics.html）。「全体」と「得意先」の 2 つ。
 * 読み取りは集計表、注文はミスミ納期の範囲で数える（どちらもサーバー側で集計）。各グラフは CSV で保存できる。
 */

type Period = 'today' | 'week' | 'month' | '3m' | '1y';
const PERIODS: [Period, string][] = [['today', '今日'], ['week', '今週'], ['month', '今月'], ['3m', '3か月'], ['1y', '1年']];
/** day から days 日ずらした日 */
const jstDayOf = (day: string, days: number) => new Date(Date.parse(day) + days * 86_400_000).toISOString().slice(0, 10);
function periodRange(p: Period): { from: string; to: string } {
  const today = jstDay();
  if (p === 'today') return { from: today, to: today };
  if (p === 'week') return { from: jstDay(-6), to: today };
  // 注文はミスミ納期で数えるので、今月の納期（明日以降）も入るよう月末までにする。読み取りは今日までしかないので影響しない
  const monthEnd = jstDayOf(addMonths(monthStart(today), 1), -1);
  if (p === 'month') return { from: monthStart(today), to: monthEnd };
  if (p === '3m') return { from: addMonths(monthStart(today), -2), to: monthEnd };
  return { from: addMonths(monthStart(today), -11), to: monthEnd };
}

interface ScanRow { k: string | number | null; label: string | null; result: string; n: number }
interface OrderRow { k: string | number | null; label: string | null; items: number; slips: number; qty: number; kg: number; matched: number; open: number; destinations: number; main_location: string | null }

const toKey = (r: string): ResultKey => (r === 'ok' ? 'ok' : r === 'duplicate' || r === 'over_quantity' ? 'duplicate' : r === 'review' ? 'review' : 'error');
const save = (name: string, header: string[], rows: unknown[][]) => saveBlob(name, new Blob([toCsv(header, rows)], { type: 'text/csv' }));

export function AnalyticsPage() {
  const [view, setView] = useState<'all' | 'cust'>('all');
  const [period, setPeriod] = useState<Period>('month');
  const { from, to } = periodRange(period);
  const r = `from=${from}&to=${to}`;
  return (
    <>
      <TooltipLayer />
      <PageHeader title="データ分析"
        actions={<div className="flex overflow-hidden rounded-lg border border-slate-300" role="group" aria-label="表示">
          {([['all', '全体'], ['cust', '得意先']] as const).map(([k, l]) => <button key={k} type="button" aria-pressed={view === k} onClick={() => setView(k)}
            className={`border-l border-slate-200 px-4 py-2 text-sm font-bold first:border-l-0 ${view === k ? 'bg-slate-900 text-white' : 'bg-white'}`}>{l}</button>)}
        </div>} />
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-5 py-2.5">
        <div className="flex overflow-hidden rounded-lg border border-slate-300" role="group" aria-label="期間">
          {PERIODS.map(([k, l]) => <button key={k} type="button" aria-pressed={period === k} onClick={() => setPeriod(k)}
            className={`border-l border-slate-200 px-3 py-1.5 text-sm first:border-l-0 ${period === k ? 'bg-slate-900 text-white' : 'bg-white'}`}>{l}</button>)}
        </div>
        <span className="text-sm text-slate-600">{from.replace(/-/g, '/')} 〜 {to.replace(/-/g, '/')}</span>
        <span className="ml-auto text-xs text-slate-500">注文はミスミ納期、読み取りは読み取った日で数えます</span>
      </div>
      <div className="p-4 lg:p-5">{view === 'all' ? <Overall key={r} r={r} from={from} to={to} /> : <Customers key={r} r={r} />}</div>
    </>
  );
}

// ===================== 全体 =====================

function Overall({ r, from, to }: { r: string; from: string; to: string }) {
  const byDay = useLoad(() => apiGet<{ rows: ScanRow[] }>(`/analytics/scans?${r}&group=day`), [r]);
  const byStaff = useLoad(() => apiGet<{ rows: ScanRow[] }>(`/analytics/scans?${r}&group=staff`), [r]);
  const byLoc = useLoad(() => apiGet<{ rows: OrderRow[] }>(`/analytics/orders?${r}&group=location`), [r]);
  const byCust = useLoad(() => apiGet<{ rows: OrderRow[] }>(`/analytics/orders?${r}&group=customer&limit=5`), [r]);
  // 月別は締まった月（先月まで）の 6 か月。今月は途中なので線に入れない
  const thisMonth = monthStart(jstDay());
  const mr = `from=${addMonths(thisMonth, -6)}&to=${jstDay(-Number(jstDay().slice(8, 10)))}`;
  const byMonth = useLoad(() => apiGet<{ rows: ScanRow[] }>(`/analytics/scans?${mr}&group=month`), [mr]);
  const err = byDay.error ?? byStaff.error ?? byLoc.error ?? byCust.error ?? byMonth.error;

  const scanRows = byDay.data?.rows ?? [];
  const sum = (f: (x: ScanRow) => boolean) => scanRows.filter(f).reduce((s, x) => s + x.n, 0);
  const total = sum(() => true), dup = sum((x) => toKey(x.result) === 'duplicate'), bad = sum((x) => toKey(x.result) === 'error');
  const orders = byLoc.data?.rows ?? [];
  const items = orders.reduce((s, x) => s + x.items, 0), matched = orders.reduce((s, x) => s + x.matched, 0), open = orders.reduce((s, x) => s + x.open, 0);
  const days: string[] = [];
  for (let d = from; d <= to && days.length < 400; d = new Date(Date.parse(d) + 86_400_000).toISOString().slice(0, 10)) days.push(d);
  const daily = (days.length > 62 ? [] : days).map((d) => {
    const values = { ok: 0, duplicate: 0, review: 0, error: 0 } as Record<ResultKey, number>;
    for (const x of scanRows) if (x.k === d) values[toKey(x.result)] += x.n;
    return { label: md(d), values };
  });
  const staff = new Map<string, { ok: number; n: number }>();
  for (const x of byStaff.data?.rows ?? []) { const k = x.label ?? `#${x.k}`; const v = staff.get(k) ?? { ok: 0, n: 0 }; v.n += x.n; if (x.result === 'ok') v.ok += x.n; staff.set(k, v); }
  const months = new Map<string, number>();
  for (const x of byMonth.data?.rows ?? []) months.set(String(x.k), (months.get(String(x.k)) ?? 0) + x.n);

  if (err) return <Alert kind="error">{err}</Alert>;
  if (!byDay.data || !byLoc.data) return <Loading />;
  return (
    <div className="grid grid-cols-12 gap-3">
      <div className="col-span-12 grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-6">
        <Tile label="注文（明細）" value={items.toLocaleString()} unit="件" />
        <Tile label="照合済み" value={matched.toLocaleString()} unit="件" tone="ok" note={items ? `照合率 ${((matched / items) * 100).toFixed(1)}%` : undefined} />
        <Tile label="未確認" value={open.toLocaleString()} unit="件" tone={open ? 'warn' : undefined} />
        <Tile label="読み取り" value={total.toLocaleString()} unit="回" />
        <Tile label="読み取り済み（重複）" value={dup.toLocaleString()} unit="回" note={total ? `全体の ${((dup / total) * 100).toFixed(1)}%` : undefined} />
        <Tile label="未登録・エラー" value={bad.toLocaleString()} unit="回" tone={bad ? 'ng' : undefined} />
      </div>
      <Panel className="col-span-12 lg:col-span-7" title="日別の読み取り件数（結果別）" sub={days.length > 62 ? '期間が長いので、月別のグラフを見てください' : '1 日の読み取りを結果ごとに積み上げ'}
        actions={<Button size="sm" onClick={() => save(`日別の読み取り_${from}_${to}.csv`, ['日付', '結果', '件数'], scanRows.map((x) => [x.k, x.result, x.n]))}>CSV</Button>}>
        <Legend items={(Object.keys(RESULT_COLORS) as ResultKey[]).map((k) => ({ label: RESULT_LABELS[k], color: RESULT_COLORS[k] }))} />
        {daily.length > 0 && <StackedBars data={daily} />}
      </Panel>
      <Panel className="col-span-12 lg:col-span-5" title="置場別の照合状況" sub="注文（明細）のうち照合済み（濃い色）"
        actions={<Button size="sm" onClick={() => save(`置場別_${from}_${to}.csv`, ['置場', '明細', '照合済み', '未確認', '数量', '重量(kg)'], orders.map((x) => [x.label, x.items, x.matched, x.open, x.qty, x.kg]))}>CSV</Button>}>
        <HBars labelWidth={110} items={orders.map((x) => ({ label: x.label ?? '置場なし', value: x.matched, total: x.items }))} />
      </Panel>
      <Panel className="col-span-12 md:col-span-6 xl:col-span-4" title="担当者別の作業量" sub="正常に照合した件数"
        actions={<Button size="sm" onClick={() => save(`担当者別_${from}_${to}.csv`, ['担当者', '正常', '読み取り（全部）'], [...staff.entries()].map(([k, v]) => [k, v.ok, v.n]))}>CSV</Button>}>
        <HBars items={[...staff.entries()].sort((a, b) => b[1].ok - a[1].ok).map(([k, v]) => ({ label: k, value: v.ok, note: v.n > v.ok ? `ほか ${v.n - v.ok}` : undefined }))} />
      </Panel>
      <Panel className="col-span-12 md:col-span-6 xl:col-span-4" title="得意先別の注文数（上位 5）" sub="明細の件数。くわしくは「得意先」">
        <HBars labelWidth={130} items={(byCust.data?.rows ?? []).map((x) => ({ label: x.label ?? String(x.k), value: x.items }))} />
      </Panel>
      <Panel className="col-span-12 xl:col-span-4" title="月別の読み取り件数" sub="締まった月だけ（今月は途中のため入れない）"
        actions={<Button size="sm" onClick={() => save('月別の読み取り.csv', ['月', '件数'], [...months.entries()])}>CSV</Button>}>
        <LineChart points={[...months.entries()].map(([k, v]) => ({ label: `${Number(k.slice(5, 7))}月`, value: v }))} />
      </Panel>
    </div>
  );
}

// ===================== 得意先 =====================

type Metric = 'items' | 'qty' | 'kg';
const METRIC: Record<Metric, [string, string]> = { items: ['明細数', '件'], qty: ['数量', '個'], kg: ['重量', 'kg'] };

function Customers({ r }: { r: string }) {
  const list = useLoad(() => apiGet<{ rows: OrderRow[] }>(`/analytics/orders?${r}&group=customer&limit=500`), [r]);
  // 推移は締まった 5 か月（月別の明細数）
  const thisMonth = monthStart(jstDay());
  const tr = `from=${addMonths(thisMonth, -5)}&to=${jstDay(-Number(jstDay().slice(8, 10)))}`;
  const [metric, setMetric] = useState<Metric>('items');
  const [sort, setSort] = useState<keyof OrderRow>('items');
  const [pick, setPick] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const rows = list.data?.rows ?? [];
  const top5 = rows.slice(0, 5);
  // 上位 5 社の月別（1 社ずつ。5 社分の範囲 1 回の問い合わせで、月 × 得意先を数える代わりに、得意先ごとに内訳 API を使う）
  const trends = useLoad(async () => Promise.all(top5.map(async (x) => {
    const d = await apiGet<{ by_day: { k: string; items: number }[] }>(`/analytics/customers/${encodeURIComponent(String(x.k))}?${tr}`);
    const m = new Map<string, number>();
    for (const y of d.by_day) m.set(y.k.slice(0, 7), (m.get(y.k.slice(0, 7)) ?? 0) + y.items);
    const months = Array.from({ length: 5 }, (_, i) => addMonths(thisMonth, i - 5).slice(0, 7));
    return { k: String(x.k), label: x.label ?? String(x.k), values: months.map((mm) => m.get(mm) ?? 0) };
  })), [top5.map((x) => x.k).join(','), tr]);
  const picked = pick ?? (rows[0] ? String(rows[0].k) : null);
  const detail = useLoad(() => (picked ? apiGet<{ by_day: { k: string; items: number }[]; by_location: { k: string; label: string | null; items: number }[]; by_destination: { k: string; label: string | null; items: number }[]; by_product: { k: string; items: number; qty: number }[] }>(`/analytics/customers/${encodeURIComponent(picked)}?${r}`) : Promise.resolve(null)), [picked, r]);

  if (list.error) return <Alert kind="error">{list.error}</Alert>;
  if (!list.data) return <Loading />;
  const totalItems = rows.reduce((s, x) => s + x.items, 0);
  const totalM = rows.reduce((s, x) => s + Number(x[metric]), 0);
  const ranked = [...rows].sort((a, b) => Number(b[metric]) - Number(a[metric]));
  const top10 = ranked.slice(0, 10);
  const others = ranked.slice(10).reduce((s, x) => s + Number(x[metric]), 0);
  const filtered = rows.filter((x) => !q || `${x.k} ${x.label ?? ''}`.includes(q));
  const sorted = [...filtered].sort((a, b) => (sort === 'label' ? String(a.label ?? '').localeCompare(String(b.label ?? ''), 'ja') : Number(b[sort]) - Number(a[sort])));
  const P = rows.find((x) => String(x.k) === picked);
  const top5share = totalItems ? Math.round((top5.reduce((s, x) => s + x.items, 0) / totalItems) * 100) : 0;

  return (
    <div className="grid grid-cols-12 gap-3">
      <div className="col-span-12 grid grid-cols-2 gap-2.5 md:grid-cols-4">
        <Tile label="注文のあった得意先" value={rows.length} unit="社" />
        <Tile label="上位 5 社の割合" value={top5share} unit="%" note={`明細 ${totalItems.toLocaleString()} 件のうち`} />
        <Tile label="1 社あたりの明細" value={rows.length ? (totalItems / rows.length).toFixed(1) : '0'} unit="件" />
        <Tile label="未確認が残る得意先" value={rows.filter((x) => x.open > 0).length} unit="社" tone={rows.some((x) => x.open > 0) ? 'warn' : undefined} />
      </div>
      <Panel className="col-span-12 lg:col-span-6" title="得意先別の注文（上位 10）" sub={`右の % は全体に占める割合${ranked.length > 10 ? `。残り ${ranked.length - 10} 社は「その他」` : ''}`}
        actions={<div className="flex overflow-hidden rounded-md border border-slate-300 text-xs" role="group" aria-label="指標">
          {(Object.keys(METRIC) as Metric[]).map((m) => <button key={m} type="button" aria-pressed={metric === m} onClick={() => setMetric(m)} className={`border-l border-slate-200 px-2 py-1 first:border-l-0 ${metric === m ? 'bg-slate-900 text-white' : 'bg-white'}`}>{METRIC[m][0]}</button>)}
        </div>}>
        <HBars labelWidth={140} unit={METRIC[metric][1]} items={[
          ...top10.map((x) => ({ label: x.label ?? String(x.k), value: Number(x[metric]), note: totalM ? `${Math.round((Number(x[metric]) / totalM) * 100)}%` : undefined })),
          ...(others ? [{ label: `その他 ${ranked.length - 10} 社`, value: Math.round(others * 10) / 10 }] : []),
        ]} />
      </Panel>
      <Panel className="col-span-12 lg:col-span-6" title="上位 5 社の月別の明細数" sub="締まった 5 か月。1 社ずつ同じ形のグラフで比べる">
        {trends.error ? <Alert kind="error">{trends.error}</Alert> : !trends.data ? <Loading /> : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {trends.data.map((t) => {
              const last = t.values[t.values.length - 1] ?? 0, prev = t.values[t.values.length - 2] ?? 0;
              return (
                <button key={t.k} type="button" onClick={() => setPick(t.k)} className="rounded-lg border border-slate-200 bg-white p-2 text-left hover:border-slate-400" data-tip={`${t.label}\n${t.values.join(' → ')}`}>
                  <div className="truncate text-xs font-bold">{t.label}</div>
                  <div className="flex items-end justify-between gap-1">
                    <div><div className="text-lg font-extrabold">{last}</div><div className="text-[11px] text-slate-500">先月{prev ? `・前月比 ${last >= prev ? '+' : ''}${Math.round(((last - prev) / prev) * 100)}%` : ''}</div></div>
                    <Sparkline values={t.values} />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </Panel>
      <Panel className="col-span-12" title="得意先の一覧" sub="見出しを押すと並べ替え。行を押すと下に内訳を表示"
        actions={<>
          <input className="input !min-h-0 w-48 py-1 text-xs" placeholder="名前・コードで探す" value={q} onChange={(e) => setQ(e.target.value)} aria-label="得意先を探す" />
          <Button size="sm" onClick={() => save('得意先別.csv', ['得意先コード', '得意先', '明細', '伝票', '数量', '重量(kg)', '照合済み', '未確認', '納品先の数'], rows.map((x) => [x.k, x.label, x.items, x.slips, x.qty, x.kg, x.matched, x.open, x.destinations]))}>CSV</Button>
        </>}>
        <div className="max-h-80 overflow-auto">
          <table className="tbl">
            <thead><tr>
              {([['label', '得意先'], ['k', 'コード'], ['items', '明細'], ['slips', '伝票'], ['qty', '数量'], ['kg', '重量(kg)'], ['matched', '照合率'], ['open', '未確認'], ['destinations', '納品先']] as [keyof OrderRow, string][]).map(([k, l]) => (
                <th key={k} className={`cursor-pointer ${k === 'label' || k === 'k' ? '' : 'text-right'}`} onClick={() => setSort(k)} aria-sort={sort === k ? 'descending' : undefined}>{l}{sort === k ? ' ▼' : ''}</th>
              ))}
            </tr></thead>
            <tbody>
              {sorted.map((x) => (
                <tr key={String(x.k)} className={`row-click ${String(x.k) === picked ? 'bg-blue-50' : ''}`} onClick={() => setPick(String(x.k))}>
                  <td className="font-bold">{x.label ?? '—'}</td><td className="mono">{x.k}</td>
                  <td className="text-right">{x.items}</td><td className="text-right">{x.slips}</td><td className="text-right">{x.qty}</td><td className="text-right">{x.kg}</td>
                  <td className="text-right">{x.items ? `${((x.matched / x.items) * 100).toFixed(1)}%` : '—'}</td>
                  <td className="text-right">{x.open ? <span className="pill pill-warn">{x.open}</span> : '—'}</td>
                  <td className="text-right">{x.destinations} か所</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      {P && (
        <Panel className="col-span-12" title={`${P.label ?? P.k} の内訳`} sub={`得意先コード ${P.k}`}
          actions={<a className="btn btn-sm" href={`#/orders`}>注文データで見る →</a>}>
          {!detail.data ? <Loading /> : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <div><h3 className="mb-1.5 text-xs font-bold">日別の明細数</h3><HBars labelWidth={50} items={detail.data.by_day.slice(-10).map((x) => ({ label: md(x.k), value: x.items }))} /></div>
              <div><h3 className="mb-1.5 text-xs font-bold">置場別</h3><HBars labelWidth={90} items={detail.data.by_location.map((x) => ({ label: `${x.k} ${x.label ?? ''}`, value: x.items }))} /></div>
              <div><h3 className="mb-1.5 text-xs font-bold">納品先（直送先）</h3><HBars labelWidth={130} items={detail.data.by_destination.map((x) => ({ label: x.label ?? x.k, value: x.items }))} /></div>
              <div><h3 className="mb-1.5 text-xs font-bold">よく出る商品（上位 10）</h3><HBars labelWidth={150} items={detail.data.by_product.map((x) => ({ label: x.k, value: x.items, note: `数量 ${x.qty}` }))} /></div>
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}
