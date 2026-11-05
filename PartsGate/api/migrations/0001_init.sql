-- PARTS GATE 初期スキーマ（docs/database.md）
-- 方針:
--  - 会社の業務データはすべて company_id を持つ。会社をまたぐ参照は (company_id, id) の複合外部キーで DB でも防ぐ
--  - 主キーは INTEGER（rowid）。UUID は容量を食うので使わない。番号が推測されても、検索は必ず company_id で絞る
--  - 日時は UTC の ISO 文字列。業務日（出荷日・集計日）は日本時間の YYYY-MM-DD
--  - 読み取り履歴・訂正・監査ログは上書き・削除しない（トリガーで拒否）。マスター・注文も削除しない（利用停止・取消）

-- ===== 会社・利用者 =====

CREATE TABLE companies (
  id          INTEGER PRIMARY KEY,               -- Space.app の company_id をそのまま使う
  name        TEXT NOT NULL,
  code        TEXT NOT NULL UNIQUE,              -- 企業コード（初回は Space.app の company_slug）
  address     TEXT,
  phone       TEXT,
  admin_note  TEXT,                              -- 管理者情報（担当者名など）
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  version     INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE users (
  id            INTEGER PRIMARY KEY,
  company_id    INTEGER NOT NULL REFERENCES companies(id),
  hs_user_id    INTEGER NOT NULL UNIQUE,         -- Space.app のユーザー ID
  name          TEXT NOT NULL,
  email         TEXT,
  role          TEXT NOT NULL CHECK (role IN ('admin', 'general')),
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  last_seen_at  TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  version       INTEGER NOT NULL DEFAULT 1,
  UNIQUE (company_id, id)
);

CREATE TABLE company_settings (
  company_id               INTEGER PRIMARY KEY REFERENCES companies(id),
  match_field              TEXT NOT NULL DEFAULT 'barcode_global_no' CHECK (match_field IN ('barcode_global_no', 'global_no')),
  barcode_strip_prefix     TEXT NOT NULL DEFAULT '',
  barcode_strip_suffix     TEXT NOT NULL DEFAULT '',
  scans_per_item           TEXT NOT NULL DEFAULT 'one' CHECK (scans_per_item IN ('one', 'quantity')),
  warn_ship_date_mismatch  INTEGER NOT NULL DEFAULT 1 CHECK (warn_ship_date_mismatch IN (0, 1)),
  reauth_hours             INTEGER NOT NULL DEFAULT 12 CHECK (reauth_hours BETWEEN 1 AND 72),
  csv_profile_json         TEXT NOT NULL DEFAULT '{}',   -- CSV の列名と項目の対応（docs/csv-import.md §3）。STEP 5 で使う
  updated_at               TEXT NOT NULL,
  version                  INTEGER NOT NULL DEFAULT 1
);

-- ===== マスター =====

CREATE TABLE staff (
  id          INTEGER PRIMARY KEY,
  company_id  INTEGER NOT NULL REFERENCES companies(id),
  code        TEXT NOT NULL,
  name        TEXT NOT NULL,
  department  TEXT,
  factory     TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  version     INTEGER NOT NULL DEFAULT 1,
  UNIQUE (company_id, code),
  UNIQUE (company_id, id)
);
CREATE INDEX ix_staff_order ON staff(company_id, sort_order, code);

CREATE TABLE locations (
  id           INTEGER PRIMARY KEY,
  company_id   INTEGER NOT NULL REFERENCES companies(id),
  code         TEXT NOT NULL,                    -- CSV と同じ書き方（ヒラノは 4 桁 0053 など）
  name         TEXT NOT NULL,
  description  TEXT,
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  version      INTEGER NOT NULL DEFAULT 1,
  UNIQUE (company_id, code),
  UNIQUE (company_id, id)
);

CREATE TABLE destinations (
  id             INTEGER PRIMARY KEY,
  company_id     INTEGER NOT NULL REFERENCES companies(id),
  customer_code  TEXT NOT NULL,                  -- 得意先コード（直送先コードは得意先をまたいで重複するため組で持つ）
  code           TEXT NOT NULL,                  -- 直送先コード
  name           TEXT NOT NULL,
  postal_code    TEXT,
  address        TEXT,
  phone          TEXT,
  note           TEXT,
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  version        INTEGER NOT NULL DEFAULT 1,
  UNIQUE (company_id, customer_code, code),
  UNIQUE (company_id, id)
);

-- ===== CSV 取込 =====

CREATE TABLE import_batches (
  id             INTEGER PRIMARY KEY,
  company_id     INTEGER NOT NULL REFERENCES companies(id),
  file_name      TEXT NOT NULL,
  file_sha256    TEXT NOT NULL,                  -- 同じファイルの二重取込の検出用（取り込み直しは許すので UNIQUE にしない）
  r2_key         TEXT NOT NULL,
  encoding       TEXT NOT NULL CHECK (encoding IN ('shift_jis', 'utf-8')),
  status         TEXT NOT NULL DEFAULT 'uploading' CHECK (status IN ('uploading', 'committed', 'aborted')),
  row_total      INTEGER NOT NULL DEFAULT 0,
  row_new        INTEGER NOT NULL DEFAULT 0,
  row_updated    INTEGER NOT NULL DEFAULT 0,
  row_unchanged  INTEGER NOT NULL DEFAULT 0,
  row_error      INTEGER NOT NULL DEFAULT 0,
  row_review     INTEGER NOT NULL DEFAULT 0,
  created_by     INTEGER NOT NULL,
  created_at     TEXT NOT NULL,
  committed_at   TEXT,
  UNIQUE (company_id, id),
  FOREIGN KEY (company_id, created_by) REFERENCES users(company_id, id)
);
CREATE INDEX ix_import_batches_list ON import_batches(company_id, created_at);
CREATE INDEX ix_import_batches_sha ON import_batches(company_id, file_sha256);

CREATE TABLE import_rows (
  id          INTEGER PRIMARY KEY,
  company_id  INTEGER NOT NULL,
  batch_id    INTEGER NOT NULL,
  line_no     INTEGER NOT NULL,
  global_no   TEXT,
  kind        TEXT NOT NULL CHECK (kind IN ('new', 'updated', 'error', 'review')),
  message     TEXT,
  diff_json   TEXT,
  FOREIGN KEY (company_id, batch_id) REFERENCES import_batches(company_id, id)
);
CREATE UNIQUE INDEX ux_import_rows_line ON import_rows(batch_id, line_no);

-- ===== 注文 =====

CREATE TABLE orders (
  id             INTEGER PRIMARY KEY,
  company_id     INTEGER NOT NULL REFERENCES companies(id),
  slip_no        TEXT NOT NULL,                  -- 受注伝票番号
  customer_code  TEXT,
  customer_name  TEXT,
  item_count     INTEGER NOT NULL DEFAULT 0,
  matched_count  INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  UNIQUE (company_id, slip_no),
  UNIQUE (company_id, id)
);

CREATE TABLE order_items (
  id                 INTEGER PRIMARY KEY,
  company_id         INTEGER NOT NULL,
  order_id           INTEGER NOT NULL,
  global_no          TEXT NOT NULL,
  barcode_global_no  TEXT NOT NULL,
  product_code       TEXT NOT NULL,
  product_name       TEXT NOT NULL DEFAULT '',
  quantity           INTEGER NOT NULL CHECK (quantity >= 1),
  required_scans     INTEGER NOT NULL DEFAULT 1 CHECK (required_scans >= 1),
  customer_code      TEXT,
  customer_name      TEXT,
  destination_id     INTEGER,
  destination_code   TEXT,
  destination_name   TEXT,
  customer_order_no  TEXT,
  location_id        INTEGER,
  location_code      TEXT NOT NULL,
  ssd                TEXT,                       -- メーカー出荷日 YYYY-MM-DD
  vrd                TEXT,                       -- ミスミ納期 YYYY-MM-DD
  order_date         TEXT,
  ship_method        TEXT,
  export_type        TEXT,
  unit_weight        REAL,
  total_weight       REAL,
  packing_line       TEXT,
  data_kind          TEXT,
  row_hash           TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'matched', 'review', 'cancelled', 'shipped')),
  scan_count         INTEGER NOT NULL DEFAULT 0 CHECK (scan_count >= 0),
  matched_at         TEXT,
  matched_staff_id   INTEGER,
  last_import_id     INTEGER NOT NULL,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  CHECK (scan_count <= required_scans),          -- 同時読み取りでも必要回数を超えて数えない
  UNIQUE (company_id, id),
  FOREIGN KEY (company_id, order_id) REFERENCES orders(company_id, id),
  FOREIGN KEY (company_id, destination_id) REFERENCES destinations(company_id, id),
  FOREIGN KEY (company_id, location_id) REFERENCES locations(company_id, id),
  FOREIGN KEY (company_id, matched_staff_id) REFERENCES staff(company_id, id),
  FOREIGN KEY (company_id, last_import_id) REFERENCES import_batches(company_id, id)
);
CREATE UNIQUE INDEX ux_items_global ON order_items(company_id, global_no);
CREATE UNIQUE INDEX ux_items_barcode ON order_items(company_id, barcode_global_no);
CREATE INDEX ix_items_ssd ON order_items(company_id, ssd, status);
CREATE INDEX ix_items_vrd_loc ON order_items(company_id, vrd, location_id);
CREATE INDEX ix_items_status ON order_items(company_id, status, ssd);
CREATE INDEX ix_items_product ON order_items(company_id, product_code);
CREATE INDEX ix_items_customer ON order_items(company_id, customer_code, ssd);
CREATE INDEX ix_items_destination ON order_items(company_id, destination_id, ssd);
CREATE INDEX ix_items_location ON order_items(company_id, location_id, ssd);
CREATE INDEX ix_items_order ON order_items(company_id, order_id);

-- ===== 作業・読み取り =====

CREATE TABLE work_sessions (
  id            INTEGER PRIMARY KEY,
  company_id    INTEGER NOT NULL,
  user_id       INTEGER NOT NULL,
  staff_id      INTEGER NOT NULL,
  staff_name    TEXT NOT NULL,                   -- 選んだ時点の氏名
  device_id     TEXT NOT NULL,
  device_label  TEXT,
  user_agent    TEXT,
  started_at    TEXT NOT NULL,
  ended_at      TEXT,
  UNIQUE (company_id, id),
  FOREIGN KEY (company_id, user_id) REFERENCES users(company_id, id),
  FOREIGN KEY (company_id, staff_id) REFERENCES staff(company_id, id)
);
CREATE INDEX ix_work_sessions_user ON work_sessions(company_id, user_id, ended_at);

CREATE TABLE scan_logs (
  id                 INTEGER PRIMARY KEY,
  company_id         INTEGER NOT NULL,
  client_scan_id     TEXT NOT NULL,              -- 画面が読み取りごとに作る ID（再送で二重記録しない）
  work_session_id    INTEGER NOT NULL,
  user_id            INTEGER NOT NULL,
  staff_id           INTEGER NOT NULL,
  staff_name         TEXT NOT NULL,              -- 読み取り時点の担当者名
  raw_value          TEXT NOT NULL,
  barcode            TEXT NOT NULL,
  input              TEXT NOT NULL DEFAULT 'scanner' CHECK (input IN ('scanner', 'manual')),
  order_item_id      INTEGER,
  result             TEXT NOT NULL CHECK (result IN ('ok', 'not_found', 'duplicate', 'over_quantity', 'review', 'error')),
  reason             TEXT,
  location_id        INTEGER,
  scanned_at         TEXT NOT NULL,
  client_scanned_at  TEXT,
  day                TEXT NOT NULL,              -- 日本時間の業務日
  device_id          TEXT NOT NULL,
  UNIQUE (company_id, id),
  FOREIGN KEY (company_id, work_session_id) REFERENCES work_sessions(company_id, id),
  FOREIGN KEY (company_id, order_item_id) REFERENCES order_items(company_id, id)
);
CREATE UNIQUE INDEX ux_scan_client ON scan_logs(company_id, client_scan_id);
CREATE INDEX ix_scan_day ON scan_logs(company_id, day, id);
CREATE INDEX ix_scan_staff ON scan_logs(company_id, staff_id, day);
CREATE INDEX ix_scan_result ON scan_logs(company_id, result, day);
CREATE INDEX ix_scan_item ON scan_logs(company_id, order_item_id);
CREATE INDEX ix_scan_barcode ON scan_logs(company_id, barcode);

CREATE TABLE scan_corrections (
  id           INTEGER PRIMARY KEY,
  company_id   INTEGER NOT NULL,
  scan_log_id  INTEGER NOT NULL,
  user_id      INTEGER NOT NULL,
  action       TEXT NOT NULL CHECK (action IN ('void')),
  reason       TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 500),
  created_at   TEXT NOT NULL,
  FOREIGN KEY (company_id, scan_log_id) REFERENCES scan_logs(company_id, id),
  FOREIGN KEY (company_id, user_id) REFERENCES users(company_id, id)
);
CREATE UNIQUE INDEX ux_corrections_void ON scan_corrections(scan_log_id) WHERE action = 'void';

CREATE TABLE daily_scan_stats (
  company_id   INTEGER NOT NULL,
  day          TEXT NOT NULL,
  staff_id     INTEGER NOT NULL,
  location_id  INTEGER NOT NULL,                 -- 置場不明は 0
  result       TEXT NOT NULL,
  count        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (company_id, day, staff_id, location_id, result)
) WITHOUT ROWID;

-- ===== 監査・運用 =====

CREATE TABLE audit_logs (
  id           INTEGER PRIMARY KEY,
  company_id   INTEGER NOT NULL,
  user_id      INTEGER,
  hs_user_id   INTEGER,
  action       TEXT NOT NULL,
  target_type  TEXT,
  target_id    TEXT,
  detail_json  TEXT,
  ip           TEXT,
  user_agent   TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX ix_audit_list ON audit_logs(company_id, created_at);

CREATE TABLE backup_runs (
  id               INTEGER PRIMARY KEY,
  kind             TEXT NOT NULL CHECK (kind IN ('daily_incremental', 'manual_full')),
  from_at          TEXT,
  to_at            TEXT,
  r2_prefix        TEXT,
  row_counts_json  TEXT,
  status           TEXT NOT NULL,
  error            TEXT,
  created_at       TEXT NOT NULL
);

-- ===== 書き換え・削除の拒否 =====

CREATE TRIGGER trg_scan_logs_no_update BEFORE UPDATE ON scan_logs BEGIN SELECT RAISE(ABORT, 'scan_logs is append-only'); END;
CREATE TRIGGER trg_scan_logs_no_delete BEFORE DELETE ON scan_logs BEGIN SELECT RAISE(ABORT, 'scan_logs is append-only'); END;
CREATE TRIGGER trg_corrections_no_update BEFORE UPDATE ON scan_corrections BEGIN SELECT RAISE(ABORT, 'scan_corrections is append-only'); END;
CREATE TRIGGER trg_corrections_no_delete BEFORE DELETE ON scan_corrections BEGIN SELECT RAISE(ABORT, 'scan_corrections is append-only'); END;
CREATE TRIGGER trg_audit_no_update BEFORE UPDATE ON audit_logs BEGIN SELECT RAISE(ABORT, 'audit_logs is append-only'); END;
CREATE TRIGGER trg_audit_no_delete BEFORE DELETE ON audit_logs BEGIN SELECT RAISE(ABORT, 'audit_logs is append-only'); END;
CREATE TRIGGER trg_companies_no_delete BEFORE DELETE ON companies BEGIN SELECT RAISE(ABORT, 'use status instead of delete'); END;
CREATE TRIGGER trg_users_no_delete BEFORE DELETE ON users BEGIN SELECT RAISE(ABORT, 'use status instead of delete'); END;
CREATE TRIGGER trg_staff_no_delete BEFORE DELETE ON staff BEGIN SELECT RAISE(ABORT, 'use status instead of delete'); END;
CREATE TRIGGER trg_locations_no_delete BEFORE DELETE ON locations BEGIN SELECT RAISE(ABORT, 'use status instead of delete'); END;
CREATE TRIGGER trg_destinations_no_delete BEFORE DELETE ON destinations BEGIN SELECT RAISE(ABORT, 'use status instead of delete'); END;
CREATE TRIGGER trg_orders_no_delete BEFORE DELETE ON orders BEGIN SELECT RAISE(ABORT, 'orders are never deleted'); END;
CREATE TRIGGER trg_items_no_delete BEFORE DELETE ON order_items BEGIN SELECT RAISE(ABORT, 'order_items are never deleted'); END;
CREATE TRIGGER trg_batches_no_update_committed BEFORE UPDATE ON import_batches WHEN OLD.status = 'committed'
BEGIN SELECT RAISE(ABORT, 'committed import batches are read-only'); END;

-- ===== 読み取りの数え上げ（docs/scan-matching.md §5） =====
-- 判定・記録・数え上げ・集計を scan_logs への 1 回の INSERT の中で完結させる。
-- 再送で INSERT が ON CONFLICT DO NOTHING になったときは行が入らないので、トリガーも動かない（二重に数えない）。

CREATE TRIGGER trg_scan_count AFTER INSERT ON scan_logs WHEN NEW.result = 'ok'
BEGIN
  UPDATE order_items
     SET scan_count       = scan_count + 1,
         status           = CASE WHEN scan_count + 1 >= required_scans THEN 'matched' ELSE status END,
         matched_at       = CASE WHEN scan_count + 1 >= required_scans THEN NEW.scanned_at ELSE matched_at END,
         matched_staff_id = CASE WHEN scan_count + 1 >= required_scans THEN NEW.staff_id ELSE matched_staff_id END,
         updated_at       = NEW.scanned_at
   WHERE company_id = NEW.company_id AND id = NEW.order_item_id;
  UPDATE orders
     SET matched_count = (SELECT COUNT(*) FROM order_items x WHERE x.company_id = orders.company_id AND x.order_id = orders.id AND x.status = 'matched')
   WHERE company_id = NEW.company_id
     AND id = (SELECT order_id FROM order_items WHERE company_id = NEW.company_id AND id = NEW.order_item_id);
END;

CREATE TRIGGER trg_scan_stats AFTER INSERT ON scan_logs
BEGIN
  INSERT INTO daily_scan_stats (company_id, day, staff_id, location_id, result, count)
  VALUES (NEW.company_id, NEW.day, NEW.staff_id, COALESCE(NEW.location_id, 0), NEW.result, 1)
  ON CONFLICT (company_id, day, staff_id, location_id, result) DO UPDATE SET count = count + 1;
END;

-- 正常だった読み取りを取り消したら、明細の数を戻す
CREATE TRIGGER trg_correction_void AFTER INSERT ON scan_corrections WHEN NEW.action = 'void'
BEGIN
  UPDATE order_items
     SET scan_count = scan_count - 1, status = 'pending', matched_at = NULL, matched_staff_id = NULL, updated_at = NEW.created_at
   WHERE company_id = NEW.company_id
     AND id = (SELECT order_item_id FROM scan_logs WHERE company_id = NEW.company_id AND id = NEW.scan_log_id AND result = 'ok')
     AND scan_count > 0;
  UPDATE orders
     SET matched_count = (SELECT COUNT(*) FROM order_items x WHERE x.company_id = orders.company_id AND x.order_id = orders.id AND x.status = 'matched')
   WHERE company_id = NEW.company_id
     AND id = (SELECT oi.order_id FROM order_items oi JOIN scan_logs s ON s.order_item_id = oi.id
                WHERE s.company_id = NEW.company_id AND s.id = NEW.scan_log_id);
END;
