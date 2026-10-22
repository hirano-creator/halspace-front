/** QR の中身（https://space-apps.pages.dev/TENQ/q/#<トークン>）から TENQ のトークンを取り出す。TENQ の QR でなければ null */
const TOKEN_IN_URL = /\/TENQ\/q\/?#([A-Za-z2-7]{16})\s*$/;

export function tokenFromQr(text: string): string | null {
  const m = TOKEN_IN_URL.exec(text.trim());
  return m?.[1] ? m[1].toUpperCase() : null;
}
