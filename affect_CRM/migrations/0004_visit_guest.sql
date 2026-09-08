-- affect CRM: 匿名来店グループの内訳（年代・性別）テーブルを追加
--
-- 背景: これまで Visit.guestAgeGroup / guestGender は 1 来店（グループ）につき
-- 1 組しか持てず、複数人で年代・性別が混在するグループを正しく記録できなかった。
-- VisitGuest に人数分の内訳を任意で持たせ、あれば分析側で優先して使う。
--
-- 実行方法:
--   npx wrangler d1 execute affect-crm --local  --file migrations/0004_visit_guest.sql
--   npx wrangler d1 execute affect-crm --remote --file migrations/0004_visit_guest.sql

CREATE TABLE "VisitGuest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "visitId" TEXT NOT NULL,
    "ageGroup" TEXT,
    "gender" TEXT,
    CONSTRAINT "VisitGuest_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "Visit" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "VisitGuest_visitId_idx" ON "VisitGuest"("visitId");
