// デプロイ前のサイズ確認（docs/deployment.md §3・§6）
//  - Worker の非圧縮バンドル: 1 MiB 以内（社内目標）。2 MiB を超えたら原因を記録してから進める
//  - 画面の初回 JS（gzip）: 200 KiB 以内
import { execSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const KiB = 1024, MiB = 1024 * 1024;
let failed = false;

// ---- Worker ----
const out = execSync('npx wrangler deploy --dry-run --outdir dist --env production', { cwd: join(root, 'api'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const m = /Total Upload:\s*([\d.]+)\s*KiB\s*\/\s*gzip:\s*([\d.]+)\s*KiB/.exec(out);
if (!m) { console.error('wrangler の出力からサイズを読み取れませんでした:\n' + out); process.exit(1); }
const workerKiB = Number(m[1]);
const workerBytes = workerKiB * KiB;
console.log(`Worker  非圧縮 ${workerKiB.toFixed(2)} KiB / gzip ${Number(m[2]).toFixed(2)} KiB（目標 1024 KiB 以内）`);
if (workerBytes > 2 * MiB) { console.error('  ✗ 2 MiB を超えています。原因を調べて docs/deployment.md §6 に記録してください。'); failed = true; }
else if (workerBytes > MiB) { console.error('  ✗ 社内目標の 1 MiB を超えています。'); failed = true; }
else console.log('  ✓ 目標内');

// ---- 画面 ----
const assets = join(root, 'app', 'assets');
if (!existsSync(assets)) {
  console.log('画面    ビルド成果物がありません（npm run build を先に実行）');
} else {
  const html = readFileSync(join(root, 'app', 'index.html'), 'utf8');
  const entry = [...html.matchAll(/src="[^"]*\/assets\/([^"]+\.js)"/g)].map((x) => x[1]);
  const preload = [...html.matchAll(/href="[^"]*\/assets\/([^"]+\.js)"/g)].map((x) => x[1]);
  const initial = [...new Set([...entry, ...preload])];
  const gz = initial.reduce((s, f) => s + gzipSync(readFileSync(join(assets, f))).length, 0);
  const all = readdirSync(assets).filter((f) => f.endsWith('.js')).reduce((s, f) => s + statSync(join(assets, f)).size, 0);
  console.log(`画面    初回 JS gzip ${(gz / KiB).toFixed(2)} KiB（目標 200 KiB 以内）・JS 合計 ${(all / KiB).toFixed(2)} KiB`);
  if (gz > 200 * KiB) { console.error('  ✗ 初回 JS が目標を超えています。画面の分割を見直してください。'); failed = true; }
  else console.log('  ✓ 目標内');
}
process.exit(failed ? 1 : 0);
