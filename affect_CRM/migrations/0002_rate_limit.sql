-- affect CRM: 公開予約のレート制限テーブルを追加
--
-- 実行方法:
--   npx wrangler d1 execute affect-crm --local  --file migrations/0002_rate_limit.sql
--   npx wrangler d1 execute affect-crm --remote --file migrations/0002_rate_limit.sql

CREATE TABLE "RateLimit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "RateLimit_key_createdAt_idx" ON "RateLimit"("key", "createdAt");
