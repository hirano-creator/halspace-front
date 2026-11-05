import { Fragment, useState } from 'react';
import { apiGet, apiSend, type Page } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Alert, Button, Dialog, Field, Loading, PageHeader, errorMessage, useLoad } from '../components/ui';
import { RESULT_TEXT, STATUS_TEXT, exportPaged, fmtScanTime, jstDay, md } from '../report/util';
import { navigate } from '../router';

/** 注文データの一覧と詳細（指示書 §10）。検索・集計はサーバー側、一覧はページ送り */

interface ItemRow {
  id: number; global_no: string; product_code: string; product_name: string; quantity: number; customer_code: string; customer_name: string | null;
  destination_name: string | null; ssd: string | null; vrd: string | null; ship_method: string | null; export_type: string | null; location_code: string;
  location_name: string | null; status: string; matched_at: string | null; matched_staff_name: string | null; total_weight: number | null; slip_no: string; created_at: string;
}
interface Opt { id: number; code: string; name: string }

export function OrdersPage() {
  const { can } = useAuth();
  const [f, setF] = useState({ date: 'vrd', from: jstDay(-7), to: jstDay(14), status: '', location_id: '', q: '' });
  const [applied, setApplied] = useState(f);
  const [extra, setExtra] = useState<{ key: string; items: ItemRow[]; next: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);
  const locations = useLoad(() => apiGet<Page<Opt>>('/locations?limit=200'), []);
  const qs = (a: typeof f) => { const p = new URLSearchParams(); Object.entries(a).forEach(([k, v]) => { if (v) p.set(k, v); }); return p.toString(); };
  const key = qs(applied);
  const first = useLoad(() => apiGet<Page<ItemRow>>(`/orders/items?${key}&limit=100`), [key]);
  const mine = extra?.key === key ? extra : null;
  const rows = [...(first.data?.items ?? []), ...(mine?.items ?? [])];
  const next = mine ? mine.next : first.data?.next_cursor ?? null;
  const more = async () => {
    try {
      const r = await apiGet<Page<ItemRow>>(`/orders/items?${key}&limit=100&cursor=${encodeURIComponent(next ?? '')}`);
      setExtra({ key, items: [...(mine?.items ?? []), ...r.items], next: r.next_cursor });
    } catch (e) { setError(errorMessage(e)); }
  };
  const doExport = async () => {
    setError(null); setExporting('0 件…');
    try {
      const r = await exportPaged<ItemRow>(`/orders/items?${key}`, `注文データ_${applied.from}_${applied.to}.csv`,
        ['グローバル番号', '受注伝票番号', '商品コード', '商品名', '数量', '得意先コード', '得意先名', 'お届け先名', 'メーカー出荷日', 'ミスミ納期', '出荷方法', '輸出区分', '置場', '商品重量', '照合状況', 'チェック者', 'チェック時間', '登録日時'],
        (x) => [x.global_no, x.slip_no, x.product_code, x.product_name, x.quantity, x.customer_code, x.customer_name, x.destination_name, x.ssd, x.vrd, x.ship_method, x.export_type,
          x.location_code, x.total_weight, STATUS_TEXT[x.status]?.label.replace(/^[✔⚠] /, '') ?? x.status, x.matched_staff_name, fmtScanTime(x.matched_at), fmtScanTime(x.created_at)],
        (n) => setExporting(`${n} 件…`));
      if (r.truncated) setError(`件数が多いため、最初の ${r.rows.toLocaleString()} 件だけを保存しました。期間を分けてください。`);
    } catch (e) { setError(errorMessage(e)); } finally { setExporting(null); }
  };
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <>
      <PageHeader title="注文データ" sub="CSV から取り込んだ注文の明細です。行を押すと、読み取りの経緯が見られます。"
        actions={can('export') && <Button onClick={() => void doExport()} disabled={!!exporting}>{exporting ? `CSV を作成中 ${exporting}` : 'CSV 出力'}</Button>} />
      <div className="flex flex-col gap-3 p-4 lg:p-5">
        <form className="card grid grid-cols-2 gap-2.5 p-3.5 md:grid-cols-4 xl:grid-cols-7" onSubmit={(e) => { e.preventDefault(); setApplied(f); }}>
          <Field label="日付の種類"><select className="input" value={f.date} onChange={set('date')}><option value="vrd">ミスミ納期</option><option value="ssd">メーカー出荷日</option></select></Field>
          <Field label="から"><input className="input" type="date" value={f.from} onChange={set('from')} /></Field>
          <Field label="まで"><input className="input" type="date" value={f.to} onChange={set('to')} /></Field>
          <Field label="照合状況"><select className="input" value={f.status} onChange={set('status')}>
            <option value="">すべて</option><option value="open">未確認（照合待ち・要確認）</option>
            {Object.entries(STATUS_TEXT).filter(([k]) => k !== 'shipped').map(([k, v]) => <option key={k} value={k}>{v.label.replace(/^[✔⚠] /, '')}</option>)}</select></Field>
          <Field label="置場"><select className="input" value={f.location_id} onChange={set('location_id')}><option value="">すべて</option>{locations.data?.items.map((l) => <option key={l.id} value={l.id}>{l.code} {l.name}</option>)}</select></Field>
          <Field label="番号・商品・得意先・納品先"><input className="input" value={f.q} onChange={set('q')} placeholder="グローバル番号は前方一致" /></Field>
          <div className="flex items-end"><Button type="submit" variant="primary" className="w-full">検索</Button></div>
        </form>
        {(first.error ?? error) && <Alert kind="error">{first.error ?? error}</Alert>}
        {!first.data ? <Loading /> : (
          <div className="card overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>グローバル番号</th><th>商品コード</th><th className="text-right">数量</th><th>得意先 / お届け先</th><th>出荷日</th><th>納期</th><th>出荷方法</th><th>置場</th><th>照合状況</th></tr></thead>
              <tbody>
                {rows.length === 0 && <tr><td colSpan={9} className="py-10 text-center text-slate-500">この条件の注文はありません。</td></tr>}
                {rows.map((r) => {
                  const st = STATUS_TEXT[r.status] ?? { label: r.status, cls: 'pill-gray' };
                  return (
                    <tr key={r.id} className="row-click" onClick={() => navigate(`/orders/${r.id}`)}>
                      <td className="mono">{r.global_no}{r.export_type === 'E' && <span className="pill pill-info ml-1">輸出</span>}</td>
                      <td className="mono text-xs">{r.product_code}</td>
                      <td className="text-right">{r.quantity}</td>
                      <td className="max-w-60 truncate text-xs">{r.customer_name ?? '—'}<br /><span className="text-slate-500">{r.destination_name ?? ''}</span></td>
                      <td>{md(r.ssd)}</td><td>{md(r.vrd)}</td><td className="text-xs">{r.ship_method ?? ''}</td>
                      <td className="whitespace-nowrap">{r.location_code} {r.location_name ?? ''}</td>
                      <td><span className={`pill ${st.cls}`}>{st.label}</span>{r.matched_staff_name && <div className="text-[11px] text-slate-500">{r.matched_staff_name} {fmtScanTime(r.matched_at).slice(5, 16)}</div>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {next && <div className="border-t border-slate-100 p-2 text-center"><Button onClick={() => void more()}>さらに表示</Button></div>}
          </div>
        )}
      </div>
    </>
  );
}

interface Detail {
  item: Record<string, unknown> & { id: number; status: string; global_no: string; slip_no: string; slip_total: number; slip_matched: number };
  scans: { id: number; scanned_at: string; staff_name: string; result: string; reason: string | null; input: string; device_label: string | null; void_reason: string | null }[];
  slip: { id: number; global_no: string; product_code: string; quantity: number; status: string }[];
}

export function OrderDetailPage({ id }: { id: string }) {
  const { can } = useAuth();
  const d = useLoad(() => apiGet<Detail>(`/orders/items/${id}`), [id]);
  const [action, setAction] = useState<'match' | 'cancel' | 'reopen' | null>(null);
  if (d.error) return <div className="p-5"><Alert kind="error">{d.error}</Alert></div>;
  if (!d.data) return <Loading />;
  const it = d.data.item;
  const v = (k: string) => (it[k] === null || it[k] === undefined || it[k] === '' ? '—' : String(it[k]));
  const st = STATUS_TEXT[it.status] ?? { label: it.status, cls: 'pill-gray' };
  const fields: [string, string][] = [
    ['グローバル番号', v('global_no')], ['バーコード用グローバル番号', v('barcode_global_no')], ['受注伝票番号', `${v('slip_no')}（${it.slip_matched} / ${it.slip_total} 済）`],
    ['商品コード', v('product_code')], ['商品名', v('product_name')], ['数量', v('quantity')], ['得意先', `${v('customer_code')} ${v('customer_name')}`],
    ['お届け先', `${v('destination_code')} ${v('destination_name')}`], ['顧客注文番号', v('customer_order_no')], ['置場', `${v('location_code')} ${v('location_name')}`],
    ['メーカー出荷日', v('ssd')], ['ミスミ納期', v('vrd')], ['出荷方法', v('ship_method')], ['輸出区分', v('export_type')],
    ['個別重量 / 商品重量', `${v('unit_weight')} g / ${v('total_weight')} g`], ['最後に取り込んだ CSV', `${v('last_import_file')}（${fmtScanTime(it.last_import_at as string)}）`],
  ];
  return (
    <>
      <PageHeader title="注文データの詳細" sub={<span className="mono">{it.global_no}</span>}
        actions={<>
          <Button onClick={() => history.back()}>← 戻る</Button>
          {can('scan.correct') && (it.status === 'pending' || it.status === 'review') && <><Button onClick={() => setAction('match')}>照合済みにする</Button><Button variant="danger" onClick={() => setAction('cancel')}>取消にする</Button></>}
          {can('scan.correct') && (it.status === 'review' || it.status === 'cancelled') && <Button onClick={() => setAction('reopen')}>照合待ちに戻す</Button>}
        </>} />
      <div className="grid gap-3 p-4 lg:grid-cols-[1.4fr_1fr] lg:p-5">
        <section className="card p-4">
          <div className="mb-3 flex items-center gap-2"><span className={`pill ${st.cls}`}>{st.label}</span>
            {typeof it.matched_staff_name === 'string' && <span className="text-sm text-slate-600">{it.matched_staff_name} さん・{fmtScanTime(it.matched_at as string)}</span>}</div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            {fields.map(([k, val]) => <Fragment key={k}><dt className="text-slate-500">{k}</dt><dd className="m-0 font-medium break-all">{val}</dd></Fragment>)}
          </dl>
        </section>
        <div className="flex flex-col gap-3">
          <section className="card p-4">
            <h2 className="mb-2 font-bold">読み取りの経緯</h2>
            {d.data.scans.length === 0 ? <p className="text-sm text-slate-500">まだ読み取られていません。</p> : (
              <ol className="flex flex-col gap-2 text-sm">
                {d.data.scans.map((s) => {
                  const t = RESULT_TEXT[s.result] ?? { label: s.result, cls: 'pill-gray', icon: '' };
                  return (
                    <li key={s.id} className={`rounded-lg border border-slate-200 p-2 ${s.void_reason ? 'opacity-60' : ''}`}>
                      <div className="flex flex-wrap items-center gap-1.5"><span className={`pill ${t.cls}`}>{t.icon} {t.label}</span>
                        {s.input === 'manual' && <span className="pill pill-gray">手入力</span>}{s.void_reason && <span className="pill pill-gray">取消済み</span>}
                        <span className="ml-auto text-xs text-slate-500">{fmtScanTime(s.scanned_at)}</span></div>
                      <div className="mt-1 text-xs text-slate-600">{s.staff_name}{s.device_label ? `・${s.device_label}` : ''}{s.reason ? `・${s.reason}` : ''}{s.void_reason ? `・取消の理由: ${s.void_reason}` : ''}</div>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
          <section className="card p-4">
            <h2 className="mb-2 font-bold">同じ伝票の明細（{d.data.slip.length}）</h2>
            <table className="tbl">
              <tbody>
                {d.data.slip.map((x) => (
                  <tr key={x.id} className={`row-click ${x.id === it.id ? 'bg-blue-50' : ''}`} onClick={() => navigate(`/orders/${x.id}`)}>
                    <td className="mono text-xs">{x.global_no}</td><td className="mono text-xs">{x.product_code}</td><td className="text-right">{x.quantity}</td>
                    <td><span className={`pill ${STATUS_TEXT[x.status]?.cls ?? 'pill-gray'}`}>{STATUS_TEXT[x.status]?.label ?? x.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      </div>
      {action && <ResolveDialog id={it.id} action={action} onClose={() => setAction(null)} onDone={() => { setAction(null); d.reload(); }} />}
    </>
  );
}

const ACTION_TEXT = {
  match: { title: '照合済みにする', note: 'バーコードを読まずに照合済みにします。読み取り履歴には残らないため、理由を必ず書いてください（操作の記録に残ります）。', btn: '照合済みにする' },
  cancel: { title: '取消にする', note: '取消にした明細を読み取ると「要確認」になります。', btn: '取消にする' },
  reopen: { title: '照合待ちに戻す', note: '要確認・取消を照合待ちに戻します。照合済みを戻すときは、読み取り履歴で「正常」の読み取りを取り消してください。', btn: '照合待ちに戻す' },
};

function ResolveDialog({ id, action, onClose, onDone }: { id: number; action: 'match' | 'cancel' | 'reopen'; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const t = ACTION_TEXT[action];
  const save = async () => {
    setBusy(true); setError(null);
    try { await apiSend('POST', `/orders/items/${id}/resolve`, { action, reason: reason.trim() }); onDone(); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <Dialog open title={t.title} onClose={onClose}
      footer={<><Button onClick={onClose} disabled={busy}>やめる</Button><Button variant={action === 'cancel' ? 'danger' : 'primary'} onClick={() => void save()} disabled={busy || !reason.trim()}>{t.btn}</Button></>}>
      {error && <Alert kind="error">{error}</Alert>}
      <p className="text-sm">{t.note}</p>
      <Field label="理由" required><textarea className="input" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
    </Dialog>
  );
}
