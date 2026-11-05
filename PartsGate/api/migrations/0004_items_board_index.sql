-- 置場別チェックの一覧（読み取り画面。読み取りのたびに読み直す）の索引。
-- 一覧は「ミスミ納期 × 置場」で絞り、グローバル番号の順に並べる。0001 の ix_items_vrd_loc (company_id, vrd, location_id) では
-- 並べ替えに使えないため、DB が ux_items_global (company_id, global_no) を選び、会社の明細を全件読んでいた
-- （性能テストの 36 万件で 1 回 246ms。読み取り十数回で D1 無料枠の 1 日 500 万行に届く）。
-- 絞り込みと並べ替えを 1 つの索引で済ませる。ix_items_vrd_loc は、この索引の先頭 3 列と同じなので消す。
CREATE INDEX ix_items_board ON order_items(company_id, vrd, location_id, global_no);
DROP INDEX ix_items_vrd_loc;
