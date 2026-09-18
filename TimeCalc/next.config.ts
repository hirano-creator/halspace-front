import type { NextConfig } from "next";

/**
 * 全レスポンスに付けるセキュリティヘッダー。
 * 認証トークンを sessionStorage に持つ構成なので、XSS・クリックジャッキング対策は
 * アプリ側で持つ（Cloudflare 中継の有無に依らず Railway 直アクセスでも付く）。
 * - frame-ancestors 'none' / X-Frame-Options: 他サイトの iframe に埋め込ませない（キオスクQR画面も直接表示なので不要）
 * - Permissions-Policy: 打刻のGPSとQR読取のカメラは自サイトだけに許可し、他は閉じる
 * - 本格的な CSP（script-src の nonce）は Next.js のインラインスクリプトと調整が要るので別タスク
 */
const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  {
    key: "Permissions-Policy",
    value: "geolocation=(self), camera=(self), microphone=(), payment=(), usb=()",
  },
];

const nextConfig: NextConfig = {
  // Railway（Docker）で動かすため、実行に必要なファイルだけを .next/standalone に集める
  // （Dockerfile の最終ステージはこのディレクトリと static / public だけをコピーする）。
  output: "standalone",
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
