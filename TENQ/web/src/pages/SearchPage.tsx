import { useState, type FormEvent } from 'react';
import { apiGet } from '../api/client';
import { downloadInspectionsCsv } from '../api/exports';
import { useAuth } from '../auth/AuthContext';
import { Alert, Button, Field, Loading, PageHeader, errorMessage, useLoad } from '../components/ui';
import { INSPECTION_STATUS, formatDateTime } from '../labels';
import { currentQuery } from '../router';

/** 点検履歴・検索（S-09）。条件をそのまま CSV に出せる */

interface Row {
  id: string; inspection_date: string; factory_name: string; equipment_code: string; equipment_name: string; category: string | null;
  status: string; overall_result: string | null; inspector_name: string; completed_at: string | null; current_revision: number; abnormality_count: number;
}
type Filters = Record<'from' | 'to' | 'factory' | 'equipment' | 'inspector' | 'result' | 'status' | 'abnormal' | 'corrected' | 'category', string>;

const jstToday = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date());
const daysAgo = (n: number) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date(Date.now() - n * 86_400_000));

export function SearchPage() {
  const { me, can } = useAuth();
  const q = currentQuery();
  const init: Filters = {
    from: q.get('from') ?? daysAgo(6), to: q.get('to') ?? jstToday(), factory: q.get('factory') ?? '', equipment: q.get('equipment') ?? '',
    inspector: q.get('inspector') ?? '', result: q.get('result') ?? '', status: q.get('status') ?? '', abnormal: q.get('abnormal') ?? '',
    corrected: q.get('corrected') ?? '', category: q.get('category') ?? '',
  };
  const [form, setForm] = useState<Filters>(init);
  const [applied, setApplied] = useState<Filters>(init);
  const [more, setMore] = useState<{ key: string; rows: Row[]; cursor: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const people = useLoad(() => apiGet<{ items: { id: string; name: string }[] }>('/users/directory'), []);
  const equipment = useLoad(() => apiGet<{ items: { id: string; equipment_code: string; name: string }[] }>('/equipment?limit=200&status=all'), []);

  const qs = (f: Filters, extra: Record<string, string> = {}) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...f, ...extra })) if (v) p.set(k, v);
    return p.toString();
  };

  // 1ページ目は条件が変わるたびに読み直す。「さらに読み込む」の分は条件ごとに足していく
  const key = qs(applied);
  const page = useLoad(() => apiGet<{ items: Row[]; nextCursor: string | null }>(`/inspections?${qs(applied, { limit: '50' })}`), [key]);
  const extra = more?.key === key ? more : null;
  const rows = page.data ? [...page.data.items, ...(extra?.rows ?? [])] : null;
  const cursor = extra ? extra.cursor : page.data?.nextCursor ?? null;

  async function loadMore() {
    if (!cursor) return;
    setBusy(true); setError(null);
    try {
      const r = await apiGet<{ items: Row[]; nextCursor: string | null }>(`/inspections?${qs(applied, { limit: '50', cursor })}`);
      setMore({ key, rows: [...(extra?.rows ?? []), ...r.items], cursor: r.nextCursor });
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  }
  const search = (f: Filters) => { setError(null); setApplied({ ...f }); };

  const set = (k: keyof Filters) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = (e: FormEvent) => { e.preventDefault(); search(form); };

  return (
    <>
      <PageHeader title="点検履歴・検索" sub="期間・設備・点検者・結果などで点検の記録を探します。"
        actions={can('export') && <Button disabled={busy} onClick={async () => {
          try { await downloadInspectionsCsv(qs(applied)); } catch (e) { setError(errorMessage(e)); }
        }}>この条件で CSV を出力</Button>} />

      <form className="panel search-form" onSubmit={submit}>
        <div className="form-grid compact">
          <Field label="開始日"><input type="date" value={form.from} onChange={set('from')} /></Field>
          <Field label="終了日"><input type="date" value={form.to} onChange={set('to')} /></Field>
          {(me?.factories.length ?? 0) > 1 && (
            <Field label="工場"><select value={form.factory} onChange={set('factory')}><option value="">すべて</option>{me?.factories.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></Field>
          )}
          <Field label="設備">
            <select value={form.equipment} onChange={set('equipment')}>
              <option value="">すべて</option>
              {equipment.data?.items.map((e) => <option key={e.id} value={e.id}>{e.equipment_code} {e.name}</option>)}
            </select>
          </Field>
          <Field label="点検者">
            <select value={form.inspector} onChange={set('inspector')}><option value="">すべて</option>{people.data?.items.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
          </Field>
          <Field label="結果"><select value={form.result} onChange={set('result')}><option value="">すべて</option><option value="ok">異常なし</option><option value="ng">異常あり</option></select></Field>
          <Field label="状態"><select value={form.status} onChange={set('status')}><option value="">取消以外</option><option value="completed">完了</option><option value="in_progress">点検中</option><option value="voided">取消</option><option value="all">すべて</option></select></Field>
          <Field label="異常報告"><select value={form.abnormal} onChange={set('abnormal')}><option value="">すべて</option><option value="1">報告あり</option><option value="0">報告なし</option></select></Field>
          <Field label="訂正"><select value={form.corrected} onChange={set('corrected')}><option value="">すべて</option><option value="1">訂正あり</option></select></Field>
        </div>
        <div className="button-row end">
          <Button onClick={() => { const f = { ...init, from: daysAgo(6), to: jstToday(), factory: '', equipment: '', inspector: '', result: '', status: '', abnormal: '', corrected: '', category: '' }; setForm(f); search(f); }}>条件を戻す</Button>
          <Button type="submit" variant="primary" disabled={page.loading}>検索</Button>
        </div>
      </form>

      {(error ?? page.error) && <Alert kind="error">{error ?? page.error}</Alert>}
      {rows === null ? (page.loading ? <Loading /> : null) : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>点検日</th><th>設備</th><th className="hide-sm">工場</th><th>点検者</th><th>結果</th><th className="hide-sm">完了</th><th className="hide-sm">補足</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><a href={`#/inspections/${r.id}`}>{r.inspection_date}</a></td>
                  <td><span className="code">{r.equipment_code}</span> {r.equipment_name}</td>
                  <td className="hide-sm">{r.factory_name}</td>
                  <td>{r.inspector_name}</td>
                  <td>
                    {r.status !== 'completed' ? <span className={`badge ${INSPECTION_STATUS[r.status]?.cls ?? ''}`}>{INSPECTION_STATUS[r.status]?.label}</span>
                      : <span className={`badge ${r.overall_result === 'ng' ? 'st-ng' : 'st-ok'}`}>{r.overall_result === 'ng' ? '異常あり' : '異常なし'}</span>}
                  </td>
                  <td className="hide-sm small">{formatDateTime(r.completed_at)}</td>
                  <td className="hide-sm small">{r.current_revision > 1 && <span className="badge st-late">訂正 {r.current_revision - 1}回</span>} {r.abnormality_count > 0 && <span className="badge st-ng">異常報告 {r.abnormality_count}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <p className="empty">条件に合う点検の記録はありません。</p>}
        </div>
      )}
      {cursor && <div className="more"><Button disabled={busy} onClick={() => void loadMore()}>さらに読み込む</Button></div>}
    </>
  );
}
