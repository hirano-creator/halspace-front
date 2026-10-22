// 実機確認用のプレビュー（https://tenq-dev.pages.dev/TENQ/app/）へ画面を出す。本番（space-apps）には触れない。
// 開発用 API（tenq-api-dev）に向け、開発用の簡易ログインを有効にしてビルドする。
// TENQ/app/（本番用のビルド成果物）は書き換えず、一時フォルダに組み立ててから送る。
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const site = join(tmpdir(), 'tenq-preview-site');
rmSync(site, { recursive: true, force: true });
mkdirSync(join(site, 'TENQ'), { recursive: true });

execSync(`npx vite build --outDir "${join(site, 'TENQ', 'app')}" --emptyOutDir`, {
  cwd: join(root, 'web'),
  stdio: 'inherit',
  env: { ...process.env, VITE_TENQ_API: 'https://tenq-api-dev.space-app.workers.dev/api', VITE_DEV_LOGIN: '1' },
});
cpSync(join(root, 'q'), join(site, 'TENQ', 'q'), { recursive: true });
// ルートを開いたらアプリへ案内する
cpSync(join(root, 'scripts', 'preview-index.html'), join(site, 'index.html'));
// 開発用（ダミーデータ・簡易ログインあり）なので検索エンジンに載せない
writeFileSync(join(site, '_headers'), [
  '/*',
  '  X-Robots-Tag: noindex, nofollow',
  '  X-Frame-Options: DENY',
  '  Referrer-Policy: same-origin',
  '',
].join('\n'));

execSync(`npx wrangler pages deploy "${site}" --project-name tenq-dev --branch main --commit-dirty=true`, { cwd: site, stdio: 'inherit' });
console.log('\nプレビュー: https://tenq-dev.pages.dev/TENQ/app/');
