/**
 * 作業セッション（担当者を選んだ状態）と端末の情報（docs/scan-matching.md §2）。
 *  - 作業セッションは**画面のメモリにだけ**持つ。sessionStorage にも保存しない（画面の再読み込み・再ログインで選び直す）
 *  - 端末の識別子と PC の名前は localStorage（この PC の便利のためだけ。消えても困らない）
 */

export interface WorkSession { id: number; staff: { id: number; name: string; code: string } }

let current: WorkSession | null = null;
const listeners = new Set<() => void>();

export function getWorkSession(): WorkSession | null { return current; }
export function setWorkSession(s: WorkSession | null): void {
  current = s;
  listeners.forEach((f) => f());
}
export function subscribeWorkSession(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

const DEVICE_ID = 'pg_device_id';
const DEVICE_LABEL = 'pg_device_label';

function ls(key: string, value?: string): string | null {
  try {
    if (value !== undefined) localStorage.setItem(key, value);
    return localStorage.getItem(key);
  } catch { return value ?? null; }
}

let memoryDeviceId: string | null = null;
/** この端末の識別子（記録の「使用端末」）。保存できないブラウザでは、開いている間だけの値 */
export function deviceId(): string {
  const saved = ls(DEVICE_ID);
  if (saved && /^[A-Za-z0-9_-]{8,64}$/.test(saved)) return saved;
  const id = memoryDeviceId ?? crypto.randomUUID().replace(/-/g, '');
  memoryDeviceId = id;
  ls(DEVICE_ID, id);
  return id;
}
export function deviceLabel(): string { return ls(DEVICE_LABEL) ?? ''; }
export function setDeviceLabel(v: string): void { ls(DEVICE_LABEL, v.trim().slice(0, 50)); }
