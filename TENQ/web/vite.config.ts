import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// 本番は space-apps.pages.dev/TENQ/app/ で配信する（docs/architecture.md §6）。
// ビルド成果物は TENQ/app/ に出し、Pages はビルドなしでそのまま配信する。

const HALSPACE_API = 'https://halspace-api-production.up.railway.app';

/**
 * Content-Security-Policy をビルドした index.html に入れる（docs/security.md §4）。
 * 共有の Pages（space-apps）の設定ファイルには手を加えず、TENQ の画面だけに効かせるため meta で入れる。
 * 開発サーバーでは React の開発用スクリプトがインラインで動くので入れない。
 */
function csp(apiBase: string): Plugin {
  const apiOrigin = apiBase ? new URL(apiBase).origin : '';
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "media-src 'self' blob:",
    `connect-src 'self' ${apiOrigin} ${HALSPACE_API}`.trim(),
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
  return {
    name: 'tenq-csp',
    apply: 'build',
    transformIndexHtml: (html) => html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`),
  };
}

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), 'VITE_'), ...process.env };
  return {
    base: '/TENQ/app/',
    plugins: [react(), csp(env.VITE_TENQ_API ?? '')],
    build: {
      outDir: '../app',
      emptyOutDir: true,
      sourcemap: false,
      chunkSizeWarningLimit: 250, // React 本体だけで約 220kB（gzip 約 70KiB）。初回 JS の目標は check:size が gzip で見る
    },
  };
});
