-- 社員番号を会社ごとの体系にするための列追加（既存のD1/SQLite向け差分）
--
-- 社員番号自体は全社で一意（User.employeeCode の UNIQUE）のままなので、
-- ログイン・CSV取込の名寄せ・一括登録の重複チェックには影響しない。
-- ここで足すのは「新規登録時にどの番号を提案するか」の会社ごとの設定だけ。
--
-- ローカル:  npx wrangler d1 execute <DB名> --local  --file scripts/add-company-code-rule.sql
-- 本番:      npx wrangler d1 execute <DB名> --remote --file scripts/add-company-code-rule.sql

ALTER TABLE "Company" ADD COLUMN "codePrefix" TEXT;
ALTER TABLE "Company" ADD COLUMN "codeDigits" INTEGER NOT NULL DEFAULT 4;
