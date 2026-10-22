-- TENQ 開発用ダミーデータ（ローカル専用。本番・開発リモートに流さない）
-- 人名・会社名・設備はすべて架空。点検日は「今日（日本時間）」で入るので、いつ実行しても今日の状況になる。
-- company_id 1 = サンプル製作所（第1工場・第2工場）、2 = 他社テスト工業（越境テスト用）

-- ===== 工場 =====
INSERT INTO factories (id, company_id, code, name, address, timezone, working_days, status, created_at, updated_at) VALUES
  ('fac-1a', 1, 'F01', '第1工場', '愛知県（架空）', 'Asia/Tokyo', '1,2,3,4,5', 'active', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('fac-1b', 1, 'F02', '第2工場', '岐阜県（架空）', 'Asia/Tokyo', '1,2,3,4,5,6', 'active', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('fac-2a', 2, 'F01', '本社工場', '静岡県（架空）', 'Asia/Tokyo', '1,2,3,4,5', 'active', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'));

-- ===== 利用者（hs_user_id は架空。ローカルの Space.app でログインした人は初回アクセス時に別途作られる） =====
INSERT INTO users (id, hs_user_id, company_id, name, email, role, status, suspended_reason, created_at, updated_at) VALUES
  ('usr-yamamoto',  900001, 1, '山本 健',   'yamamoto@example.test',  'worker',          'active',    NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('usr-sato',      900002, 1, '佐藤 美咲', 'sato@example.test',      'equipment_staff', 'active',    NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('usr-suzuki',    900003, 1, '鈴木 大地', 'suzuki@example.test',    'equipment_staff', 'active',    NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('usr-nakamura',  900004, 1, '中村 誠',   'nakamura@example.test',  'factory_manager', 'active',    NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('usr-takahashi', 900005, 1, '高橋 遥',   'takahashi@example.test', 'system_admin',    'active',    NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('usr-tanaka',    900006, 1, '田中 翔',   'tanaka@example.test',    'worker',          'active',    NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('usr-norole',    900007, 1, '伊藤 未設定', 'norole@example.test',  NULL,              'active',    NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('usr-suspended', 900008, 1, '小林 停止中', 'suspended@example.test', 'worker',        'suspended', '端末紛失（テスト）', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('usr-other',     900101, 2, '他社 工場長', 'other@example.test',   'factory_manager', 'active',    NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'));

INSERT INTO user_factories (user_id, factory_id, created_at) VALUES
  ('usr-yamamoto', 'fac-1a', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('usr-sato', 'fac-1a', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('usr-suzuki', 'fac-1a', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('usr-nakamura', 'fac-1a', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('usr-tanaka', 'fac-1b', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('usr-suspended', 'fac-1a', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('usr-other', 'fac-2a', strftime('%Y-%m-%dT%H:%M:%fZ','now'));

-- ===== エリア（第1工場。12列の格子） =====
INSERT INTO areas (id, company_id, factory_id, name, grid_row, grid_col, col_span, sort_order, created_at, updated_at) VALUES
  ('area-a', 1, 'fac-1a', 'A棟 プレスライン', 0, 0, 5, 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('area-b', 1, 'fac-1a', 'B棟 切削',         0, 5, 4, 2, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('area-u', 1, 'fac-1a', '共用設備・屋外',   0, 9, 3, 3, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('area-c', 1, 'fac-1a', 'C棟 溶接',         1, 0, 9, 4, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'));

-- ===== 点検基準（版は draft で項目を入れてから published にする。トリガーの都合） =====
INSERT INTO inspection_templates (id, company_id, factory_id, name, created_at, updated_at) VALUES
  ('tpl-press', 1, NULL, 'プレス機 日常点検', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('tpl-cut',   1, NULL, '切削機 日常点検',   strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('tpl-weld',  1, NULL, '溶接ロボット 日常点検', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('tpl-air',   1, NULL, 'コンプレッサー 日常点検', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('tpl-lift',  1, NULL, '揚重機 始業前点検', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('tpl-other', 2, NULL, '他社 共通点検', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'));

INSERT INTO inspection_template_versions (id, template_id, version_no, status, change_reason, created_at) VALUES
  ('tv-press-1', 'tpl-press', 1, 'draft', NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('tv-cut-1',   'tpl-cut',   1, 'draft', NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 days')),
  ('tv-cut-2',   'tpl-cut',   2, 'draft', '扉インターロックの確認を追加', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('tv-weld-1',  'tpl-weld',  1, 'draft', NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('tv-air-1',   'tpl-air',   1, 'draft', NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('tv-lift-1',  'tpl-lift',  1, 'draft', NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('tv-other-1', 'tpl-other', 1, 'draft', NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'));

INSERT INTO inspection_items (id, template_version_id, sort_order, group_label, label, criteria, required, allow_na) VALUES
  ('it-press-1', 'tv-press-1', 1, '外観', '外観', '本体・フレームに破損や変形がないこと', 1, 0),
  ('it-press-2', 'tv-press-1', 2, '異常音', '異音・異臭', '運転中に普段と違う音・においがないこと', 1, 0),
  ('it-press-3', 'tv-press-1', 3, '漏れ', '油漏れ', '配管継手・床に作動油のにじみがないこと', 1, 0),
  ('it-press-4', 'tv-press-1', 4, '安全', '光線式安全装置', '手をかざして停止すること', 1, 0),
  ('it-press-5', 'tv-press-1', 5, '安全', '非常停止ボタン', '押して停止し、復帰できること', 1, 0),
  ('it-press-6', 'tv-press-1', 6, '清掃', '清掃状態', '金型周辺に切りくず・油だまりがないこと', 0, 1),
  ('it-cut1-1', 'tv-cut-1', 1, '外観', '外観', 'カバー・扉に破損がないこと', 1, 0),
  ('it-cut1-2', 'tv-cut-1', 2, '異常音', '異音・振動', '主軸・送りに異音や振動がないこと', 1, 0),
  ('it-cut1-3', 'tv-cut-1', 3, '漏れ', '切削油', '量が規定範囲で、漏れがないこと', 1, 0),
  ('it-cut1-4', 'tv-cut-1', 4, '安全', '非常停止ボタン', '押して停止し、復帰できること', 1, 0),
  ('it-cut2-1', 'tv-cut-2', 1, '外観', '外観', 'カバー・扉に破損がないこと', 1, 0),
  ('it-cut2-2', 'tv-cut-2', 2, '異常音', '異音・振動', '主軸・送りに異音や振動がないこと', 1, 0),
  ('it-cut2-3', 'tv-cut-2', 3, '漏れ', '切削油', '量が規定範囲で、漏れがないこと', 1, 0),
  ('it-cut2-4', 'tv-cut-2', 4, '安全', '扉インターロック', '扉を開けると停止すること', 1, 0),
  ('it-cut2-5', 'tv-cut-2', 5, '安全', '非常停止ボタン', '押して停止し、復帰できること', 1, 0),
  ('it-cut2-6', 'tv-cut-2', 6, '清掃', '切りくず清掃', 'チップコンベアが詰まっていないこと', 0, 1),
  ('it-weld-1', 'tv-weld-1', 1, '外観', '外観', 'ロボット・ポジショナに損傷がないこと', 1, 0),
  ('it-weld-2', 'tv-weld-1', 2, '配線', 'ケーブル・ホース', '被覆の傷・ガス漏れがないこと', 1, 0),
  ('it-weld-3', 'tv-weld-1', 3, '安全', '安全柵・扉', '扉を開けると停止すること', 1, 0),
  ('it-weld-4', 'tv-weld-1', 4, '安全', '非常停止ボタン', '押して停止し、復帰できること', 1, 0),
  ('it-weld-5', 'tv-weld-1', 5, '清掃', 'ノズル清掃', 'スパッタが付着していないこと', 0, 1),
  ('it-air-1', 'tv-air-1', 1, '外観', '外観', '本体・配管に損傷がないこと', 1, 0),
  ('it-air-2', 'tv-air-1', 2, '異常音', '異音', '運転音に異常がないこと', 1, 0),
  ('it-air-3', 'tv-air-1', 3, '保守', 'ドレン排出', 'ドレンを排出したこと', 1, 0),
  ('it-air-4', 'tv-air-1', 4, '計器', '圧力計', '0.6〜0.7MPa の範囲であること', 1, 0),
  ('it-air-5', 'tv-air-1', 5, '安全', '安全弁', '錆・固着がないこと', 1, 0),
  ('it-lift-1', 'tv-lift-1', 1, '外観', '外観', 'フック・ワイヤーに損傷がないこと', 1, 0),
  ('it-lift-2', 'tv-lift-1', 2, '動作', '巻上・巻下', '動作が正常で、ブレーキが効くこと', 1, 0),
  ('it-lift-3', 'tv-lift-1', 3, '安全', 'リミットスイッチ', '上限で停止すること', 1, 0),
  ('it-lift-4', 'tv-lift-1', 4, '操作', 'ペンダント', '押しボタンが正常に戻ること', 1, 0),
  ('it-other-1', 'tv-other-1', 1, '外観', '外観', '損傷がないこと', 1, 0);

UPDATE inspection_template_versions SET status = 'published', published_at = created_at WHERE id <> 'tv-cut-1';
UPDATE inspection_template_versions SET status = 'superseded', published_at = created_at WHERE id = 'tv-cut-1';
UPDATE inspection_templates SET current_version_id = 'tv-press-1' WHERE id = 'tpl-press';
UPDATE inspection_templates SET current_version_id = 'tv-cut-2'   WHERE id = 'tpl-cut';
UPDATE inspection_templates SET current_version_id = 'tv-weld-1'  WHERE id = 'tpl-weld';
UPDATE inspection_templates SET current_version_id = 'tv-air-1'   WHERE id = 'tpl-air';
UPDATE inspection_templates SET current_version_id = 'tv-lift-1'  WHERE id = 'tpl-lift';
UPDATE inspection_templates SET current_version_id = 'tv-other-1' WHERE id = 'tpl-other';

-- ===== 設備 =====
INSERT INTO equipment (id, company_id, factory_id, equipment_code, name, location, category, maker, model, manager_user_id, area_id, board_order, status, status_reason, frequency, template_id, created_at, updated_at) VALUES
  ('eq-p01', 1, 'fac-1a', 'P-01', '油圧プレス機 1号',     'A棟 プレスライン', 'プレス', '架空機械', 'HP-200', 'usr-sato',   'area-a', 1, 'active', NULL, 'daily', 'tpl-press', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('eq-p02', 1, 'fac-1a', 'P-02', '油圧プレス機 2号',     'A棟 プレスライン', 'プレス', '架空機械', 'HP-200', 'usr-sato',   'area-a', 2, 'active', NULL, 'daily', 'tpl-press', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('eq-p03', 1, 'fac-1a', 'P-03', '油圧プレス機 3号',     'A棟 プレスライン', 'プレス', '架空機械', 'HP-300', 'usr-sato',   'area-a', 3, 'active', NULL, 'daily', 'tpl-press', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('eq-p04', 1, 'fac-1a', 'P-04', 'サーボプレス 4号',     'A棟 プレスライン', 'プレス', '架空機械', 'SV-150', 'usr-sato',   'area-a', 4, 'active', NULL, 'daily', 'tpl-press', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('eq-l05', 1, 'fac-1a', 'L-05', 'NC旋盤 5号',           'B棟 切削', '旋盤', '架空工機', 'NL-25', 'usr-sato',   'area-b', 1, 'active', NULL, 'daily', 'tpl-cut', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('eq-l07', 1, 'fac-1a', 'L-07', 'NC旋盤 7号',           'B棟 切削', '旋盤', '架空工機', 'NL-30', 'usr-sato',   'area-b', 2, 'active', NULL, 'daily', 'tpl-cut', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('eq-m04', 1, 'fac-1a', 'M-04', 'マシニングセンタ 4号', 'B棟 切削', 'MC', '架空工機', 'VC-500', 'usr-suzuki', 'area-b', 3, 'active', NULL, 'daily', 'tpl-cut', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('eq-m06', 1, 'fac-1a', 'M-06', 'マシニングセンタ 6号', 'B棟 切削', 'MC', '架空工機', 'VC-600', 'usr-suzuki', 'area-b', 4, 'active', NULL, 'daily', 'tpl-cut', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('eq-k02', 1, 'fac-1a', 'K-02', '研削盤 2号',           'B棟 切削', '研削盤', '架空工機', 'GR-20', 'usr-suzuki', 'area-b', 5, 'stopped', '安全カバー留め具破損のため修理待ち', 'daily', 'tpl-cut', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('eq-w01', 1, 'fac-1a', 'W-01', '溶接ロボット 1号',     'C棟 溶接', '溶接', '架空ロボ', 'AR-6', 'usr-suzuki', 'area-c', 1, 'active', NULL, 'daily', 'tpl-weld', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('eq-w02', 1, 'fac-1a', 'W-02', '溶接ロボット 2号',     'C棟 溶接', '溶接', '架空ロボ', 'AR-6', 'usr-suzuki', 'area-c', 2, 'active', NULL, 'daily', 'tpl-weld', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('eq-w03', 1, 'fac-1a', 'W-03', '溶接ロボット 3号',     'C棟 溶接', '溶接', '架空ロボ', 'AR-8', 'usr-suzuki', 'area-c', 3, 'active', NULL, 'daily', 'tpl-weld', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('eq-c11', 1, 'fac-1a', 'C-11', 'エアコンプレッサー',   '屋外 コンプレッサー室', '空圧', '架空空圧', 'AC-37', 'usr-suzuki', 'area-u', 1, 'active', NULL, 'daily', 'tpl-air', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('eq-cr1', 1, 'fac-1a', 'CR-1', '天井クレーン 2.8t',    'A棟', '揚重', '架空クレーン', 'OC-28', 'usr-sato', 'area-u', 2, 'active', NULL, 'daily', 'tpl-lift', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('eq-cr2', 1, 'fac-1a', 'CR-2', 'チェーンブロック 1t',  'C棟', '揚重', '架空クレーン', 'CB-10', 'usr-sato', 'area-u', 3, 'active', NULL, 'daily', 'tpl-lift', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('eq-new', 1, 'fac-1a', 'D-01', 'ボール盤（未配置の例）', 'B棟', 'ボール盤', '架空工機', 'DR-13', NULL, NULL, 0, 'active', NULL, 'weekly', 'tpl-cut', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('eq-b01', 1, 'fac-1b', 'P-11', '油圧プレス機 11号',    '第2工場 1F', 'プレス', '架空機械', 'HP-200', NULL, NULL, 0, 'active', NULL, 'daily', 'tpl-press', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('eq-x01', 2, 'fac-2a', 'X-01', '他社 設備1',           '本社工場', 'その他', '架空', 'X', 'usr-other', NULL, 0, 'active', NULL, 'daily', 'tpl-other', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'));

-- ===== QR トークン（16 文字の base32 相当。開発用の固定値） =====
INSERT INTO equipment_qr_tokens (token, equipment_id, company_id, issued_at, revoked_at, revoke_reason) VALUES
  ('TENQDEVSEEDQRZAA', 'eq-p01', 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), NULL, NULL),
  ('TENQDEVSEEDQRZAB', 'eq-p02', 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), NULL, NULL),
  ('TENQDEVSEEDQRZAC', 'eq-p03', 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), NULL, NULL),
  ('TENQDEVSEEDQRZAD', 'eq-p04', 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), NULL, NULL),
  ('TENQDEVSEEDQRZAE', 'eq-l05', 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), NULL, NULL),
  ('TENQDEVSEEDQRZAF', 'eq-l07', 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), NULL, NULL),
  ('TENQDEVSEEDQRZAG', 'eq-m04', 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), NULL, NULL),
  ('TENQDEVSEEDQRZAH', 'eq-m06', 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), NULL, NULL),
  ('TENQDEVSEEDQRZAI', 'eq-k02', 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), NULL, NULL),
  ('TENQDEVSEEDQRZAJ', 'eq-w01', 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), NULL, NULL),
  ('TENQDEVSEEDQRZAK', 'eq-w02', 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), NULL, NULL),
  ('TENQDEVSEEDQRZAL', 'eq-w03', 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), NULL, NULL),
  ('TENQDEVSEEDQRZAM', 'eq-c11', 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), NULL, NULL),
  ('TENQDEVSEEDQRZAN', 'eq-cr1', 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), NULL, NULL),
  ('TENQDEVSEEDQRZAO', 'eq-cr2', 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), NULL, NULL),
  ('TENQDEVSEEDQRZAP', 'eq-new', 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), NULL, NULL),
  ('TENQDEVSEEDQRZAQ', 'eq-b01', 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), NULL, NULL),
  ('TENQDEVSEEDQRZXA', 'eq-x01', 2, strftime('%Y-%m-%dT%H:%M:%fZ','now'), NULL, NULL),
  -- 再発行で無効になった旧 QR（「再発行済み」の案内を確かめる用）
  ('TENQDEVSEEDQROLD', 'eq-p01', 1, strftime('%Y-%m-%dT%H:%M:%fZ','now','-60 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 days'), '汚損のため再発行');

-- ===== 今日の点検 =====
INSERT INTO inspections (id, company_id, factory_id, equipment_id, template_version_id, period_key, inspection_date, status, inspector_user_id, started_at, completed_at, overall_result, created_at, updated_at) VALUES
  ('ins-p01', 1, 'fac-1a', 'eq-p01', 'tv-press-1', strftime('%Y-%m-%d','now','+9 hours'), strftime('%Y-%m-%d','now','+9 hours'), 'completed', 'usr-yamamoto', strftime('%Y-%m-%dT%H:%M:%fZ','now','-150 minutes'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-145 minutes'), 'ok', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('ins-p02', 1, 'fac-1a', 'eq-p02', 'tv-press-1', strftime('%Y-%m-%d','now','+9 hours'), strftime('%Y-%m-%d','now','+9 hours'), 'completed', 'usr-yamamoto', strftime('%Y-%m-%dT%H:%M:%fZ','now','-140 minutes'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-136 minutes'), 'ok', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('ins-p03', 1, 'fac-1a', 'eq-p03', 'tv-press-1', strftime('%Y-%m-%d','now','+9 hours'), strftime('%Y-%m-%d','now','+9 hours'), 'in_progress', 'usr-yamamoto', strftime('%Y-%m-%dT%H:%M:%fZ','now','-5 minutes'), NULL, NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('ins-l05', 1, 'fac-1a', 'eq-l05', 'tv-cut-2',   strftime('%Y-%m-%d','now','+9 hours'), strftime('%Y-%m-%d','now','+9 hours'), 'completed', 'usr-sato', strftime('%Y-%m-%dT%H:%M:%fZ','now','-120 minutes'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-115 minutes'), 'ok', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('ins-l07', 1, 'fac-1a', 'eq-l07', 'tv-cut-2',   strftime('%Y-%m-%d','now','+9 hours'), strftime('%Y-%m-%d','now','+9 hours'), 'completed', 'usr-sato', strftime('%Y-%m-%dT%H:%M:%fZ','now','-112 minutes'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-108 minutes'), 'ng', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('ins-m06', 1, 'fac-1a', 'eq-m06', 'tv-cut-2',   strftime('%Y-%m-%d','now','+9 hours'), strftime('%Y-%m-%d','now','+9 hours'), 'completed', 'usr-suzuki', strftime('%Y-%m-%dT%H:%M:%fZ','now','-100 minutes'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-96 minutes'), 'ok', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('ins-w01', 1, 'fac-1a', 'eq-w01', 'tv-weld-1',  strftime('%Y-%m-%d','now','+9 hours'), strftime('%Y-%m-%d','now','+9 hours'), 'completed', 'usr-tanaka', strftime('%Y-%m-%dT%H:%M:%fZ','now','-90 minutes'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-87 minutes'), 'ok', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('ins-cr1', 1, 'fac-1a', 'eq-cr1', 'tv-lift-1',  strftime('%Y-%m-%d','now','+9 hours'), strftime('%Y-%m-%d','now','+9 hours'), 'completed', 'usr-nakamura', strftime('%Y-%m-%dT%H:%M:%fZ','now','-160 minutes'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-157 minutes'), 'ok', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('ins-cr2', 1, 'fac-1a', 'eq-cr2', 'tv-lift-1',  strftime('%Y-%m-%d','now','+9 hours'), strftime('%Y-%m-%d','now','+9 hours'), 'completed', 'usr-nakamura', strftime('%Y-%m-%dT%H:%M:%fZ','now','-155 minutes'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-152 minutes'), 'ng', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
-- 取り消した点検（同じ日に有効な点検を別に作れることの確認用）
INSERT INTO inspections (id, company_id, factory_id, equipment_id, template_version_id, period_key, inspection_date, status, inspector_user_id, started_at, voided_reason, voided_by, voided_at, created_at, updated_at) VALUES
  ('ins-w01-void', 1, 'fac-1a', 'eq-w01', 'tv-weld-1', strftime('%Y-%m-%d','now','+9 hours'), strftime('%Y-%m-%d','now','+9 hours'), 'voided', 'usr-tanaka', strftime('%Y-%m-%dT%H:%M:%fZ','now','-95 minutes'), '別の設備のQRを読んで開始したため', 'usr-tanaka', strftime('%Y-%m-%dT%H:%M:%fZ','now','-94 minutes'), strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'));

-- ===== 異常（L-07 は是正完了＝次は再確認、CR-2 は期限超過、K-02 は停止中で対応中） =====
INSERT INTO abnormalities (id, company_id, factory_id, equipment_id, inspection_id, report_no, title, description, found_at, reported_by, severity, emergency_action, equipment_stopped, status, assignee_user_id, due_date, corrected_date, created_at, updated_at) VALUES
  ('ab-1', 1, 'fac-1a', 'eq-l07', 'ins-l07', 'F01-0001', '主軸から異音', '回転数 1500rpm 以上で「キーン」という音', strftime('%Y-%m-%dT%H:%M:%fZ','now','-110 minutes'), 'usr-sato', 'high', '運転を止めて立入禁止の札を掛けた', 1, 'corrected', 'usr-sato', strftime('%Y-%m-%d','now','+9 hours','+3 days'), strftime('%Y-%m-%d','now','+9 hours'), strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('ab-2', 1, 'fac-1a', 'eq-cr2', 'ins-cr2', 'F01-0002', 'ブレーキの効きが弱い', '荷を下ろしたときに数センチ滑る', strftime('%Y-%m-%dT%H:%M:%fZ','now','-3 days'), 'usr-nakamura', 'medium', '定格の半分以下で使用', 0, 'assigned', 'usr-suzuki', strftime('%Y-%m-%d','now','+9 hours','-1 days'), NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('ab-3', 1, 'fac-1a', 'eq-k02', NULL, 'F01-0003', '安全カバーの留め具破損', '左側の留め具が割れてカバーが固定できない', strftime('%Y-%m-%dT%H:%M:%fZ','now','-2 days'), 'usr-yamamoto', 'high', '使用停止', 1, 'in_progress', 'usr-suzuki', strftime('%Y-%m-%d','now','+9 hours','+5 days'), NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'));

INSERT INTO corrective_actions (id, abnormality_id, kind, cause, description, performed_by, performed_at, created_at, created_by, updated_at) VALUES
  ('ca-1', 'ab-1', 'permanent', '主軸ベアリングの摩耗', '主軸ベアリングを交換し、試運転で異音がないことを確認', 'usr-sato', strftime('%Y-%m-%d','now','+9 hours'), strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'usr-sato', strftime('%Y-%m-%dT%H:%M:%fZ','now'));

INSERT INTO abnormality_events (id, abnormality_id, from_status, to_status, comment, actor_user_id, created_at) VALUES
  ('ev-1', 'ab-1', NULL, 'reported', NULL, 'usr-sato', strftime('%Y-%m-%dT%H:%M:%fZ','now','-110 minutes')),
  ('ev-2', 'ab-1', 'reported', 'assigned', '担当: 佐藤', 'usr-sato', strftime('%Y-%m-%dT%H:%M:%fZ','now','-100 minutes')),
  ('ev-3', 'ab-1', 'assigned', 'in_progress', NULL, 'usr-sato', strftime('%Y-%m-%dT%H:%M:%fZ','now','-90 minutes')),
  ('ev-4', 'ab-1', 'in_progress', 'corrected', 'ベアリング交換', 'usr-sato', strftime('%Y-%m-%dT%H:%M:%fZ','now','-10 minutes')),
  ('ev-5', 'ab-2', NULL, 'reported', NULL, 'usr-nakamura', strftime('%Y-%m-%dT%H:%M:%fZ','now','-3 days')),
  ('ev-6', 'ab-2', 'reported', 'assigned', '担当: 鈴木', 'usr-nakamura', strftime('%Y-%m-%dT%H:%M:%fZ','now','-3 days')),
  ('ev-7', 'ab-3', NULL, 'reported', NULL, 'usr-yamamoto', strftime('%Y-%m-%dT%H:%M:%fZ','now','-2 days')),
  ('ev-8', 'ab-3', 'reported', 'assigned', '担当: 鈴木', 'usr-nakamura', strftime('%Y-%m-%dT%H:%M:%fZ','now','-2 days')),
  ('ev-9', 'ab-3', 'assigned', 'in_progress', '部品手配中', 'usr-suzuki', strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 days'));

-- ===== 点検結果（完了した点検の各項目。対象外を許可した項目は「対象外」） =====
INSERT INTO inspection_results (id, inspection_id, revision, item_id, judgment, created_at, created_by)
  SELECT 'res-' || ins.id || '-' || it.id, ins.id, 1, it.id,
         CASE WHEN it.allow_na = 1 THEN 'na' ELSE 'ok' END,
         ins.completed_at, ins.inspector_user_id
  FROM inspections ins JOIN inspection_items it ON it.template_version_id = ins.template_version_id
  WHERE ins.status = 'completed' AND NOT (ins.id = 'ins-l07' AND it.id = 'it-cut2-2') AND NOT (ins.id = 'ins-cr2' AND it.id = 'it-lift-2');
INSERT INTO inspection_results (id, inspection_id, revision, item_id, judgment, note, abnormality_id, created_at, created_by) VALUES
  ('res-ins-l07-ng', 'ins-l07', 1, 'it-cut2-2', 'ng', '主軸から異音', 'ab-1', strftime('%Y-%m-%dT%H:%M:%fZ','now','-108 minutes'), 'usr-sato'),
  ('res-ins-cr2-ng', 'ins-cr2', 1, 'it-lift-2', 'ng', 'ブレーキが滑る', 'ab-2', strftime('%Y-%m-%dT%H:%M:%fZ','now','-152 minutes'), 'usr-nakamura');

-- ===== 設定 =====
INSERT INTO system_settings (company_id, key, value_json, updated_at) VALUES
  (1, 'retention_years', '5', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (1, 'late_threshold', '"09:00"', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (1, 'device_login_days', '30', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (1, 'board_refresh_seconds', '30', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (1, 'photo_max_count', '10', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (1, 'high_severity_message', '"危険度「高」です。設備の使用を止め、責任者に連絡してください。最終的な判断は会社の安全管理ルールに従ってください。"', strftime('%Y-%m-%dT%H:%M:%fZ','now'));

INSERT INTO audit_logs (company_id, factory_id, actor_user_id, action, target_type, target_id, detail_json, created_at) VALUES
  (1, 'fac-1a', 'usr-takahashi', 'seed.load', 'system', 'dev-seed', '{"note":"開発用ダミーデータを投入"}', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
