// ローカル D1 を作り直す（マイグレーション → ダミーデータ）。ローカル専用。リモートには触れない。
import { rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const apiDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'api');
rmSync(join(apiDir, '.wrangler', 'state', 'v3', 'd1'), { recursive: true, force: true });
const run = (cmd) => execSync(cmd, { cwd: apiDir, stdio: 'inherit' });
run('npx wrangler d1 migrations apply DB --local --env dev');
run('npx wrangler d1 execute DB --local --env dev --file=seed/dev-seed.sql');
console.log('ローカル D1 を作り直しました。');
