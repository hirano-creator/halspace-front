import { useRef, useState, type DragEvent, type ReactNode } from 'react';
import { FIELD_LABELS, IMPORT_KIND_LABELS, type ImportKind } from '@partsgate/shared';
import { apiGet, apiSend, type Page } from '../api/client';
import { Alert, Button, Dialog, Field, PageHeader, errorMessage, fieldErrors, fmtDateTime, useLoad } from '../components/ui';
import { ImportFileError, abortImport, preview, readFile, register, type ParsedFile, type Preview, type PreviewRow, type RegisterResult } from '../import/importer';
import { navigate } from '../router';

/**
 * CSV 取込（docs/csv-import.md、モック _mock-import-analytics.html）。
 * 「① ファイルを選ぶ → ② 内容を確かめる → ③ 登録」。② までは DB に何も書かない。
 */

type Step =
  | { s: 1 }
  | { s: 2; file: ParsedFile; pv: Preview }
  | { s: 3; file: ParsedFile; batchId: number | null; done: number; result: RegisterResult | null; error: string | null };

const KIND_STYLE: Record<ImportKind, { icon: string; color: string; desc: string }> = {
  new: { icon: '＋', color: 'text-blue-700', desc: '新しく登録する' },
  updated: { icon: '✎', color: 'text-violet-700', desc: '内容が変わった' },
  unchanged: { icon: '＝', color: 'text-slate-500', desc: '登録済みと同じ' },
  review: { icon: '⚠', color: 'text-amber-700', desc: '取り込まない（確認が必要）' },
  error: { icon: '✖', color: 'text-red-700', desc: '取り込めない' },
};
const KINDS: ImportKind[] = ['new', 'updated', 'unchanged', 'review', 'error'];

export function ImportPage() {
  const [step, setStep] = useState<Step>({ s: 1 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = async (f: File) => {
    setBusy(true); setError(null);
    try {
      const file = await readFile(f);
      setStep({ s: 2, file, pv: await preview(file) });
    } catch (e) {
      setError(e instanceof ImportFileError ? e.message : errorMessage(e));
    } finally { setBusy(false); }
  };

  const recheck = async () => {
    if (step.s !== 2) return;
    setBusy(true); setError(null);
    try { setStep({ ...step, pv: await preview(step.file) }); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };

  /** 登録する。止まったあとの「もう一度登録する」は、同じ取込回の続きから送り直す */
  const doRegister = async (file: ParsedFile, resumeId: number | null) => {
    setStep({ s: 3, file, batchId: resumeId, done: 0, result: null, error: null });
    try {
      const result = await register(file,
        (done) => setStep((x) => (x.s === 3 ? { ...x, done } : x)),
        resumeId,
        (batchId) => setStep((x) => (x.s === 3 ? { ...x, batchId } : x)));
      setStep((x) => (x.s === 3 ? { ...x, done: file.rows.length, result } : x));
    } catch (e) {
      setStep((x) => (x.s === 3 ? { ...x, error: errorMessage(e) } : x));
    }
  };

  /** 止まった取込をやめて最初に戻る（取込回は中止にする。登録済みの行は残る） */
  const backAfterError = async () => {
    if (step.s === 3 && step.batchId && !step.result) { try { await abortImport(step.batchId); } catch { /* 30 分で自動的に中止になる */ } }
    setStep({ s: 1 });
  };

  return (
    <>
      <PageHeader title="CSV 取込" sub="ミスミの出荷指示 CSV を取り込みます" actions={<Button onClick={() => navigate('/imports')}>取込履歴</Button>} />
      <Steps current={step.s} done={step.s === 3 && !!step.result} />
      <div className="flex flex-col gap-3.5 p-4 lg:p-5">
        {error && <Alert kind="error">{error}</Alert>}
        {step.s === 1 && <SelectFile busy={busy} onFile={open} />}
        {step.s === 2 && <Review file={step.file} pv={step.pv} busy={busy} onRecheck={recheck} onCancel={() => setStep({ s: 1 })} onRegister={() => void doRegister(step.file, null)} />}
        {step.s === 3 && <Progress step={step} onRetry={() => void doRegister(step.file, step.batchId)} onBack={() => void backAfterError()} />}
      </div>
    </>
  );
}

function Steps({ current, done }: { current: number; done: boolean }) {
  const labels = ['ファイルを選ぶ', '内容を確かめる', '登録'];
  return (
    <ol className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-5 py-3 text-sm font-bold">
      {labels.map((l, i) => {
        const n = i + 1;
        const state = n < current || (n === 3 && done) ? 'done' : n === current ? 'cur' : 'todo';
        return (
          <li key={l} className={`flex items-center gap-2 ${state === 'todo' ? 'text-slate-400' : state === 'done' ? 'text-green-700' : 'text-slate-900'}`} aria-current={state === 'cur' ? 'step' : undefined}>
            <span className={`flex h-6 w-6 items-center justify-center rounded-full border-2 text-xs ${state === 'done' ? 'border-green-700 bg-green-700 text-white' : state === 'cur' ? 'border-slate-900 bg-slate-900 text-white' : 'border-current'}`}>{state === 'done' ? '✓' : n}</span>
            {l}{n < 3 && <span className="mx-2 hidden h-0.5 w-16 bg-slate-200 sm:block" aria-hidden="true" />}
          </li>
        );
      })}
    </ol>
  );
}

// ---------- ① ファイルを選ぶ ----------
interface BatchRow { id: number; file_name: string; status: string; row_new: number; row_updated: number; row_review: number; row_error: number; created_at: string; created_by_name: string | null }

function SelectFile({ busy, onFile }: { busy: boolean; onFile: (f: File) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const recent = useLoad(() => apiGet<Page<BatchRow>>('/imports?limit=5'), []);
  const drop = (e: DragEvent) => {
    e.preventDefault(); setOver(false);
    const f = e.dataTransfer.files[0];
    if (f) onFile(f);
  };
  return (
    <>
      <div role="button" tabIndex={0} onClick={() => input.current?.click()} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') input.current?.click(); }}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={drop}
        className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed bg-white px-6 py-14 text-center ${over ? 'border-slate-700 bg-slate-50' : 'border-slate-400'}`}>
        <span className="text-5xl leading-none" aria-hidden="true">⇪</span>
        <b className="text-lg">{busy ? 'ファイルを確認しています…' : 'ここに CSV ファイルをドラッグ'}</b>
        <span className="text-sm text-slate-500">または <span className="btn btn-sm mx-1">ファイルを選ぶ</span>（.csv・10MB まで・Shift-JIS / UTF-8）</span>
        <input ref={input} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onFile(f); }} />
      </div>
      <div className="card p-4">
        <b className="text-sm">最近の取込</b>
        {recent.error && <Alert kind="error">{recent.error}</Alert>}
        <div className="mt-2 overflow-x-auto">
          <table className="tbl">
            <thead><tr><th>取込日時</th><th>ファイル名</th><th>担当</th><th className="text-right">新規</th><th className="text-right">更新</th><th className="text-right">要確認</th><th className="text-right">エラー</th><th>状態</th></tr></thead>
            <tbody>
              {recent.data?.items.length === 0 && <tr><td colSpan={8} className="py-6 text-center text-slate-500">まだ取り込んでいません。</td></tr>}
              {recent.data?.items.map((b) => (
                <tr key={b.id} className="row-click" onClick={() => navigate(`/imports/${b.id}`)}>
                  <td className="whitespace-nowrap">{fmtDateTime(b.created_at)}</td><td className="mono text-xs">{b.file_name}</td><td>{b.created_by_name ?? '—'}</td>
                  <td className="text-right">{b.row_new}</td><td className="text-right">{b.row_updated}</td><td className="text-right">{b.row_review}</td><td className="text-right">{b.row_error}</td>
                  <td><BatchStatus status={b.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

export function BatchStatus({ status }: { status: string }) {
  if (status === 'committed') return <span className="pill pill-ok">✔ 完了</span>;
  if (status === 'uploading') return <span className="pill pill-info">登録中</span>;
  return <span className="pill pill-gray">中止</span>;
}

// ---------- ② 内容を確かめる ----------
function Review({ file, pv, busy, onRecheck, onCancel, onRegister }: { file: ParsedFile; pv: Preview; busy: boolean; onRecheck: () => void; onCancel: () => void; onRegister: () => void }) {
  const firstKind: ImportKind = pv.counts.review || pv.unknownDestinations.length ? 'review' : pv.counts.error ? 'error' : pv.counts.updated ? 'updated' : 'new';
  const [kind, setKind] = useState<ImportKind>(firstKind);
  const [locDialog, setLocDialog] = useState<string | null>(null);
  const [destMsg, setDestMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const willImport = pv.counts.new + pv.counts.updated;
  const rows = pv.rows.filter((r) => r.kind === kind);

  const registerDestinations = async () => {
    setDestMsg(null);
    try {
      const r = await apiSend<{ created: number }>('POST', '/destinations/bulk', { items: pv.unknownDestinations.map((d) => ({ customer_code: d.customer_code, code: d.code, name: d.name })) });
      setDestMsg({ kind: 'success', text: `納品先を ${r.created} 件登録しました。` });
      onRecheck();
    } catch (e) { setDestMsg({ kind: 'error', text: errorMessage(e) }); }
  };

  return (
    <>
      <div className="card flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <Info label="ファイル"><span className="mono">{file.name}</span></Info>
        <Info label="文字コード">{file.encoding === 'shift_jis' ? 'Shift-JIS' : 'UTF-8'}（自動判定）</Info>
        <Info label="行数">{file.rows.length.toLocaleString()} 行・{file.columnCount} 列</Info>
        <Info label="ミスミ納期">{file.vrds.length ? file.vrds.slice(0, 3).map((v) => `${v.date.slice(5).replace('-', '/')}（${v.count}）`).join('・') : '—'}</Info>
        <Button size="sm" className="ml-auto" onClick={onCancel} disabled={busy}>別のファイルを選ぶ</Button>
      </div>
      {pv.duplicateOf && (
        <Alert kind="warn">このファイルは {fmtDateTime(pv.duplicateOf.committed_at)} に{pv.duplicateOf.created_by_name ? ` ${pv.duplicateOf.created_by_name} さんが` : ''}取込済みです。もう一度取り込んでも二重には登録されません（変わっていない行は「変更なし」になります）。</Alert>
      )}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
        {KINDS.map((k) => (
          <button key={k} type="button" onClick={() => setKind(k)} aria-pressed={kind === k}
            className={`rounded-xl border-2 bg-white px-3 py-2.5 text-left ${kind === k ? 'border-slate-900 ring-1 ring-slate-900' : 'border-slate-200 hover:border-slate-400'}`}>
            <span className={`flex items-center gap-1.5 text-xs font-bold ${KIND_STYLE[k].color}`}><span aria-hidden="true">{KIND_STYLE[k].icon}</span>{IMPORT_KIND_LABELS[k]}</span>
            <span className="block text-3xl leading-tight font-extrabold">{pv.counts[k].toLocaleString()}</span>
            <span className="block text-[11px] text-slate-500">{KIND_STYLE[k].desc}</span>
          </button>
        ))}
      </div>

      {/* 納品先を登録すると確認し直して枠が消えるので、結果は枠の外に出す */}
      {destMsg && <Alert kind={destMsg.kind}>{destMsg.text}</Alert>}
      {kind === 'review' && (
        <>
          {pv.unknownLocations.map((l) => (
            <div key={l.code} className="card flex flex-wrap items-center gap-2 border-amber-400 p-3.5">
              <b className="text-amber-800">⚠ 置場 {l.code} が置場マスターにありません（{l.rows} 行）</b>
              <span className="text-xs text-slate-500">登録するまで、この行は取り込みません</span>
              <Button size="sm" variant="primary" className="ml-auto" onClick={() => setLocDialog(l.code)} disabled={busy}>置場 {l.code} を登録する</Button>
            </div>
          ))}
          {pv.unknownDestinations.length > 0 && (
            <div className="card border-amber-400 p-3.5">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <b className="text-amber-800">⚠ 納品先マスターにない納品先（{pv.unknownDestinations.length} 件）</b>
                <span className="text-xs text-slate-500">このまま取り込めます。あとで登録もできます</span>
                <Button size="sm" className="ml-auto" onClick={() => void registerDestinations()} disabled={busy}>{pv.unknownDestinations.length} 件をまとめて登録</Button>
              </div>
              <div className="max-h-56 overflow-auto">
                <table className="tbl">
                  <thead><tr><th>得意先コード</th><th>得意先</th><th>直送先コード</th><th>納品先名</th><th className="text-right">行数</th></tr></thead>
                  <tbody>{pv.unknownDestinations.map((d) => <tr key={`${d.customer_code}-${d.code}`}><td className="mono">{d.customer_code}</td><td>{d.customer_name ?? '—'}</td><td className="mono">{d.code}</td><td>{d.name}</td><td className="text-right">{d.rows}</td></tr>)}</tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
      <RowsTable kind={kind} rows={rows} />

      <div className="card sticky bottom-2 flex flex-wrap items-center gap-3 p-3.5 shadow-lg">
        <p className="text-sm leading-relaxed">
          登録すると: <b>新規 {pv.counts.new} 行を登録</b>・<b>{pv.counts.updated} 行を更新</b>。
          {pv.counts.review + pv.counts.error > 0 && <>要確認の <b className="text-amber-700">{pv.counts.review} 行</b>とエラーの <b className="text-red-700">{pv.counts.error} 行</b>は取り込みません。</>}
          <span className="block text-xs text-slate-500">読み取りの記録は変わりません。元のファイルは保存されます。</span>
        </p>
        <div className="ml-auto flex gap-2">
          <Button onClick={onRecheck} disabled={busy}>↻ もう一度確認する</Button>
          <Button onClick={onCancel} disabled={busy}>やめる</Button>
          <Button variant="primary" onClick={onRegister} disabled={busy || willImport === 0}>{willImport === 0 ? '登録する行がありません' : `${willImport} 行を登録する`}</Button>
        </div>
      </div>
      {locDialog && <LocationDialog code={locDialog} onClose={() => setLocDialog(null)} onSaved={() => { setLocDialog(null); onRecheck(); }} />}
    </>
  );
}

function Info({ label, children }: { label: string; children: ReactNode }) {
  return <div><div className="text-[11px] text-slate-500">{label}</div><div className="text-sm font-bold">{children}</div></div>;
}

const SHOW_MAX = 200;

function RowsTable({ kind, rows }: { kind: ImportKind; rows: PreviewRow[] }) {
  if (rows.length === 0) return <div className="card p-6 text-center text-sm text-slate-500">「{IMPORT_KIND_LABELS[kind]}」の行はありません。</div>;
  const shown = rows.slice(0, SHOW_MAX);
  return (
    <div className="card overflow-x-auto">
      <table className="tbl">
        <thead><tr><th>行</th><th>グローバル番号</th>{kind === 'error' || kind === 'review' ? <><th>理由</th><th>次にすること</th></> : kind === 'updated' ? <th>変更前 → 変更後</th> : <><th>商品コード</th><th className="text-right">数量</th><th>置場</th><th>得意先</th><th>ミスミ納期</th></>}</tr></thead>
        <tbody>
          {shown.map((r) => (
            <tr key={r.line_no}>
              <td className="text-slate-500">{r.line_no}</td>
              <td className="mono">{r.global_no ?? '—'}</td>
              {kind === 'error' || kind === 'review' ? (
                <><td className={kind === 'error' ? 'text-red-800' : 'text-amber-800'}>{r.message}</td><td className="text-xs text-slate-600">{nextAction(r)}</td></>
              ) : kind === 'updated' ? (
                <td className="text-xs">{r.diff.map(([f, a, b]) => <span key={f} className="mr-3 inline-block">{FIELD_LABELS[f as keyof typeof FIELD_LABELS] ?? f}: <del className="text-red-700">{String(a ?? '')}</del> → <b className="text-green-700">{String(b ?? '')}</b></span>)}</td>
              ) : (
                <><td className="mono text-xs">{r.item?.product_code}</td><td className="text-right">{r.item?.quantity}</td><td className="mono">{r.item?.location_code}</td><td>{r.item?.customer_name ?? '—'}</td><td>{r.item?.vrd?.slice(5).replace('-', '/') ?? '—'}</td></>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > SHOW_MAX && <p className="border-t border-slate-100 p-2 text-center text-xs text-slate-500">ほか {rows.length - SHOW_MAX} 行（登録後に取込履歴で全部見られます）</p>}
    </div>
  );
}

function nextAction(r: PreviewRow): string {
  const m = r.message ?? '';
  if (m.includes('置場')) return '上の「置場を登録する」を押してから「もう一度確認する」';
  if (m.includes('照合済み')) return '内容が正しいか確かめ、必要なら管理者が注文データの画面で直す';
  if (m.includes('データ区分')) return 'ミスミに内容を確認する';
  if (m.includes('別の明細')) return 'ラベルの番号と CSV を確かめる';
  return 'ミスミに確認し、直した CSV をもう一度取り込む';
}

function LocationDialog({ code, onClose, onSaved }: { code: string; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true); setError(null); setErrors({});
    try { await apiSend('POST', '/locations', { code, name: name.trim() }); onSaved(); } catch (e) { setErrors(fieldErrors(e)); setError(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <Dialog open title={`置場 ${code} を登録`} onClose={onClose}
      footer={<><Button onClick={onClose} disabled={busy}>やめる</Button><Button variant="primary" onClick={() => void save()} disabled={busy || !name.trim()}>登録して確認し直す</Button></>}>
      {error && <Alert kind="error">{error}</Alert>}
      <Field label="置場コード" hint="CSV に書かれているコードです"><input className="input mono" value={code} readOnly /></Field>
      <Field label="置場名" required error={errors.name}><input className="input" maxLength={50} value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="例: 関西" /></Field>
    </Dialog>
  );
}

// ---------- ③ 登録 ----------
function Progress({ step, onRetry, onBack }: { step: Extract<Step, { s: 3 }>; onRetry: () => void; onBack: () => void }) {
  const total = step.file.rows.length;
  const pct = Math.round((step.done / Math.max(total, 1)) * 100);
  const r = step.result;
  return (
    <div className="card flex flex-col gap-4 p-6">
      <div className="flex items-center gap-3">
        <span className={`text-4xl ${r ? 'text-green-700' : step.error ? 'text-red-700' : 'text-slate-500'}`} aria-hidden="true">{r ? '✔' : step.error ? '✖' : '⟳'}</span>
        <div>
          <b className="text-xl">{r ? '取込が終わりました' : step.error ? '登録が途中で止まりました' : '登録しています…'}</b>
          <p className="text-sm text-slate-500">{r ? `${fmtDateTime(r.committed_at)} ・ 担当：${r.created_by_name ?? ''}` : step.error ? 'ここまで登録した行はそのまま残っています。もう一度押すと、続きから登録します（二重には登録されません）。' : '画面を閉じずにお待ちください'}</p>
        </div>
      </div>
      <div className="h-3.5 overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><div className="h-full bg-green-700 transition-all" style={{ width: `${pct}%` }} /></div>
      <p className="text-right text-xs text-slate-500">{step.done.toLocaleString()} / {total.toLocaleString()} 行</p>
      {step.error && <Alert kind="error">{step.error}</Alert>}
      {r && (
        <div className="grid grid-cols-2 gap-2.5 text-center sm:grid-cols-5">
          {([['新規', r.row_new, 'text-blue-700'], ['更新', r.row_updated, 'text-violet-700'], ['変更なし', r.row_unchanged, 'text-slate-500'], ['取り込まず（要確認）', r.row_review, 'text-amber-700'], ['取り込まず（エラー）', r.row_error, 'text-red-700']] as const).map(([l, v, c]) => (
            <div key={l} className="rounded-xl border border-slate-200 p-3"><div className={`text-xs font-bold ${c}`}>{l}</div><div className="text-2xl font-extrabold">{v}</div></div>
          ))}
        </div>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        {step.error && <><Button onClick={onBack}>最初に戻る</Button><Button variant="primary" onClick={onRetry}>もう一度登録する</Button></>}
        {r && <><Button onClick={onBack}>別のファイルを取り込む</Button><Button variant="primary" onClick={() => navigate(`/imports/${r.id}`)}>取込の詳細を見る →</Button></>}
      </div>
    </div>
  );
}
