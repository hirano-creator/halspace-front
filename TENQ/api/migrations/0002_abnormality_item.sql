-- 異常報告を「どの点検のどの項目で見つかったか」に結び付ける。
-- 点検結果（inspection_results）は追記専用で、完了後に abnormality_id を書き込めないため、異常側に持つ。
ALTER TABLE abnormalities ADD COLUMN inspection_item_id TEXT REFERENCES inspection_items(id);
CREATE INDEX ix_abnormalities_inspection ON abnormalities(inspection_id, inspection_item_id);
