-- 見取り図で設備を建屋の中の好きな位置に置く（2026-11-08）
-- board_x / board_y は建屋の中での左上の位置（建屋の中身の幅・高さに対する千分率、0〜1000）。
-- NULL の設備はこれまでどおり建屋の上から順に並ぶ（既存の設備はすべて NULL のまま）。
-- 千分率なので、建屋の大きさを変えても中の配置の比率は保たれる。
ALTER TABLE equipment ADD COLUMN board_x INTEGER CHECK (board_x BETWEEN 0 AND 1000);
ALTER TABLE equipment ADD COLUMN board_y INTEGER CHECK (board_y BETWEEN 0 AND 1000);
