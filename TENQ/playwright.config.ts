import { defineConfig, devices } from '@playwright/test';

// E2E は画面（Vite）と API（wrangler dev・ローカル D1）を起動して行う。テストデータはダミーのみ。
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: { baseURL: 'http://localhost:5173/TENQ/app/', serviceWorkers: 'block' },
  projects: [
    { name: 'pc', use: { ...devices['Desktop Chrome'] } },
    { name: 'phone', use: { ...devices['Pixel 7'] } },
  ],
  webServer: [
    { command: 'npm run dev -w api', url: 'http://127.0.0.1:8787/api/health', reuseExistingServer: true, timeout: 60_000 },
    { command: 'npm run dev -w web', url: 'http://localhost:5173/TENQ/app/', reuseExistingServer: true, timeout: 60_000 },
  ],
});
