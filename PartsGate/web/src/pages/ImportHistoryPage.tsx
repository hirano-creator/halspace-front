import { useState } from 'react';
import { FIELD_LABELS, IMPORT_KIND_LABELS, toCsv, type ImportKind } from '@partsgate/shared';
import { apiDownload, apiGet, saveBlob, type Page } from '../api/client';
import { Alert, Button, Loading, PageHeader, errorMessage, fmtDateTime, useLoad } from '../components/ui';
import { navigate } from '../router';
import { BatchStatus } from './ImportPage';

/** CSV 取込履歴（一覧と 1 回分の詳細）。スマホでも見られる */

interface Batch {
  id: number; file_name: string; encoding: string; status: string; row_total: number; row_new: number; row_updated: number; row_unchanged: number;
  row_error: number; row_review: number; created_at: string; committed_at: string | null; created_by_name: string | null;
}

export function ImportHistoryPage() {
  const [pages, setPages] = useState<Batch[][]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const first = useLoad(async () => {
    const r = await apiGet<Page<Batch>>('/imports?limit=30');
    setPages([r.items]); setNext(r.next_cursor);
    return true;
  }, []);
  const more = async () => {
    try { const r = await apiGet<Page<Batch>>(`/imports?limit=30&cursor=${next}`); setPages((p) => [...p, r.items]); setNext(r.next_cursor); } catch (e) { setError(errorMessage(e)); }
  };
  const rows = pages.flat();
  return (
    <>
      <PageHeader title="CSV 取込履歴" sub="取り込んだファイルと、行ごとの結果です。" actions={<Button variant="primary" onClick={() => navigate('/imports/new')}>⇪ CSV を取り込む</Button>} />
      <div className="flex flex-col gap-3 p-4 lg:p-5">
        {(first.error ?? error) && <Alert kind="error">{first.error ?? error}</Alert>}
        {!first.data ? <Loading /> : rows.length === 0 ? <div className="card p-8 text-center text-slate-500">まだ取り込んでいません。</div> : (
          <>
            {/* PC: 表 */}
            <div className="card hidden overflow-x-auto md:block">
              <table className="tbl">
                <thead><tr><th>取込日時</th><th>ファイル名</th><th>担当</th><th className="text-right">行数</th><th className="text-right">新規</th><th className="text-right">更新</th><th className="text-right">変更なし</th><th className="text-right">要確認</th><th className="text-right">エラー</th><th>状態</th></tr></thead>
                <tbody>
                  {rows.map((b) => (
                    <tr key={b.id} className="row-click" onClick={() => navigate(`/imports/${b.id}`)}>
                      <td className="whitespace-nowrap">{fmtDateTime(b.created_at)}</td><td className="mono text-xs">{b.file_name}</td><td>{b.created_by_name ?? '—'}</td>
                      <td className="text-right">{b.row_total}</td><td className="text-right">{b.row_new}</td><td className="text-right">{b.row_updated}</td><td className="text-right">{b.row_unchanged}</td>
                      <td className="text-right">{b.row_review || ''}</td><td className="text-right">{b.row_error || ''}</td><td><BatchStatus status={b.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* スマホ: カード */}
            <div className="flex flex-col gap-2 md:hidden">
              {rows.map((b) => (
                <a key={b.id} href={`#/imports/${b.id}`} className="card block p-3.5">
                  <div className="flex items-center justify-between"><b>{fmtDateTime(b.created_at)}</b><BatchStatus status={b.status} /></div>
                  <p className="mb-1.5 text-xs text-slate-500">担当 {b.created_by_name ?? '—'}</p>
                  <div className="flex flex-wrap gap-1.5">
                    <span className="pill pill-info">新規 {b.row_new}</span><span className="pill pill-gray">更新 {b.row_updated}</span>
                    {b.row_review > 0 && <span className="pill pill-warn">要確認 {b.row_review}</span>}{b.row_error > 0 && <span className="pill pill-ng">エラー {b.row_error}</span>}
                  </div>
                </a>
              ))}
            </div>
            {next && <div className="text-center"><Button onClick={more}>さらに表示</Button></div>}
          </>
        )}
      </div>
    </>
  );
}

interface ImportRow { line_no: number; global_no: string | null; kind: ImportKind; message: string | null; diff_json: string | null }

export function ImportDetailPage({ id }: { id: string }) {
  const batch = useLoad(() => apiGet<Batch>(`/imports/${id}`), [id]);
  const b = batch.data;
  const initialKind: ImportKind = b && (b.row_error || b.row_review) ? (b.row_review ? 'review' : 'error') : 'new';
  const [picked, setPicked] = useState<ImportKind | null>(null);
  const kind = picked ?? initialKind;
  const rows = useLoad(() => apiGet<{ items: ImportRow[]; next_after: number | null }>(`/imports/${id}/rows?kind=${kind}&limit=500`), [id, kind]);
  // 「さらに表示」で読んだ続き（区分を変えたら捨てる）
  const [extra, setExtra] = useState<{ kind: ImportKind; items: ImportRow[]; next: number | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shownExtra = extra?.kind === kind ? extra : null;
  const items = [...(rows.data?.items ?? []), ...(shownExtra?.items ?? [])];
  const nextAfter = shownExtra ? shownExtra.next : rows.data?.next_after ?? null;
  const more = async () => {
    try {
      const r = await apiGet<{ items: ImportRow[]; next_after: number | null }>(`/imports/${id}/rows?kind=${kind}&limit=500&after=${nextAfter}`);
      setExtra({ kind, items: [...(shownExtra?.items ?? []), ...r.items], next: r.next_after });
    } catch (e) { setError(errorMessage(e)); }
  };

  const saveRows = () => {
    if (!b) return;
    const csv = toCsv(['行', 'グローバル番号', '区分', '理由', '変更（前→後）'], items.map((r) => [r.line_no, r.global_no, IMPORT_KIND_LABELS[r.kind], r.message, r.diff_json]));
    saveBlob(`${b.file_name.replace(/\.csv$/i, '')}_${IMPORT_KIND_LABELS[kind]}.csv`, new Blob([csv], { type: 'text/csv' }));
  };

  if (batch.error) return <div className="p-5"><Alert kind="error">{batch.error}</Alert></div>;
  if (!b) return <Loading />;
  const count: Record<ImportKind, number> = { new: b.row_new, updated: b.row_updated, unchanged: b.row_unchanged, review: b.row_review, error: b.row_error };
  return (
    <>
      <PageHeader title="取込の詳細" sub={<span className="mono">{b.file_name}</span>}
        actions={<>
          <Button onClick={() => navigate('/imports')}>← 取込履歴</Button>
          <Button onClick={() => { setError(null); apiDownload(`/imports/${id}/file`, b.file_name).catch((e: unknown) => setError(errorMessage(e))); }}>元のファイルを保存</Button>
        </>} />
      <div className="flex flex-col gap-3 p-4 lg:p-5">
        {error && <Alert kind="error">{error}</Alert>}
        <div className="card flex flex-wrap gap-x-8 gap-y-2 px-4 py-3 text-sm">
          <span><span className="text-xs text-slate-500">取込日時</span><br /><b>{fmtDateTime(b.committed_at ?? b.created_at)}</b></span>
          <span><span className="text-xs text-slate-500">担当</span><br /><b>{b.created_by_name ?? '—'}</b></span>
          <span><span className="text-xs text-slate-500">文字コード</span><br /><b>{b.encoding === 'shift_jis' ? 'Shift-JIS' : 'UTF-8'}</b></span>
          <span><span className="text-xs text-slate-500">行数</span><br /><b>{b.row_total}</b></span>
          <span><span className="text-xs text-slate-500">状態</span><br /><BatchStatus status={b.status} /></span>
        </div>
        {b.status !== 'committed' && <Alert kind="warn">この取込は確定していません（途中で中止）。ここまでに登録された行は残っています。同じ CSV をもう一度取り込むと、続きが登録されます。</Alert>}
        <div className="flex flex-wrap gap-2" role="group" aria-label="区分">
          {(['new', 'updated', 'unchanged', 'review', 'error'] as ImportKind[]).map((k) => (
            <button key={k} type="button" onClick={() => setPicked(k)} aria-pressed={kind === k}
              className={`rounded-lg border px-3 py-1.5 text-sm ${kind === k ? 'border-slate-900 bg-slate-900 font-bold text-white' : 'border-slate-300 bg-white'}`}>
              {IMPORT_KIND_LABELS[k]} {count[k]}
            </button>
          ))}
          <Button size="sm" className="ml-auto" onClick={saveRows} disabled={!items.length}>表示中の一覧を CSV で保存</Button>
        </div>
        {rows.error && <Alert kind="error">{rows.error}</Alert>}
        {!rows.data ? <Loading /> : (
          <div className="card overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>行</th><th>グローバル番号</th><th>{kind === 'updated' ? '変更前 → 変更後' : '理由'}</th></tr></thead>
              <tbody>
                {items.length === 0 && <tr><td colSpan={3} className="py-8 text-center text-slate-500">「{IMPORT_KIND_LABELS[kind]}」の行はありません。</td></tr>}
                {items.map((r) => (
                  <tr key={r.line_no}>
                    <td className="text-slate-500">{r.line_no}</td><td className="mono">{r.global_no ?? '—'}</td>
                    <td className="text-xs">{kind === 'updated' && r.diff_json ? Object.entries(JSON.parse(r.diff_json) as Record<string, [unknown, unknown]>).map(([f, [a, c]]) => <span key={f} className="mr-3 inline-block">{FIELD_LABELS[f as keyof typeof FIELD_LABELS] ?? f}: <del className="text-red-700">{String(a ?? '')}</del> → <b className="text-green-700">{String(c ?? '')}</b></span>) : r.message ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {nextAfter && <div className="border-t border-slate-100 p-2 text-center"><Button onClick={() => void more()}>さらに表示</Button></div>}
          </div>
        )}
      </div>
    </>
  );
}
