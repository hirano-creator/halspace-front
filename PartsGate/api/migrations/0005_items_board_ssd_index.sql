-- 読み取り画面の一覧を「メーカー納期（メーカー出荷日 SSD）× 置場」で絞るように変えた（2026-11-09 オーナー決定。
-- 現場はミスミ納期ではなくメーカー納期で管理している）。0004 と同じく、絞り込みと並べ替え（グローバル番号順）を 1 つの索引で済ませる。
-- ix_items_board（ミスミ納期）は、注文データ・分析のミスミ納期の範囲検索で使うので残す。
CREATE INDEX ix_items_board_ssd ON order_items(company_id, ssd, location_id, global_no);
