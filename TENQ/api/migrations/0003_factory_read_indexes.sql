-- 工場で絞る読み取りのインデックス（2026-10-23）
-- D1 無料プランは「読み取り行数 1 日 500 万行（アカウント全体）」。インデックスのない検索は表を全件読み、
-- その行数がすべて数えられる。2026-10-22 に、30 秒ごとに更新するカード一覧が点検記録を毎回全件（約 3,000 行）
-- 読んでいたため、開発用の環境だけで上限に達し、同じアカウントの本番も止まった。

-- カード一覧: 今日の点検（factory_id + period_key）
CREATE INDEX ix_inspections_factory_period ON inspections(factory_id, period_key);
-- 帳票（月間点検表・ISO 監査一覧）: 工場 + 点検日
CREATE INDEX ix_inspections_factory_date ON inspections(factory_id, inspection_date);
-- 点検の検索・CSV: 会社 + 工場 + 開始時刻の順に読む（先頭のページだけ読んで止められる）
CREATE INDEX ix_inspections_scope_started ON inspections(company_id, factory_id, started_at, id);
-- カード一覧: 工場の未完了の異常の件数
CREATE INDEX ix_abnormalities_factory_status ON abnormalities(factory_id, status);
