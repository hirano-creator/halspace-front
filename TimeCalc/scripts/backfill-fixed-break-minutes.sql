-- 一回限りの補正SQL: 固定休憩を勤務時間帯と無関係に全額控除していた
-- 旧計算式で保存された既存 Attendance 行の breakMinutes を補正する。
--
-- 旧: breakMinutes = 休憩時間帯の長さ（60分）＋ 控除外出
--     → 休憩をまたがない半日勤務（例 7:14〜11:06）でも1時間引かれていた
-- 新: breakMinutes = 勤務時間帯と休憩時間帯の重なり ＋ 控除外出
--
-- 対象: source が MANUAL / CLOCK で、旧固定休憩（60分）が丸ごと含まれている行のみ。
--       CSV取込（source='CSV'）は列の実測値そのものなので対象外。
--       breakMinutes が60分未満の行は手入力とみなして触らない。
--
-- 前提: 休憩時間帯は 12:00〜13:00（= 720分〜780分、長さ60分）。
--       会社別設定で変更している場合は下の 720 / 780 / 60 を実設定に合わせて書き換える。
--
-- 実行前の確認（更新される行と補正後の値を一覧する）:
--   npx wrangler d1 execute timecalc --remote --command "SELECT a.date, u.name, a.clockIn, a.clockOut, a.breakMinutes, a.breakMinutes - (60 - max(0, min(CAST(substr(a.clockOut,1,2) AS INTEGER)*60 + CAST(substr(a.clockOut,4,2) AS INTEGER), 780) - max(CAST(substr(a.clockIn,1,2) AS INTEGER)*60 + CAST(substr(a.clockIn,4,2) AS INTEGER), 720))) AS corrected FROM Attendance a JOIN User u ON u.id = a.userId WHERE a.source IN ('MANUAL','CLOCK') AND a.clockOut IS NOT NULL AND a.clockOut <> '' AND a.breakMinutes >= 60 AND (60 - max(0, min(CAST(substr(a.clockOut,1,2) AS INTEGER)*60 + CAST(substr(a.clockOut,4,2) AS INTEGER), 780) - max(CAST(substr(a.clockIn,1,2) AS INTEGER)*60 + CAST(substr(a.clockIn,4,2) AS INTEGER), 720))) > 0"
--
-- 実行:
--   ローカル: npx wrangler d1 execute timecalc --local  --file scripts/backfill-fixed-break-minutes.sql
--   本番:     npx wrangler d1 execute timecalc --remote --file scripts/backfill-fixed-break-minutes.sql

UPDATE "Attendance"
SET "breakMinutes" = "breakMinutes" - (
  60 - max(
    0,
    min(CAST(substr("clockOut", 1, 2) AS INTEGER) * 60 + CAST(substr("clockOut", 4, 2) AS INTEGER), 780)
      - max(CAST(substr("clockIn", 1, 2) AS INTEGER) * 60 + CAST(substr("clockIn", 4, 2) AS INTEGER), 720)
  )
)
WHERE "source" IN ('MANUAL', 'CLOCK')
  AND "clockOut" IS NOT NULL
  AND "clockOut" <> ''
  AND "breakMinutes" >= 60
  AND (
    60 - max(
      0,
      min(CAST(substr("clockOut", 1, 2) AS INTEGER) * 60 + CAST(substr("clockOut", 4, 2) AS INTEGER), 780)
        - max(CAST(substr("clockIn", 1, 2) AS INTEGER) * 60 + CAST(substr("clockIn", 4, 2) AS INTEGER), 720)
    )
  ) > 0;
