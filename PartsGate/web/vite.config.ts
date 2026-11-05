import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// 本番は space-apps.pages.dev/PartsGate/app/ で配信する（docs/architecture.md §5）。
// ビルド成果物は PartsGate/app/ に出し、Pages はビルドなしでそのまま配信する。

const HALSPACE_API = 'https://halspace-api-production.up.railway.app';

/**
 * Content-Security-Policy をビルドした index.html に入れる（TENQ と同じ方法）。
 * 共有の Pages の設定ファイルには手を加えず、PARTS GATE の画面だけに効かせるため meta で入れる。
 */
function csp(apiBase: string): Plugin {
  const apiOrigin = apiBase ? new URL(apiBase).origin : '';
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    `connect-src 'self' ${apiOrigin} ${HALSPACE_API}`.trim(),
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
  return {
    name: 'partsgate-csp',
    apply: 'build',
    transformIndexHtml: (html) => html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`),
  };
}

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), 'VITE_'), ...process.env };
  return {
    base: '/PartsGate/app/',
    plugins: [react(), tailwindcss(), csp(env.VITE_PG_API ?? '')],
    build: {
      outDir: '../app',
      emptyOutDir: true,
      sourcemap: false,
      chunkSizeWarningLimit: 250,
    },
  };
});
