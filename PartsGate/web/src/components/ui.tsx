import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { ApiError } from '../api/client';

/** 小さな共通部品。UI ライブラリは使わない（画面の容量を抑えるため） */

export function Button({ variant = 'secondary', size, className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'ghost'; size?: 'sm' }) {
  return <button type="button" className={`btn ${variant !== 'secondary' ? `btn-${variant}` : ''} ${size === 'sm' ? 'btn-sm' : ''} ${className}`} {...rest} />;
}

export function Field({ label, error, hint, required, children, className = '' }: { label: string; error?: string; hint?: string; required?: boolean; children: ReactNode; className?: string }) {
  return (
    <label className={`field ${className}`}>
      <span className="field-label">{label}{required && <span className="field-req">必須</span>}</span>
      {children}
      {hint && !error && <span className="field-hint">{hint}</span>}
      {error && <span className="field-error" role="alert">{error}</span>}
    </label>
  );
}

export function Alert({ kind = 'info', children }: { kind?: 'info' | 'error' | 'success' | 'warn'; children: ReactNode }) {
  return <div className={`alert alert-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>{children}</div>;
}

export function Loading({ label = '読み込んでいます…' }: { label?: string }) {
  return <p className="p-6 text-sm text-slate-500" aria-live="polite">{label}</p>;
}

export function PageHeader({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-5 py-3.5">
      <div className="min-w-0">
        <h1 className="text-lg font-bold">{title}</h1>
        {sub && <p className="text-xs text-slate-500">{sub}</p>}
      </div>
      {actions && <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : '処理に失敗しました。';
}
export function fieldErrors(e: unknown): Record<string, string> {
  return e instanceof ApiError ? e.errors : {};
}

/** 読み込みの状態をまとめて持つ。deps が変わると読み直す（読み直している間も前回のデータは残す） */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[]): { data: T | null; error: string | null; loading: boolean; reload: () => void } {
  const [tick, setTick] = useState(0);
  const key = JSON.stringify([...deps, tick]);
  const [state, setState] = useState<{ key: string | null; data: T | null; error: string | null }>({ key: null, data: null, error: null });
  useEffect(() => {
    let alive = true;
    load().then((d) => { if (alive) setState({ key, data: d, error: null }); })
      .catch((e: unknown) => { if (alive) setState((s) => ({ key, data: s.data, error: errorMessage(e) })); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return { data: state.data, error: state.error, loading: state.key !== key, reload: () => setTick((t) => t + 1) };
}

/** モーダルの枠（<dialog> を使う。Esc で閉じる） */
export function Dialog({ open, title, onClose, children, footer }: { open: boolean; title: string; onClose: () => void; children: ReactNode; footer: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="dialog" onClose={onClose} onCancel={onClose} aria-labelledby="dialog-title">
      <div className="border-b border-slate-200 px-5 py-3.5"><h2 id="dialog-title" className="text-base font-bold">{title}</h2></div>
      <div className="flex flex-col gap-3.5 px-5 py-4">{children}</div>
      <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">{footer}</div>
    </dialog>
  );
}

export function StatusPill({ status }: { status: string }) {
  if (status === 'active') return <span className="pill pill-ok">● 利用中</span>;
  if (status === 'inactive' || status === 'suspended') return <span className="pill pill-gray">○ 停止中</span>;
  return <span className="pill pill-gray">{status}</span>;
}

/** 日時（UTC の ISO）を日本時間で表示する */
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(Date.parse(iso) + 9 * 3_600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}/${p(d.getUTCMonth() + 1)}/${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}
