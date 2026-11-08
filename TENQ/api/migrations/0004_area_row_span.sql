-- 建屋（エリア）に縦の大きさを持たせる（2026-11-08）
-- これまで grid_row は「段」で、段の高さは中身（設備のタイル）で決まっていた。
-- 実際の配置に近づけるため、grid_row を「細かいマス（1 マス = 画面で 40px 以上）」の位置に変え、
-- row_span（縦に何マス使うか）を足す。既存の段は 3 マスずつに広げる（段 0 → 0、段 1 → 3、…）。
-- マスの高さは「最低 40px、中身が入りきらなければ伸びる」なので、既存の見た目は大きく変わらない。
ALTER TABLE areas ADD COLUMN row_span INTEGER NOT NULL DEFAULT 3 CHECK (row_span BETWEEN 2 AND 40);
UPDATE areas SET grid_row = grid_row * 3;
