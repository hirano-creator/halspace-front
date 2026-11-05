import { useEffect, useState, type ReactNode } from 'react';
import { CODE_RULE_TEXT } from '@partsgate/shared';
import { apiGet, apiSend, type Page } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Alert, Button, Dialog, Field, Loading, PageHeader, StatusPill, errorMessage, fieldErrors, fmtDateTime } from '../components/ui';

/**
 * マスター（担当者・置場・納品先）の一覧・登録・編集。項目の定義を渡すだけで画面ができる。
 * 物理削除はしない。「利用停止」にすると担当者選択や CSV 取込の照合に出なくなる。
 */

export interface MasterField {
  key: string;
  label: string;
  required?: boolean;
  code?: boolean;
  type?: 'text' | 'number' | 'textarea';
  max?: number;
  hint?: string;
  /** 一覧に出す列か */
  list?: boolean;
  /** 登録後に変えられない（または変えにくい）項目の注意書き */
  editHint?: string;
}

export interface MasterConfig {
  title: string;
  sub: ReactNode;
  path: string;            // '/staff'
  noun: string;            // 「担当者」
  fields: MasterField[];
  searchPlaceholder: string;
}

type Row = Record<string, unknown> & { id: number; status: string; version: number; updated_at: string };

export function MasterPage({ config }: { config: MasterConfig }) {
  const { can } = useAuth();
  const editable = can('master.edit');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'' | 'active' | 'inactive'>('active');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Row | 'new' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const url = (cursor?: string | null) => {
    const p = new URLSearchParams({ limit: '100' });
    if (query) p.set('q', query);
    if (status) p.set('status', status);
    if (cursor) p.set('cursor', cursor);
    return `${config.path}?${p.toString()}`;
  };

  useEffect(() => {
    let alive = true;
    apiGet<Page<Row>>(url())
      .then((r) => { if (alive) { setRows(r.items); setNext(r.next_cursor); setError(null); } })
      .catch((e: unknown) => { if (alive) setError(errorMessage(e)); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, status, tick, config.path]);

  const more = async () => {
    try {
      const r = await apiGet<Page<Row>>(url(next));
      setRows((x) => [...(x ?? []), ...r.items]);
      setNext(r.next_cursor);
    } catch (e) { setError(errorMessage(e)); }
  };

  const listFields = config.fields.filter((f) => f.list);

  return (
    <>
      <PageHeader title={config.title} sub={config.sub}
        actions={editable && <Button variant="primary" onClick={() => { setNotice(null); setEditing('new'); }}>＋ {config.noun}を登録</Button>} />
      <div className="flex flex-col gap-3 p-4 lg:p-5">
        <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); setQuery(q.trim()); }}>
          <input className="input max-w-xs" type="search" placeholder={config.searchPlaceholder} value={q} onChange={(e) => setQ(e.target.value)} aria-label="検索" />
          <Button type="submit">検索</Button>
          <div className="ml-auto flex overflow-hidden rounded-lg border border-slate-300" role="group" aria-label="状態">
            {([['active', '利用中'], ['inactive', '停止中'], ['', 'すべて']] as const).map(([v, l]) => (
              <button key={v} type="button" onClick={() => setStatus(v)} aria-pressed={status === v}
                className={`border-l border-slate-200 px-3 py-2 text-sm first:border-l-0 ${status === v ? 'bg-slate-900 font-bold text-white' : 'bg-white'}`}>{l}</button>
            ))}
          </div>
        </form>
        {notice && <Alert kind="success">{notice}</Alert>}
        {error && <Alert kind="error">{error}</Alert>}
        {!rows ? <Loading /> : (
          <div className="card overflow-x-auto">
            <table className="tbl">
              <thead><tr>{listFields.map((f) => <th key={f.key}>{f.label}</th>)}<th>状態</th><th>更新日時</th>{editable && <th />}</tr></thead>
              <tbody>
                {rows.length === 0 && <tr><td colSpan={listFields.length + 3} className="py-10 text-center text-slate-500">{query ? '見つかりませんでした。' : `${config.noun}はまだ登録されていません。`}</td></tr>}
                {rows.map((r) => (
                  <tr key={r.id} className={r.status !== 'active' ? 'row-off' : ''}>
                    {listFields.map((f) => <td key={f.key} className={f.code ? 'mono font-bold' : ''}>{String(r[f.key] ?? '') || '—'}</td>)}
                    <td><StatusPill status={r.status} /></td>
                    <td className="whitespace-nowrap text-xs text-slate-500">{fmtDateTime(r.updated_at)}</td>
                    {editable && <td className="text-right"><Button size="sm" onClick={() => { setNotice(null); setEditing(r); }}>編集</Button></td>}
                  </tr>
                ))}
              </tbody>
            </table>
            {next && <div className="border-t border-slate-100 p-2 text-center"><Button onClick={more}>さらに表示</Button></div>}
          </div>
        )}
      </div>
      {editing && (
        <MasterForm config={config} row={editing === 'new' ? null : editing} onClose={() => setEditing(null)}
          onSaved={(msg) => { setEditing(null); setNotice(msg); setTick((t) => t + 1); }} />
      )}
    </>
  );
}

function MasterForm({ config, row, onClose, onSaved }: { config: MasterConfig; row: Row | null; onClose: () => void; onSaved: (msg: string) => void }) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(config.fields.map((f) => [f.key, row?.[f.key] === null || row?.[f.key] === undefined ? '' : String(row[f.key])])));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const body = (extra: Record<string, unknown> = {}) => {
    const b: Record<string, unknown> = {};
    for (const f of config.fields) {
      const v = values[f.key]?.trim() ?? '';
      if (f.type === 'number') { if (v !== '') b[f.key] = Number(v); }
      else b[f.key] = v === '' ? null : v;
    }
    return { ...b, ...extra };
  };

  const save = async (extra: Record<string, unknown> = {}, msg?: string) => {
    setBusy(true); setError(null); setErrors({});
    try {
      if (row) await apiSend('PUT', `${config.path}/${row.id}`, body({ ...extra, version: row.version }));
      else await apiSend('POST', config.path, body());
      onSaved(msg ?? `${config.noun}を${row ? '更新' : '登録'}しました。`);
    } catch (e) {
      setErrors(fieldErrors(e));
      setError(errorMessage(e));
    } finally { setBusy(false); }
  };

  return (
    <Dialog open title={row ? `${config.noun}を編集` : `${config.noun}を登録`} onClose={onClose}
      footer={<>
        {row && (row.status === 'active'
          ? <Button variant="danger" className="mr-auto" disabled={busy} onClick={() => void save({ status: 'inactive' }, `${config.noun}を利用停止にしました。`)}>利用停止にする</Button>
          : <Button className="mr-auto" disabled={busy} onClick={() => void save({ status: 'active' }, `${config.noun}の利用を再開しました。`)}>利用を再開する</Button>)}
        <Button onClick={onClose} disabled={busy}>やめる</Button>
        <Button variant="primary" onClick={() => void save()} disabled={busy}>{busy ? '保存しています…' : '保存する'}</Button>
      </>}>
      {error && <Alert kind="error">{error}</Alert>}
      {row && row.status !== 'active' && <Alert kind="warn">この{config.noun}は利用停止中です。</Alert>}
      <div className="grid gap-3.5 sm:grid-cols-2">
        {config.fields.map((f) => (
          <Field key={f.key} label={f.label} required={f.required} error={errors[f.key]} hint={row && f.editHint ? f.editHint : f.hint ?? (f.code ? CODE_RULE_TEXT : undefined)}
            className={f.type === 'textarea' || (!f.code && f.max && f.max > 60) ? 'sm:col-span-2' : ''}>
            {f.type === 'textarea'
              ? <textarea className="input" rows={3} maxLength={f.max} value={values[f.key]} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} />
              : <input className={`input ${f.code ? 'mono' : ''}`} type={f.type === 'number' ? 'number' : 'text'} maxLength={f.max} value={values[f.key]} aria-invalid={!!errors[f.key]}
                  inputMode={f.type === 'number' ? 'numeric' : undefined} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} />}
          </Field>
        ))}
      </div>
    </Dialog>
  );
}

export const STAFF: MasterConfig = {
  title: '担当者管理', noun: '担当者', path: '/staff', searchPlaceholder: 'コード・氏名で探す',
  sub: '読み取りをする作業者です。ログインのアカウントとは別に管理します（1 台の PC を交代で使えるようにするため）。',
  fields: [
    { key: 'code', label: '担当者コード', required: true, code: true, max: 32, list: true },
    { key: 'name', label: '氏名', required: true, max: 50, list: true, hint: '名前を変えても、過去の読み取り履歴は当時の名前のまま残ります' },
    { key: 'department', label: '所属部署', max: 50, list: true },
    { key: 'factory', label: '所属工場', max: 50, list: true },
    { key: 'sort_order', label: '並び順', type: 'number', list: true, hint: '担当者を選ぶ画面で、小さい順に並びます' },
  ],
};

export const LOCATIONS: MasterConfig = {
  title: '置場管理', noun: '置場', path: '/locations', searchPlaceholder: 'コード・置場名で探す',
  sub: 'CSV の「置場」と照合します。コードは CSV と同じ書き方（例: 0053）で登録してください。',
  fields: [
    { key: 'code', label: '置場コード', required: true, code: true, max: 32, list: true, editHint: '注文で使われている置場のコードは変えられません' },
    { key: 'name', label: '置場名', required: true, max: 50, list: true },
    { key: 'description', label: '説明', max: 200, list: true, type: 'textarea' },
  ],
};

export const DESTINATIONS: MasterConfig = {
  title: '納品先管理', noun: '納品先', path: '/destinations', searchPlaceholder: 'コード・納品先名で探す',
  sub: '得意先コードと直送先コードの組で見分けます（直送先コードは得意先が違うと同じ値になることがあるため）。',
  fields: [
    { key: 'customer_code', label: '得意先コード', required: true, code: true, max: 32, list: true },
    { key: 'code', label: '直送先コード', required: true, code: true, max: 32, list: true },
    { key: 'name', label: '納品先名', required: true, max: 100, list: true },
    { key: 'postal_code', label: '郵便番号', max: 10 },
    { key: 'phone', label: '電話番号', max: 20, list: true },
    { key: 'address', label: '住所', max: 200 },
    { key: 'note', label: '備考', max: 500, type: 'textarea' },
  ],
};
