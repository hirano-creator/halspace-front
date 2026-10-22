-- 負荷テスト用のダミーデータ（開発用の環境だけ。本番に流さない）
-- 会社 3「負荷テスト工業」: 設備 100 台 × 30 日分の点検（1 回 6 項目）＝ 約 3,000 点検・18,000 結果
-- 利用者は工場長 hs_user_id 900301（開発用ログイン dev-900301）、一般社員 900302

INSERT INTO factories (id, company_id, code, name, timezone, working_days, status, created_at, updated_at) VALUES
  ('fac-lt', 3, 'LT', '負荷テスト工場', 'Asia/Tokyo', '1,2,3,4,5,6,7', 'active', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'));

INSERT INTO users (id, hs_user_id, company_id, name, email, role, status, created_at, updated_at) VALUES
  ('usr-lt-mgr', 900301, 3, '負荷 工場長', 'lt-mgr@example.test', 'factory_manager', 'active', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('usr-lt-w', 900302, 3, '負荷 点検者', 'lt-w@example.test', 'worker', 'active', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
INSERT INTO user_factories (user_id, factory_id, created_at) VALUES
  ('usr-lt-mgr', 'fac-lt', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('usr-lt-w', 'fac-lt', strftime('%Y-%m-%dT%H:%M:%fZ','now'));

INSERT INTO areas (id, company_id, factory_id, name, grid_row, grid_col, col_span, sort_order, created_at, updated_at)
  WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 5)
  SELECT 'area-lt-' || i, 3, 'fac-lt', 'ライン ' || i, (i - 1) / 2, ((i - 1) % 2) * 6, 6, i, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM n;

INSERT INTO inspection_templates (id, company_id, name, created_at, updated_at) VALUES
  ('tpl-lt', 3, '負荷テスト 日常点検', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
INSERT INTO inspection_template_versions (id, template_id, version_no, status, created_at) VALUES
  ('tv-lt-1', 'tpl-lt', 1, 'draft', strftime('%Y-%m-%dT%H:%M:%fZ','now','-90 days'));
INSERT INTO inspection_items (id, template_version_id, sort_order, label, criteria, required, allow_na)
  WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 6)
  SELECT 'it-lt-' || i, 'tv-lt-1', i, '点検項目 ' || i, '判定基準 ' || i, 1, 0 FROM n;
UPDATE inspection_template_versions SET status = 'published', published_at = created_at WHERE id = 'tv-lt-1';
UPDATE inspection_templates SET current_version_id = 'tv-lt-1' WHERE id = 'tpl-lt';

INSERT INTO equipment (id, company_id, factory_id, equipment_code, name, location, category, manager_user_id, area_id, board_order, status, frequency, template_id, created_at, updated_at)
  WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 100)
  SELECT 'eq-lt-' || i, 3, 'fac-lt', 'LT-' || printf('%03d', i), '負荷テスト設備 ' || i, 'ライン ' || ((i % 5) + 1),
         CASE i % 4 WHEN 0 THEN 'プレス' WHEN 1 THEN '旋盤' WHEN 2 THEN '溶接' ELSE '空圧' END,
         'usr-lt-mgr', 'area-lt-' || ((i % 5) + 1), i, 'active', 'daily', 'tpl-lt',
         strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM n;

-- 30 日分（今日を含む）。今日は 3 台に 1 台を未点検のまま残す。37 回に 1 回は異常あり
INSERT INTO inspections (id, company_id, factory_id, equipment_id, template_version_id, period_key, inspection_date, status, inspector_user_id, started_at, completed_at, overall_result, created_at, updated_at)
  WITH RECURSIVE d(k) AS (SELECT 0 UNION ALL SELECT k + 1 FROM d WHERE k < 29),
                 n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 100)
  SELECT 'in-lt-' || i || '-' || k, 3, 'fac-lt', 'eq-lt-' || i, 'tv-lt-1',
         date('now', '+9 hours', '-' || k || ' days'), date('now', '+9 hours', '-' || k || ' days'), 'completed', 'usr-lt-w',
         strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-' || k || ' days', '-3 hours', '+' || i || ' minutes'),
         strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-' || k || ' days', '-3 hours', '+' || (i + 2) || ' minutes'),
         CASE WHEN (i * 7 + k) % 37 = 0 THEN 'ng' ELSE 'ok' END,
         strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
  FROM d CROSS JOIN n WHERE NOT (k = 0 AND i % 3 = 0);

INSERT INTO inspection_results (id, inspection_id, revision, item_id, judgment, note, created_at, created_by)
  SELECT 'r-' || i.id || '-' || it.sort_order, i.id, 1, it.id,
         CASE WHEN i.overall_result = 'ng' AND it.sort_order = 2 THEN 'ng' ELSE 'ok' END,
         CASE WHEN i.overall_result = 'ng' AND it.sort_order = 2 THEN '負荷テストの異常' ELSE NULL END,
         i.completed_at, 'usr-lt-w'
  FROM inspections i JOIN inspection_items it ON it.template_version_id = 'tv-lt-1' WHERE i.company_id = 3;

INSERT INTO abnormalities (id, company_id, factory_id, equipment_id, inspection_id, report_no, title, found_at, reported_by, severity, status, assignee_user_id, due_date, created_at, updated_at)
  SELECT 'ab-' || i.id, 3, 'fac-lt', i.equipment_id, i.id, 'LT-LOAD-' || printf('%04d', ROW_NUMBER() OVER (ORDER BY i.id)), '負荷テストの異常',
         i.completed_at, 'usr-lt-w', 'medium', 'assigned', 'usr-lt-mgr', date(i.inspection_date, '+3 days'),
         strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
  FROM inspections i WHERE i.company_id = 3 AND i.overall_result = 'ng';
