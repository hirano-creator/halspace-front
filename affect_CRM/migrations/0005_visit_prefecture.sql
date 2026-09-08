-- affect CRM: 来店記録に「来店エリア（都道府県）」を追加
--
-- 背景: 来店経路・何を見て来たか（集客のきっかけ・媒体）とは別に、
-- 顧客が地理的にどこから来店したか（居住地域）を来店ごとに記録するため。
-- Customer.prefecture（顧客の恒久住所・自由入力）とは別物で、匿名来店にも紐づく。
--
-- 実行方法:
--   npx wrangler d1 execute affect-crm --local  --file migrations/0005_visit_prefecture.sql
--   npx wrangler d1 execute affect-crm --remote --file migrations/0005_visit_prefecture.sql

ALTER TABLE "Visit" ADD COLUMN "prefectureCode" TEXT;
