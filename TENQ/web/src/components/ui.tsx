import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { ApiError } from '../api/client';

/** 小さな共通部品。UI ライブラリは使わない（Workers / 画面の容量を抑えるため） */

export function Button({ variant = 'secondary', className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'ghost' }) {
  return <button type="button" className={`btn btn-${variant} ${className}`} {...rest} />;
}

export function Field({ label, error, hint, required, children }: { label: string; error?: string; hint?: string; required?: boolean; children: ReactNode }) {
  return (
    <label className={`field ${error ? 'has-error' : ''}`}>
      <span className="field-label">{label}{required && <span className="req">必須</span>}</span>
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
  return <p className="loading" aria-live="polite">{label}</p>;
}

export function PageHeader({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-header">
      <div>
        <h1 className="page-title">{title}</h1>
        {sub && <p className="page-sub">{sub}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : '処理に失敗しました。';
}
export function fieldErrors(e: unknown): Record<string, string> {
  return e instanceof ApiError ? e.errors : {};
}

/** 読み込みの状態をまとめて持つ。deps が変わると読み直す */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[]): { data: T | null; error: string | null; loading: boolean; reload: () => void } {
  const [tick, setTick] = useState(0);
  const key = JSON.stringify([...deps, tick]);
  // 読み直している間も前回のデータは残す（通信に失敗しても画面を空にしない）
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

/** 理由の入力つき確認ダイアログ（停止・廃止・再発行など） */
export function ReasonDialog({ open, title, message, confirmLabel, danger, reasonRequired = true, onConfirm, onClose }: {
  open: boolean; title: string; message: ReactNode; confirmLabel: string; danger?: boolean; reasonRequired?: boolean;
  onConfirm: (reason: string) => Promise<void>; onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) { setReason(''); setError(null); d.showModal(); }
    if (!open && d.open) d.close();
  }, [open]);
  const submit = async () => {
    if (reasonRequired && !reason.trim()) { setError('理由を入力してください。'); return; }
    setBusy(true);
    try { await onConfirm(reason.trim()); onClose(); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <dialog ref={ref} className="dialog" onClose={onClose} onCancel={onClose}>
      <h2>{title}</h2>
      <div className="dialog-body">{message}</div>
      <Field label="理由" required={reasonRequired} error={error ?? undefined}>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={200} />
      </Field>
      <div className="dialog-actions">
        <Button onClick={onClose} disabled={busy}>やめる</Button>
        <Button variant={danger ? 'danger' : 'primary'} onClick={submit} disabled={busy}>{busy ? '処理中…' : confirmLabel}</Button>
      </div>
    </dialog>
  );
}
