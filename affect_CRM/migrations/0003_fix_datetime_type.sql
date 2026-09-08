-- affect CRM: 日時カラムの型を Prisma の書式（ISO 8601 文字列）に揃える
--
-- 背景:
--   初期シードで日時を epoch ミリ秒（INTEGER）で入れていたが、Prisma(D1) は
--   DateTime を ISO 8601 文字列で読み書きする。同じ列に数値と文字列が混在すると
--   読み取り時に「expected a either an i64 or a f64」で 500 になる。
--   （実際に /api/staff が 500 になった）
--
-- 実行方法:
--   npx wrangler d1 execute affect-crm --local  --file migrations/0003_fix_datetime_type.sql
--   npx wrangler d1 execute affect-crm --remote --file migrations/0003_fix_datetime_type.sql

UPDATE "Staff"
SET "createdAt" = strftime('%Y-%m-%dT%H:%M:%f', "createdAt" / 1000.0, 'unixepoch') || '+00:00',
    "updatedAt" = strftime('%Y-%m-%dT%H:%M:%f', "updatedAt" / 1000.0, 'unixepoch') || '+00:00'
WHERE typeof("createdAt") = 'integer';

UPDATE "MasterOption"
SET "createdAt" = strftime('%Y-%m-%dT%H:%M:%f', "createdAt" / 1000.0, 'unixepoch') || '+00:00',
    "updatedAt" = strftime('%Y-%m-%dT%H:%M:%f', "updatedAt" / 1000.0, 'unixepoch') || '+00:00'
WHERE typeof("createdAt") = 'integer';

UPDATE "Tag"
SET "createdAt" = strftime('%Y-%m-%dT%H:%M:%f', "createdAt" / 1000.0, 'unixepoch') || '+00:00'
WHERE typeof("createdAt") = 'integer';

UPDATE "Setting"
SET "updatedAt" = strftime('%Y-%m-%dT%H:%M:%f', "updatedAt" / 1000.0, 'unixepoch') || '+00:00'
WHERE typeof("updatedAt") = 'integer';
