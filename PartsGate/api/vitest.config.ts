import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';

// API のテストは Workers ランタイム（Miniflare）の中で、ローカルの D1 を使って実行する。
// 本番・開発リモートの D1 には一切触れない。
export default defineConfig(async () => {
  const migrations = await readD1Migrations(fileURLToPath(new URL('./migrations', import.meta.url)));
  const seedSql = readFileSync(new URL('./seed/dev-seed.sql', import.meta.url), 'utf8');
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.toml', environment: 'dev' },
        miniflare: { bindings: { TEST_MIGRATIONS: migrations, TEST_SEED_SQL: seedSql } },
      }),
    ],
    test: { setupFiles: ['./test/setup.ts'] },
  };
});
