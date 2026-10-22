import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 本番は space-apps.pages.dev/TENQ/app/ で配信する（docs/architecture.md §6）。
// ビルド成果物は TENQ/app/ に出し、Pages はビルドなしでそのまま配信する。
export default defineConfig({
  base: '/TENQ/app/',
  plugins: [react()],
  build: {
    outDir: '../app',
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 250, // React 本体だけで約 220kB（gzip 約 70KiB）。初回 JS の目標は check:size が gzip で見る
  },
});
