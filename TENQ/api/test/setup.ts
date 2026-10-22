import { env } from 'cloudflare:workers';
import { applyD1Migrations } from 'cloudflare:test';

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

// ダミーデータは1回だけ入れる（文の区切りは「; + 改行」。seed にはトリガー定義を書かない）
const loaded = await env.DB.prepare('SELECT COUNT(*) AS n FROM factories').first<{ n: number }>();
if (!loaded?.n) {
  const body = env.TEST_SEED_SQL.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  const statements = body.split(/;\s*\n/).map((s) => s.trim()).filter(Boolean);
  for (const sql of statements) await env.DB.prepare(sql).run();
}
