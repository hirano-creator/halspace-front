-- affect CRM: スタッフにフリガナ（nameKana）を追加
--
-- 背景: 顧客（Customer.nameKana）と同様、五十音順の並べ替え・表記ゆれの識別に使う。
--
-- 実行方法:
--   npx wrangler d1 execute affect-crm --local  --file migrations/0006_staff_kana.sql
--   npx wrangler d1 execute affect-crm --remote --file migrations/0006_staff_kana.sql

ALTER TABLE "Staff" ADD COLUMN "nameKana" TEXT;
