-- 実行方法:
--   npx wrangler d1 execute affect-crm --local  --file migrations/0007_visit_channel_google_yahoo.sql
--   npx wrangler d1 execute affect-crm --remote --file migrations/0007_visit_channel_google_yahoo.sql
--
-- 来店経路(VISIT_CHANNEL)に Google / Yahoo! を追加する。
-- 「その他」は末尾に固定したいので、追加した2件を「その他」の手前に差し込み、
-- 「その他」の sortOrder を後ろにずらす。

INSERT OR IGNORE INTO "MasterOption" ("id","type","code","label","sortOrder","isActive","createdAt","updatedAt")
VALUES ('mo-VISIT_CHANNEL-GOOGLE','VISIT_CHANNEL','GOOGLE','Google',6,1,'2026-09-08T00:37:46.480+00:00','2026-09-08T00:37:46.480+00:00');

INSERT OR IGNORE INTO "MasterOption" ("id","type","code","label","sortOrder","isActive","createdAt","updatedAt")
VALUES ('mo-VISIT_CHANNEL-YAHOO','VISIT_CHANNEL','YAHOO','Yahoo!',7,1,'2026-09-08T00:37:46.480+00:00','2026-09-08T00:37:46.480+00:00');

UPDATE "MasterOption" SET "sortOrder" = 8, "updatedAt" = '2026-09-08T00:37:46.480+00:00'
WHERE "type" = 'VISIT_CHANNEL' AND "code" = 'OTHER';
