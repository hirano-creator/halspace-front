// 打刻用QRコードの生成

import crypto from "crypto";
import QRCode from "qrcode";

/** QRコードの種類: attend=出勤・退勤用 / outing=外出・戻り用（なし=従来の全ボタン用） */
export type QrKind = "attend" | "outing";

export const QR_KIND_LABELS: Record<QrKind, string> = {
  attend: "出勤・退勤",
  outing: "外出・戻り",
};

/** クエリ値を QrKind に検証する（不正値は null = 種類なし扱い） */
export function toQrKind(value: unknown): QrKind | null {
  return value === "attend" || value === "outing" ? value : null;
}

/** 打刻画面のURLを組み立てる（部署IDをクエリに埋め込む。tokenを渡すと日替わりトークン付きURLになる） */
export function buildClockUrl(
  baseUrl: string,
  departmentId: string,
  token?: string,
  kind?: QrKind,
): string {
  let url = `${baseUrl.replace(/\/$/, "")}/clock?dept=${encodeURIComponent(departmentId)}`;
  if (kind) url += `&kind=${kind}`;
  if (token) url += `&token=${encodeURIComponent(token)}`;
  return url;
}

/** URLからQRコードのdata URL（PNG）を生成する */
export async function generateQrDataUrl(url: string): Promise<string> {
  return QRCode.toDataURL(url, { width: 320, margin: 2 });
}

/** キオスク表示ページ（/qr/[kioskKey]）用の秘密キーを生成する（32文字hex） */
export function generateKioskKey(): string {
  return crypto.randomBytes(16).toString("hex");
}

/** キオスク表示ページのURLを組み立てる */
export function buildKioskUrl(baseUrl: string, kioskKey: string): string {
  return `${baseUrl.replace(/\/$/, "")}/qr/${kioskKey}`;
}

function getQrSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("環境変数 SESSION_SECRET が設定されていません");
  }
  return secret;
}

/**
 * 部署ID・日付（"YYYY-MM-DD"）から当日限り有効なQRトークンを生成する。
 * 日付が変わると別の値になるため、印刷されたQRコードや保存されたURLを翌日以降に使い回せなくなる。
 */
export function dailyQrToken(departmentId: string, date: string): string {
  return crypto
    .createHmac("sha256", getQrSecret())
    .update(`${departmentId}:${date}`)
    .digest("hex")
    .slice(0, 16);
}
