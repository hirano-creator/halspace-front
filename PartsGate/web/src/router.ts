import { useEffect, useState } from 'react';

/**
 * ハッシュ方式のルーター（#/equipment/xxx）。共有の Pages は SPA のフォールバックを持たないため。
 * ルートの定義は App.tsx にまとめる。
 */

export function currentPath(): string {
  const h = location.hash.replace(/^#/, '');
  return h.startsWith('/') ? h.split('?')[0] ?? '/' : '/';
}

export function currentQuery(): URLSearchParams {
  const h = location.hash;
  const i = h.indexOf('?');
  return new URLSearchParams(i >= 0 ? h.slice(i + 1) : '');
}

export function navigate(to: string, replace = false): void {
  const url = `#${to}`;
  if (replace) location.replace(url); else location.hash = to;
}

export function usePath(): string {
  const [path, setPath] = useState(currentPath);
  useEffect(() => {
    const on = () => { setPath(currentPath()); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return path;
}

/** "/equipment/:id" のようなパターンに合えば params を返す */
export function match(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split('/');
  const a = path.split('/');
  if (p.length !== a.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    const seg = p[i] ?? '';
    const val = a[i] ?? '';
    if (seg.startsWith(':')) params[seg.slice(1)] = decodeURIComponent(val);
    else if (seg !== val) return null;
  }
  return params;
}
