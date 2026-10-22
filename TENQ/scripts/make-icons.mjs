// ロゴ（SVG）からホーム画面用のアイコン PNG を作る（開発用。成果物は web/public/icons/ にコミットする）。
// 端末が丸や角丸に切り抜いても欠けないよう、白地の中央にロゴを約 64% の大きさで置く。
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'public', 'icons');
const svg = (size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">
  <rect width="100" height="100" fill="#ffffff"/>
  <g transform="translate(18 18) scale(2)">
    <rect x="3" y="3" width="26" height="26" rx="6" fill="none" stroke="#1F5FD1" stroke-width="3"/>
    <path d="M9.5 16.5l4.5 4.5 8.5-9.5" fill="none" stroke="#1F5FD1" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M22 22.5l4 4" stroke="#1F5FD1" stroke-width="3" stroke-linecap="round"/>
  </g>
</svg>`;

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0">${svg(size)}</body></html>`);
  await page.screenshot({ path: join(out, name), clip: { x: 0, y: 0, width: size, height: size } });
  console.log('wrote', name);
}
await browser.close();
