import { apiGet, type Page } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Alert, PageHeader, useLoad } from '../components/ui';
import { HBars, Legend, Panel, RESULT_COLORS, RESULT_LABELS, StackedBars, Tile, TooltipLayer, type ResultKey } from '../components/charts';
import { jstDay, md } from '../report/util';

/**
 * ホーム（ダッシュボード。指示書 §12）。読み取りの件数は集計表から、出荷の件数は「メーカー出荷日 = 今日」で数える。
 * マスターがそろっていない間は、初期設定の案内も出す。
 */

interface Dashboard {
  day: string;
  orders: { total: number; matched: number };
  open: number;
  scans: { total: number; ok: number; duplicate: number; review: number; error: number };
  by_staff: { staff_id: number; name: string | null; n: number; ok: number }[];
  by_location: { location_id: number | null; code: string | null; name: string | null; total: number; matched: number }[];
  daily: { day: string; result: string; n: number }[];
}

const toKey = (r: string): ResultKey => (r === 'ok' ? 'ok' : r === 'duplicate' || r === 'over_quantity' ? 'duplicate' : r === 'review' ? 'review' : 'error');

export function HomePage() {
  const { me, can } = useAuth();
  const d = useLoad(() => apiGet<Dashboard>('/dashboard'), []);
  const setup = useLoad(async () => {
    const [staff, locations] = await Promise.all([apiGet<Page<unknown>>('/staff?status=active&limit=1'), apiGet<Page<unknown>>('/locations?status=active&limit=1')]);
    return { staff: staff.items.length, locations: locations.items.length };
  }, []);

  // 直近 7 日（集計のない日も 0 で並べる）
  const days = Array.from({ length: 7 }, (_, i) => jstDay(i - 6));
  const daily = days.map((day) => {
    const values = { ok: 0, duplicate: 0, review: 0, error: 0 } as Record<ResultKey, number>;
    for (const r of d.data?.daily ?? []) if (r.day === day) values[toKey(r.result)] += r.n;
    return { label: md(day), values };
  });
  const o = d.data?.orders;
  const rate = o && o.total ? Math.round((o.matched / o.total) * 1000) / 10 : null;

  return (
    <>
      <TooltipLayer />
      <PageHeader title="ホーム" sub={`${me?.company?.name ?? ''} ・ ${me?.user.name ?? ''} さん  ${d.data ? `${md(d.data.day)} の状況` : ''}`} />
      <div className="flex flex-col gap-3 p-4 lg:p-5">
        {d.error && <Alert kind="error">{d.error}</Alert>}
        {setup.data && (setup.data.staff === 0 || setup.data.locations === 0) && (
          <Alert kind="warn">
            初期設定が終わっていません。{setup.data.staff === 0 && <><a className="underline" href="#/staff">担当者</a>を登録してください。</>}
            {setup.data.locations === 0 && <><a className="underline" href="#/locations">置場</a>を CSV と同じコード（例: 0053）で登録してください。</>}
          </Alert>
        )}
        <div className="card flex flex-wrap items-center gap-4 p-4">
          <a href="#/scan" className="flex flex-1 items-center gap-4 rounded-lg hover:bg-slate-50">
            <span className="text-4xl" aria-hidden="true">▣</span>
            <span><b className="text-lg">バーコード読み取りを始める</b><span className="block text-sm text-slate-500">担当者を選んで、置場ごとに部品をチェックします</span></span>
          </a>
          {can('import') && <a href="#/imports/new" className="btn">⇪ CSV を取り込む</a>}
        </div>
        <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-6">
          <Tile label="今日出荷の注文（明細）" value={o?.total ?? '…'} unit="件" />
          <Tile label="照合済み" value={o?.matched ?? '…'} unit="件" tone="ok" note={rate !== null ? `照合率 ${rate}%` : undefined} />
          <Tile label="未確認（出荷日を過ぎた分も含む）" value={d.data?.open ?? '…'} unit="件" tone={d.data?.open ? 'warn' : undefined} note={<a className="underline" href="#/orders">注文データで見る</a>} />
          <Tile label="今日の読み取り" value={d.data?.scans.total ?? '…'} unit="回" />
          <Tile label="読み取り済み（重複）" value={d.data?.scans.duplicate ?? '…'} unit="回" />
          <Tile label="未登録・エラー・要確認" value={d.data ? d.data.scans.error + d.data.scans.review : '…'} unit="回" tone={d.data && d.data.scans.error + d.data.scans.review ? 'ng' : undefined}
            note={<a className="underline" href="#/scan-logs">読み取り履歴で見る</a>} />
        </div>
        <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr]">
          <Panel title="直近 7 日の読み取り（結果別）" sub="1 日の読み取りを結果ごとに積み上げ">
            <Legend items={(Object.keys(RESULT_COLORS) as ResultKey[]).map((k) => ({ label: RESULT_LABELS[k], color: RESULT_COLORS[k] }))} />
            <StackedBars data={daily} />
          </Panel>
          <div className="flex flex-col gap-3">
            <Panel title="置場別の照合状況（今日出荷）" sub="明細のうち照合済み（濃い色）">
              <HBars labelWidth={110} items={(d.data?.by_location ?? []).map((l) => ({ label: `${l.code ?? '?'} ${l.name ?? ''}`, value: l.matched, total: l.total }))} />
            </Panel>
            <Panel title="担当者別（今日）" sub="正常に照合した件数">
              <HBars labelWidth={110} items={(d.data?.by_staff ?? []).map((s) => ({ label: s.name ?? `#${s.staff_id}`, value: s.ok, note: s.n > s.ok ? `ほか ${s.n - s.ok}` : undefined }))} />
            </Panel>
          </div>
        </div>
      </div>
    </>
  );
}
