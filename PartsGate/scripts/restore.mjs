// バックアップ（R2 の NDJSON）から、復元用の SQL ファイルを作る。手順は README の「バックアップと復元」。
//
//   node scripts/restore.mjs --out restore.sql <フォルダ1> <フォルダ2> ...
//
// フォルダは R2 の backups/<日付>/<kind>-<ID>/ をダウンロードしたもので、古い順に並べる（全体 → 差分 → 差分 …）。
// 作った SQL は、マイグレーション済みの空の D1 に `wrangler d1 execute <DB> --file restore.sql` で流す。
// 流す先が本番かどうかはこのスクリプトでは決めない（必ず人が確かめてから流す）。
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TABLES, restoreStatements } from './lib/backup-tables.mjs';

const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const out = outIdx >= 0 ? args[outIdx + 1] : null;
const dirs = args.filter((a, i) => a !== '--out' && i !== outIdx + 1);
if (!out || !dirs.length) {
  console.error('使い方: node scripts/restore.mjs --out restore.sql <全体のフォルダ> [<差分のフォルダ> ...]（古い順）');
  process.exit(1);
}

const backups = [];
for (const dir of dirs) {
  const manifestPath = join(dir, 'manifest.json');
  if (!existsSync(manifestPath)) { console.error(`manifest.json がありません: ${dir}`); process.exit(1); }
  const m = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const data = {};
  for (const t of TABLES) {
    const f = join(dir, `${t.name}.ndjson`);
    data[t.name] = existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
    const expected = m.tables?.[t.name]?.rows ?? 0;
    if (data[t.name].length !== expected) { console.error(`${dir} の ${t.name} の行数が manifest と合いません（${data[t.name].length} / ${expected}）`); process.exit(1); }
  }
  console.log(`${m.kind}  ${m.from_at ?? '（最初）'} 〜 ${m.to_at}  ${Object.values(data).reduce((s, r) => s + r.length, 0)} 行`);
  backups.push(data);
}

// すべてのマイグレーションをつなげて、数え上げのトリガーの最後の定義を使う
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'api', 'migrations');
const migrationSql = readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort().map((f) => readFileSync(join(migDir, f), 'utf8')).join('\n');
const stmts = restoreStatements(backups, migrationSql);
writeFileSync(out, stmts.join('\n') + '\n', 'utf8');
console.log(`\n${out} に ${stmts.length.toLocaleString()} 文を書き出しました。`);
console.log('流す前に、流す先の DB を確かめてください（マイグレーション済みの空の D1 に流す）。');
