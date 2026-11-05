import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';

// API のテストは Workers ランタイム（Miniflare）の中で、ローカルの D1 を使って実行する。
// 本番・開発リモートの D1 には一切触れない。
export default defineConfig(async () => {
  const migrations = await readD1Migrations(fileURLToPath(new URL('./migrations', import.meta.url)));
  const seedSql = readFileSync(new URL('./seed/dev-seed.sql', import.meta.url), 'utf8');
  // 復元のテスト用（数え上げのトリガーを作り直すのに、すべてのマイグレーションの原文を順につなげて使う）
  const initSql = migrations.flatMap((m) => m.queries).join(';\n');
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.toml', environment: 'dev' },
        // RESTORE_DB: バックアップから復元する先（テスト専用の空の D1）
        miniflare: { bindings: { TEST_MIGRATIONS: migrations, TEST_SEED_SQL: seedSql, TEST_INIT_SQL: initSql }, d1Databases: ['RESTORE_DB'] },
      }),
    ],
    test: { setupFiles: ['./test/setup.ts'] },
  };
});
