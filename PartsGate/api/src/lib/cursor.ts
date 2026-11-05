import { HttpError } from './http';

/** キーセットページングの位置（値の組を base64url の JSON にする） */
export function encodeCursor(values: string[]): string {
  const bytes = new TextEncoder().encode(JSON.stringify(values));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeCursor(cursor: string, size: number): string[] {
  try {
    const bin = atob(cursor.replace(/-/g, '+').replace(/_/g, '/'));
    const v: unknown = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0))));
    if (Array.isArray(v) && v.length === size && v.every((x) => typeof x === 'string')) return v as string[];
  } catch { /* 下で 400 */ }
  throw new HttpError(400, 'ページの指定が正しくありません。');
}
