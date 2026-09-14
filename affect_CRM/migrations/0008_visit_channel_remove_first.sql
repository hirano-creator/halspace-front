-- affect CRM: 来店経路(VISIT_CHANNEL)から「初めて」を外す
--
-- 背景: 「初めて」は来店の経路（どこから来たか）ではなく、新規／リピーターの区別。
-- その情報は Visit.isFirstVisit が来店時点の事実として持っているので、経路の選択肢に置く意味がない。
-- 過去の来店に "FIRST" が入っていても表示が壊れないよう、削除ではなく無効化（isActive = 0）にする。
--
-- 実行方法:
--   npx wrangler d1 execute affect-crm --local  --file migrations/0008_visit_channel_remove_first.sql
--   npx wrangler d1 execute affect-crm --remote --file migrations/0008_visit_channel_remove_first.sql

UPDATE "MasterOption"
SET "isActive" = 0, "updatedAt" = '2026-09-14T00:00:00.000+00:00'
WHERE "type" = 'VISIT_CHANNEL' AND "code" = 'FIRST';
