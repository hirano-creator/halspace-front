-- 見取り図の設備のカードの大きさ（2026-11-08）
-- board_w / board_h は画面上の幅・高さ（px）。NULL = 既定の大きさ（幅 132px・高さ 62px）。
-- 位置（board_x / board_y）と違い px で持つ（文字の大きさは建屋の大きさで変わらないため）。
ALTER TABLE equipment ADD COLUMN board_w INTEGER CHECK (board_w BETWEEN 60 AND 1200);
ALTER TABLE equipment ADD COLUMN board_h INTEGER CHECK (board_h BETWEEN 40 AND 800);
