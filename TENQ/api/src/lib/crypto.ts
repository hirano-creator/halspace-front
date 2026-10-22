const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export const newId = (): string => crypto.randomUUID();
export const nowIso = (): string => new Date().toISOString();

/** QR トークン: base32 の 16 文字（約 80bit）。秘密ではないが推測しにくくする */
export function newQrToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let s = '';
  for (const b of bytes) s += BASE32[b % 32];
  return s;
}

export const QR_TOKEN_PATTERN = /^[A-Z2-7]{16}$/;

/** 端末のログイン記憶トークン: "tq_" + 256bit を base64url。D1 には SHA-256 だけを保存する */
export function newDeviceToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return 'tq_' + btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
