-- 既存社員の社員番号を、所属会社の採番ルール（Company.codePrefix / codeDigits）に合わせて付け替える。
-- 一度きりの移行用（DBはCloudflare D1のため wrangler 経由で実行する）。
--
--   確認:  npx wrangler d1 execute timecalc --local  --file scripts/apply-employee-code-prefix.sql
--   本番:  npx wrangler d1 execute timecalc --remote --file scripts/apply-employee-code-prefix.sql
--
-- 前提:
-- - 先に設定画面の会社タブで「社員番号の採番」（接頭辞・桁数）を保存しておくこと
-- - 接頭辞が未設定の会社の社員は対象外（そのまま）
-- - すでに接頭辞が付いている番号は対象外（二重付与しない）
-- - 連番部分が数字でない番号（例: "臨時01"）は対象外。必要なら画面から手で直す
--
-- 注意: 社員番号はログインIDとしても使われ、CSV取込では社員番号の完全一致で名寄せする。
-- 付け替え後は Square 側の従業員IDも同じ番号に揃えること
-- （一致しない番号は取込時に新規社員として自動登録されるため）。

UPDATE "User"
SET "employeeCode" = (
  SELECT c."codePrefix"
      || substr('0000000000' || CAST("User"."employeeCode" AS INTEGER), -c."codeDigits")
  FROM "Department" d
  JOIN "Company" c ON c."id" = d."companyId"
  WHERE d."id" = "User"."departmentId"
)
WHERE "departmentId" IS NOT NULL
  -- 数字だけの社員番号のみを対象にする（体系外の番号は触らない）
  AND "employeeCode" GLOB '[0-9]*'
  AND NOT "employeeCode" GLOB '*[^0-9]*'
  AND EXISTS (
    SELECT 1
    FROM "Department" d
    JOIN "Company" c ON c."id" = d."companyId"
    WHERE d."id" = "User"."departmentId"
      AND c."codePrefix" IS NOT NULL
      AND c."codePrefix" <> ''
  );

-- 結果確認
SELECT u."employeeCode", u."name", c."name" AS company
FROM "User" u
LEFT JOIN "Department" d ON d."id" = u."departmentId"
LEFT JOIN "Company" c ON c."id" = d."companyId"
ORDER BY u."employeeCode";
