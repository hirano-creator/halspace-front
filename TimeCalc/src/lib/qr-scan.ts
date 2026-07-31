// アプリ内カメラで読み取ったQR文字列の解釈（クライアントから安全にimportできる純関数群）
//
// src/lib/qr.ts はQR「生成」側（node の crypto に依存）のためクライアントから直接importできない。
// こちらは「読み取り」側専用で依存ゼロ。QRの中身（打刻URL）の形式判定だけを行う。

import type { QrKind } from "./qr";

export interface ScannedClockTarget {
  dept: string;
  kind: QrKind | null;
  token: string | null;
}

/** クエリ値を QrKind に検証する（qr.ts の toQrKind と同じ判定をcrypto非依存で複製） */
function toQrKind(value: string | null): QrKind | null {
  return value === "attend" || value === "outing" ? value : null;
}

/**
 * 読み取ったQR文字列をTimeCalcの打刻URLとして解釈する。
 * 自オリジン以外のURLや /clock 以外のパス、dept欠落は対象外（null）として弾く。
 */
export function parseClockQrText(text: string, origin: string): ScannedClockTarget | null {
  let url: URL;
  try {
    url = new URL(text, origin);
  } catch {
    return null;
  }

  if (url.origin !== origin) return null;
  if (url.pathname !== "/clock") return null;

  const dept = url.searchParams.get("dept");
  if (!dept) return null;

  return {
    dept,
    kind: toQrKind(url.searchParams.get("kind")),
    token: url.searchParams.get("token"),
  };
}

/** parseClockQrText の結果から /clock への遷移先パスを組み立てる */
export function buildScannedClockPath(target: ScannedClockTarget): string {
  const qs = new URLSearchParams();
  qs.set("dept", target.dept);
  if (target.kind) qs.set("kind", target.kind);
  if (target.token) qs.set("token", target.token);
  return `/clock?${qs.toString()}`;
}
