import { useState } from 'react';
import { apiGet, apiSend, type Page } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Alert, Button, Dialog, Field, Loading, PageHeader, errorMessage, useLoad } from '../components/ui';
import { RESULT_TEXT, exportPaged, fmtScanTime, jstDay } from '../report/util';
import { navigate } from '../router';

/** 読み取り履歴（docs/requirements.md・指示書 §11）。すべての読み取り（エラーも）を検索・CSV 出力。取消は管理者 */

interface LogRow {
  id: number; day: string; scanned_at: string; staff_name: string; barcode: string; raw_value: string; input: string; result: string; reason: string | null;
  device_label: string | null; order_item_id: number | null; global_no: string | null; product_code: string | null; customer_name: string | null;
  destination_name: string | null; quantity: number | null; location_code: string | null; location_name: string | null; user_name: string | null; void_reason: string | null;
}
interface Opt { id: number; code: string; name: string }

export function ScanLogsPage() {
  const { can } = useAuth();
  const [f, setF] = useState({ from: jstDay(), to: jstDay(), staff_id: '', result: '', location_id: '', barcode: '', q: '' });
  const [applied, setApplied] = useState(f);
  const [extra, setExtra] = useState<{ key: string; items: LogRow[]; next: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);
  const [voiding, setVoiding] = useState<LogRow | null>(null);
  const [tick, setTick] = useState(0);
  const staff = useLoad(() => apiGet<Page<Opt>>('/staff?limit=200'), []);
  const locations = useLoad(() => apiGet<Page<Opt>>('/locations?limit=200'), []);

  const qs = (a: typeof f) => {
    const p = new URLSearchParams();
    Object.entries(a).forEach(([k, v]) => { if (v) p.set(k, v); });
    return p.toString();
  };
  const key = qs(applied) + `#${tick}`;
  const first = useLoad(() => apiGet<Page<LogRow>>(`/scan-logs?${qs(applied)}&limit=100`), [key]);
  const mine = extra?.key === key ? extra : null;
  const rows = [...(first.data?.items ?? []), ...(mine?.items ?? [])];
  const next = mine ? mine.next : first.data?.next_cursor ?? null;
  const more = async () => {
    try {
      const r = await apiGet<Page<LogRow>>(`/scan-logs?${qs(applied)}&limit=100&cursor=${encodeURIComponent(next ?? '')}`);
      setExtra({ key, items: [...(mine?.items ?? []), ...r.items], next: r.next_cursor });
    } catch (e) { setError(errorMessage(e)); }
  };
  const doExport = async () => {
    setError(null); setExporting('0 件…');
    try {
      const r = await exportPaged<LogRow>(`/scan-logs?${qs(applied)}`, `読み取り履歴_${applied.from}_${applied.to}.csv`,
        ['読み取り日時', '担当者', '結果', '理由', 'バーコード', '読み取り値', '入力', 'グローバル番号', '商品コード', '数量', '得意先', '納品先', '置場', '使用端末', 'ログインユーザー', '取消の理由'],
        (x) => [fmtScanTime(x.scanned_at), x.staff_name, RESULT_TEXT[x.result]?.label ?? x.result, x.reason, x.barcode, x.raw_value, x.input === 'manual' ? '手入力' : 'リーダー',
          x.global_no, x.product_code, x.quantity, x.customer_name, x.destination_name, x.location_code, x.device_label, x.user_name, x.void_reason],
        (n) => setExporting(`${n} 件…`));
      if (r.truncated) setError(`件数が多いため、最初の ${r.rows.toLocaleString()} 件だけを保存しました。期間を分けてください。`);
    } catch (e) { setError(errorMessage(e)); } finally { setExporting(null); }
  };

  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <>
      <PageHeader title="読み取り履歴" sub="すべての読み取り（エラー・重複も）の記録です。書き換え・削除はできません（取消は記録を残したまま行います）。"
        actions={can('export') && <Button onClick={() => void doExport()} disabled={!!exporting}>{exporting ? `CSV を作成中 ${exporting}` : 'CSV 出力'}</Button>} />
      <div className="flex flex-col gap-3 p-4 lg:p-5">
        <form className="card grid grid-cols-2 gap-2.5 p-3.5 md:grid-cols-4 xl:grid-cols-8" onSubmit={(e) => { e.preventDefault(); setApplied(f); }}>
          <Field label="期間（から）"><input className="input" type="date" value={f.from} onChange={set('from')} /></Field>
          <Field label="期間（まで）"><input className="input" type="date" value={f.to} onChange={set('to')} /></Field>
          <Field label="担当者"><select className="input" value={f.staff_id} onChange={set('staff_id')}><option value="">すべて</option>{staff.data?.items.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
          <Field label="結果"><select className="input" value={f.result} onChange={set('result')}>
            <option value="">すべて</option><option value="problem">正常以外</option>
            {Object.entries(RESULT_TEXT).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></Field>
          <Field label="置場"><select className="input" value={f.location_id} onChange={set('location_id')}><option value="">すべて</option>{locations.data?.items.map((l) => <option key={l.id} value={l.id}>{l.code} {l.name}</option>)}</select></Field>
          <Field label="バーコード（前方一致）"><input className="input mono" value={f.barcode} onChange={set('barcode')} /></Field>
          <Field label="商品コード・得意先・納品先"><input className="input" value={f.q} onChange={set('q')} /></Field>
          <div className="flex items-end"><Button type="submit" variant="primary" className="w-full">検索</Button></div>
        </form>
        {(first.error ?? error) && <Alert kind="error">{first.error ?? error}</Alert>}
        {!first.data ? <Loading /> : (
          <div className="card overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>読み取り日時</th><th>担当者</th><th>結果</th><th>バーコード</th><th>商品コード</th><th className="text-right">数量</th><th>得意先 / 納品先</th><th>置場</th><th>端末</th>{can('scan.correct') && <th />}</tr></thead>
              <tbody>
                {rows.length === 0 && <tr><td colSpan={10} className="py-10 text-center text-slate-500">この条件の読み取りはありません。</td></tr>}
                {rows.map((r) => {
                  const t = RESULT_TEXT[r.result] ?? { label: r.result, cls: 'pill-gray', icon: '' };
                  return (
                    <tr key={r.id} className={r.void_reason ? 'row-off' : ''}>
                      <td className="whitespace-nowrap">{fmtScanTime(r.scanned_at).slice(5)}</td>
                      <td className="whitespace-nowrap">{r.staff_name}</td>
                      <td>
                        <span className={`pill ${t.cls}`}>{t.icon} {t.label}</span>
                        {r.input === 'manual' && <span className="pill pill-gray ml-1">手入力</span>}
                        {r.void_reason && <span className="pill pill-gray ml-1" title={r.void_reason}>取消済み</span>}
                        {r.reason && <div className="mt-0.5 max-w-64 text-[11px] text-slate-500">{r.reason}</div>}
                      </td>
                      <td className="mono text-xs">{r.barcode}</td>
                      <td className="mono text-xs">{r.order_item_id ? <a className="text-blue-700 underline" href={`#/orders/${r.order_item_id}`}>{r.product_code}</a> : '—'}</td>
                      <td className="text-right">{r.quantity ?? ''}</td>
                      <td className="max-w-56 truncate text-xs" title={`${r.customer_name ?? ''} / ${r.destination_name ?? ''}`}>{r.customer_name ?? '—'}<br /><span className="text-slate-500">{r.destination_name ?? ''}</span></td>
                      <td className="whitespace-nowrap">{r.location_code ? `${r.location_code} ${r.location_name ?? ''}` : '—'}</td>
                      <td className="text-xs whitespace-nowrap text-slate-500">{r.device_label ?? ''}</td>
                      {can('scan.correct') && <td className="text-right">{!r.void_reason && <Button size="sm" onClick={() => setVoiding(r)}>取消</Button>}</td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {next && <div className="border-t border-slate-100 p-2 text-center"><Button onClick={() => void more()}>さらに表示</Button></div>}
          </div>
        )}
      </div>
      {voiding && <VoidDialog row={voiding} onClose={() => setVoiding(null)} onDone={() => { setVoiding(null); setTick((t) => t + 1); }} />}
    </>
  );
}

function VoidDialog({ row, onClose, onDone }: { row: LogRow; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true); setError(null);
    try { await apiSend('POST', `/scan-logs/${row.id}/corrections`, { action: 'void', reason: reason.trim() }); onDone(); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <Dialog open title="読み取りを取り消す" onClose={onClose}
      footer={<><Button onClick={onClose} disabled={busy}>やめる</Button><Button variant="danger" onClick={() => void save()} disabled={busy || !reason.trim()}>取り消す</Button></>}>
      {error && <Alert kind="error">{error}</Alert>}
      <p className="text-sm">{fmtScanTime(row.scanned_at)} に {row.staff_name} さんが読み取った <b className="mono">{row.barcode}</b>（{RESULT_TEXT[row.result]?.label}）を取り消します。</p>
      {row.result === 'ok' && <Alert kind="warn">「正常」の読み取りを取り消すと、この明細は照合待ちに戻ります。</Alert>}
      <p className="text-xs text-slate-500">元の記録は消えずに「取消済み」として残り、操作の記録にも残ります。</p>
      <Field label="理由" required><textarea className="input" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="例: 隣の部品を読んでしまった" /></Field>
      <Button size="sm" className="self-start" onClick={() => { if (row.order_item_id) navigate(`/orders/${row.order_item_id}`); }} disabled={!row.order_item_id}>明細の詳細を開く</Button>
    </Dialog>
  );
}
