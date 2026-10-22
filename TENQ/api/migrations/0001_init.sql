-- TENQ 初期スキーマ（docs/database.md と一致させること）
-- 日時は UTC の ISO 8601 文字列、日付は工場のタイムゾーンでの YYYY-MM-DD。
-- 適用済みのこのファイルは書き換えない。変更は 0002_*.sql 以降で行う。

-- ===== 工場 =====
CREATE TABLE factories (
  id            TEXT PRIMARY KEY,
  company_id    INTEGER NOT NULL,
  code          TEXT NOT NULL,
  name          TEXT NOT NULL,
  address       TEXT,
  timezone      TEXT NOT NULL DEFAULT 'Asia/Tokyo',
  working_days  TEXT NOT NULL DEFAULT '1,2,3,4,5',
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at    TEXT NOT NULL,
  created_by    TEXT,
  updated_at    TEXT NOT NULL,
  updated_by    TEXT,
  version       INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX ux_factories_code ON factories(company_id, code);

-- ===== 利用者（Space.app のユーザーに TENQ 固有の情報を足したもの） =====
CREATE TABLE users (
  id                TEXT PRIMARY KEY,
  hs_user_id        INTEGER NOT NULL UNIQUE,
  company_id        INTEGER NOT NULL,
  name              TEXT NOT NULL,
  email             TEXT,
  role              TEXT CHECK (role IN ('worker','equipment_staff','factory_manager','system_admin')),
  status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  suspended_reason  TEXT,
  last_seen_at      TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  updated_by        TEXT,
  version           INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX ix_users_company_role ON users(company_id, role);

CREATE TABLE user_factories (
  user_id     TEXT NOT NULL REFERENCES users(id),
  factory_id  TEXT NOT NULL REFERENCES factories(id),
  created_at  TEXT NOT NULL,
  created_by  TEXT,
  PRIMARY KEY (user_id, factory_id)
);
CREATE INDEX ix_user_factories_factory ON user_factories(factory_id);

-- ===== 端末のログイン記憶（トークン本体は保存せず SHA-256 のみ） =====
CREATE TABLE device_sessions (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id),
  company_id     INTEGER NOT NULL,
  token_hash     TEXT NOT NULL UNIQUE,
  device_label   TEXT,
  created_at     TEXT NOT NULL,
  expires_at     TEXT NOT NULL,
  last_used_at   TEXT,
  revoked_at     TEXT,
  revoked_by     TEXT,
  revoke_reason  TEXT
);
CREATE INDEX ix_device_sessions_user ON device_sessions(user_id, revoked_at);
CREATE INDEX ix_device_sessions_expires ON device_sessions(expires_at);

-- ===== エリア（PC のカード一覧の枠） =====
CREATE TABLE areas (
  id          TEXT PRIMARY KEY,
  company_id  INTEGER NOT NULL,
  factory_id  TEXT NOT NULL REFERENCES factories(id),
  name        TEXT NOT NULL,
  grid_row    INTEGER NOT NULL DEFAULT 0 CHECK (grid_row >= 0),
  grid_col    INTEGER NOT NULL DEFAULT 0 CHECK (grid_col BETWEEN 0 AND 11),
  col_span    INTEGER NOT NULL DEFAULT 4 CHECK (col_span BETWEEN 2 AND 12),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at  TEXT NOT NULL,
  created_by  TEXT,
  updated_at  TEXT NOT NULL,
  updated_by  TEXT,
  version     INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX ux_areas_name ON areas(factory_id, name);
CREATE INDEX ix_areas_layout ON areas(factory_id, status, grid_row, grid_col);

-- ===== 点検基準（テンプレート）と版・項目 =====
CREATE TABLE inspection_templates (
  id                  TEXT PRIMARY KEY,
  company_id          INTEGER NOT NULL,
  factory_id          TEXT REFERENCES factories(id),
  name                TEXT NOT NULL,
  description         TEXT,
  current_version_id  TEXT,
  status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_at          TEXT NOT NULL,
  created_by          TEXT,
  updated_at          TEXT NOT NULL,
  updated_by          TEXT,
  version             INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX ix_templates_company ON inspection_templates(company_id, status);

CREATE TABLE inspection_template_versions (
  id             TEXT PRIMARY KEY,
  template_id    TEXT NOT NULL REFERENCES inspection_templates(id),
  version_no     INTEGER NOT NULL CHECK (version_no >= 1),
  status         TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','superseded')),
  change_reason  TEXT,
  created_at     TEXT NOT NULL,
  created_by     TEXT,
  published_at   TEXT,
  published_by   TEXT,
  CHECK (version_no = 1 OR status = 'draft' OR change_reason IS NOT NULL)
);
CREATE UNIQUE INDEX ux_template_versions ON inspection_template_versions(template_id, version_no);

CREATE TABLE inspection_items (
  id                   TEXT PRIMARY KEY,
  template_version_id  TEXT NOT NULL REFERENCES inspection_template_versions(id),
  sort_order           INTEGER NOT NULL,
  group_label          TEXT,
  label                TEXT NOT NULL,
  criteria             TEXT,
  required             INTEGER NOT NULL DEFAULT 1 CHECK (required IN (0,1)),
  allow_na             INTEGER NOT NULL DEFAULT 0 CHECK (allow_na IN (0,1))
);
CREATE INDEX ix_items_version ON inspection_items(template_version_id, sort_order);

-- ===== 設備台帳 =====
CREATE TABLE equipment (
  id               TEXT PRIMARY KEY,
  company_id       INTEGER NOT NULL,
  factory_id       TEXT NOT NULL REFERENCES factories(id),
  equipment_code   TEXT NOT NULL,
  name             TEXT NOT NULL,
  location         TEXT,
  category         TEXT,
  maker            TEXT,
  model            TEXT,
  manager_user_id  TEXT REFERENCES users(id),
  area_id          TEXT REFERENCES areas(id),
  board_order      INTEGER NOT NULL DEFAULT 0,
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','stopped','retired')),
  status_reason    TEXT,
  frequency        TEXT NOT NULL DEFAULT 'daily' CHECK (frequency IN ('daily','weekly','monthly')),
  template_id      TEXT REFERENCES inspection_templates(id),
  notes            TEXT,
  retired_at       TEXT,
  created_at       TEXT NOT NULL,
  created_by       TEXT,
  updated_at       TEXT NOT NULL,
  updated_by       TEXT,
  version          INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX ux_equipment_code ON equipment(factory_id, equipment_code);
CREATE INDEX ix_equipment_scope ON equipment(company_id, factory_id, status);
CREATE INDEX ix_equipment_manager ON equipment(manager_user_id);
CREATE INDEX ix_equipment_area ON equipment(area_id, board_order);

-- ===== QR コード（再発行の履歴を持つ） =====
CREATE TABLE equipment_qr_tokens (
  token          TEXT PRIMARY KEY CHECK (length(token) = 16),
  equipment_id   TEXT NOT NULL REFERENCES equipment(id),
  company_id     INTEGER NOT NULL,
  issued_at      TEXT NOT NULL,
  issued_by      TEXT,
  revoked_at     TEXT,
  revoked_by     TEXT,
  revoke_reason  TEXT
);
CREATE INDEX ix_qr_equipment ON equipment_qr_tokens(equipment_id, revoked_at);
CREATE UNIQUE INDEX ux_qr_active ON equipment_qr_tokens(equipment_id) WHERE revoked_at IS NULL;

-- ===== 点検 =====
CREATE TABLE inspections (
  id                   TEXT PRIMARY KEY,
  company_id           INTEGER NOT NULL,
  factory_id           TEXT NOT NULL REFERENCES factories(id),
  equipment_id         TEXT NOT NULL REFERENCES equipment(id),
  template_version_id  TEXT NOT NULL REFERENCES inspection_template_versions(id),
  period_key           TEXT NOT NULL,
  inspection_date      TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','completed','voided')),
  inspector_user_id    TEXT NOT NULL REFERENCES users(id),
  started_at           TEXT NOT NULL,
  completed_at         TEXT,
  overall_result       TEXT CHECK (overall_result IN ('ok','ng')),
  comment              TEXT,
  current_revision     INTEGER NOT NULL DEFAULT 1,
  completion_key       TEXT UNIQUE,
  voided_reason        TEXT,
  voided_by            TEXT,
  voided_at            TEXT,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  version              INTEGER NOT NULL DEFAULT 1,
  CHECK (status <> 'completed' OR (completed_at IS NOT NULL AND overall_result IS NOT NULL)),
  CHECK (status <> 'voided' OR voided_reason IS NOT NULL)
);
-- 二重登録防止の要: 同じ設備・同じ点検期間の有効な点検は1件だけ
CREATE UNIQUE INDEX ux_inspections_period ON inspections(equipment_id, period_key) WHERE status <> 'voided';
CREATE INDEX ix_inspections_scope_date ON inspections(company_id, factory_id, inspection_date);
CREATE INDEX ix_inspections_inspector ON inspections(inspector_user_id, inspection_date);
CREATE INDEX ix_inspections_equipment ON inspections(equipment_id, inspection_date);

-- ===== 異常報告 =====
CREATE TABLE abnormalities (
  id                 TEXT PRIMARY KEY,
  company_id         INTEGER NOT NULL,
  factory_id         TEXT NOT NULL REFERENCES factories(id),
  equipment_id       TEXT NOT NULL REFERENCES equipment(id),
  inspection_id      TEXT REFERENCES inspections(id),
  report_no          TEXT NOT NULL,
  title              TEXT NOT NULL,
  description        TEXT,
  found_at           TEXT NOT NULL,
  reported_by        TEXT NOT NULL REFERENCES users(id),
  severity           TEXT NOT NULL CHECK (severity IN ('low','medium','high')),
  emergency_action   TEXT,
  equipment_stopped  INTEGER NOT NULL DEFAULT 0 CHECK (equipment_stopped IN (0,1)),
  status             TEXT NOT NULL DEFAULT 'reported' CHECK (status IN ('reported','assigned','in_progress','corrected','verified','closed')),
  assignee_user_id   TEXT REFERENCES users(id),
  due_date           TEXT,
  corrected_date     TEXT,
  verified_by        TEXT REFERENCES users(id),
  verified_at        TEXT,
  approved_by        TEXT REFERENCES users(id),
  approved_at        TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  updated_by         TEXT,
  version            INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX ux_abnormalities_no ON abnormalities(company_id, report_no);
CREATE INDEX ix_abnormalities_scope ON abnormalities(company_id, factory_id, status);
CREATE INDEX ix_abnormalities_due ON abnormalities(status, due_date);
CREATE INDEX ix_abnormalities_equipment ON abnormalities(equipment_id, found_at);
CREATE INDEX ix_abnormalities_assignee ON abnormalities(assignee_user_id, status);

-- ===== 点検結果（追加のみ。訂正は revision を増やして追加） =====
CREATE TABLE inspection_results (
  id              TEXT PRIMARY KEY,
  inspection_id   TEXT NOT NULL REFERENCES inspections(id),
  revision        INTEGER NOT NULL CHECK (revision >= 1),
  item_id         TEXT NOT NULL REFERENCES inspection_items(id),
  judgment        TEXT NOT NULL CHECK (judgment IN ('ok','ng','na')),
  note            TEXT,
  abnormality_id  TEXT REFERENCES abnormalities(id),
  created_at      TEXT NOT NULL,
  created_by      TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_results ON inspection_results(inspection_id, revision, item_id);
CREATE INDEX ix_results_abnormality ON inspection_results(abnormality_id);

CREATE TABLE inspection_corrections (
  id             TEXT PRIMARY KEY,
  inspection_id  TEXT NOT NULL REFERENCES inspections(id),
  from_revision  INTEGER NOT NULL,
  to_revision    INTEGER NOT NULL CHECK (to_revision = from_revision + 1),
  reason         TEXT NOT NULL CHECK (length(trim(reason)) > 0),
  diff_json      TEXT NOT NULL CHECK (json_valid(diff_json)),
  corrected_by   TEXT NOT NULL,
  corrected_at   TEXT NOT NULL
);
CREATE INDEX ix_corrections_inspection ON inspection_corrections(inspection_id);

-- ===== 是正処置・異常の状態遷移履歴 =====
CREATE TABLE corrective_actions (
  id              TEXT PRIMARY KEY,
  abnormality_id  TEXT NOT NULL REFERENCES abnormalities(id),
  kind            TEXT NOT NULL DEFAULT 'permanent' CHECK (kind IN ('temporary','permanent','other')),
  cause           TEXT,
  description     TEXT NOT NULL,
  performed_by    TEXT REFERENCES users(id),
  performed_at    TEXT,
  created_at      TEXT NOT NULL,
  created_by      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  updated_by      TEXT,
  version         INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX ix_corrective_abnormality ON corrective_actions(abnormality_id);

CREATE TABLE abnormality_events (
  id              TEXT PRIMARY KEY,
  abnormality_id  TEXT NOT NULL REFERENCES abnormalities(id),
  from_status     TEXT,
  to_status       TEXT NOT NULL,
  comment         TEXT,
  actor_user_id   TEXT NOT NULL,
  created_at      TEXT NOT NULL
);
CREATE INDEX ix_abnormality_events ON abnormality_events(abnormality_id, created_at);

-- ===== 添付ファイル（実体は R2） =====
CREATE TABLE attachments (
  id             TEXT PRIMARY KEY,
  company_id     INTEGER NOT NULL,
  owner_type     TEXT NOT NULL CHECK (owner_type IN ('abnormality','corrective_action','inspection_result')),
  owner_id       TEXT NOT NULL,
  r2_key         TEXT NOT NULL UNIQUE,
  content_type   TEXT NOT NULL CHECK (content_type IN ('image/jpeg','image/png','image/webp')),
  size_bytes     INTEGER NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 10485760),
  sha256         TEXT,
  original_name  TEXT,
  uploaded_by    TEXT NOT NULL,
  uploaded_at    TEXT NOT NULL,
  deleted_at     TEXT,
  deleted_by     TEXT
);
CREATE INDEX ix_attachments_owner ON attachments(owner_type, owner_id);

-- ===== 監査ログ（追記専用） =====
CREATE TABLE audit_logs (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id        INTEGER NOT NULL,
  factory_id        TEXT,
  actor_user_id     TEXT,
  actor_hs_user_id  INTEGER,
  action            TEXT NOT NULL,
  target_type       TEXT,
  target_id         TEXT,
  detail_json       TEXT CHECK (detail_json IS NULL OR json_valid(detail_json)),
  ip                TEXT,
  user_agent        TEXT,
  created_at        TEXT NOT NULL
);
CREATE INDEX ix_audit_company ON audit_logs(company_id, created_at);
CREATE INDEX ix_audit_target ON audit_logs(target_type, target_id);
CREATE INDEX ix_audit_actor ON audit_logs(actor_user_id, created_at);

-- ===== システム設定 =====
CREATE TABLE system_settings (
  company_id  INTEGER NOT NULL,
  key         TEXT NOT NULL,
  value_json  TEXT NOT NULL CHECK (json_valid(value_json)),
  updated_at  TEXT,
  updated_by  TEXT,
  PRIMARY KEY (company_id, key)
);

-- ===== 記録を書き換えさせないトリガー =====
-- 保存期間後の正規の削除が必要になったら、operations.md §5 の手続きで別のマイグレーションを作る。

CREATE TRIGGER trg_audit_logs_no_update BEFORE UPDATE ON audit_logs
BEGIN SELECT RAISE(ABORT, 'audit_logs is append-only'); END;
CREATE TRIGGER trg_audit_logs_no_delete BEFORE DELETE ON audit_logs
BEGIN SELECT RAISE(ABORT, 'audit_logs is append-only'); END;

CREATE TRIGGER trg_results_no_update BEFORE UPDATE ON inspection_results
BEGIN SELECT RAISE(ABORT, 'inspection_results is append-only'); END;
CREATE TRIGGER trg_results_no_delete BEFORE DELETE ON inspection_results
BEGIN SELECT RAISE(ABORT, 'inspection_results is append-only'); END;

CREATE TRIGGER trg_corrections_no_update BEFORE UPDATE ON inspection_corrections
BEGIN SELECT RAISE(ABORT, 'inspection_corrections is append-only'); END;
CREATE TRIGGER trg_corrections_no_delete BEFORE DELETE ON inspection_corrections
BEGIN SELECT RAISE(ABORT, 'inspection_corrections is append-only'); END;

CREATE TRIGGER trg_events_no_update BEFORE UPDATE ON abnormality_events
BEGIN SELECT RAISE(ABORT, 'abnormality_events is append-only'); END;
CREATE TRIGGER trg_events_no_delete BEFORE DELETE ON abnormality_events
BEGIN SELECT RAISE(ABORT, 'abnormality_events is append-only'); END;

-- 点検は削除しない（誤りは voided で取り消す）。完了した点検を点検中へ戻さない
CREATE TRIGGER trg_inspections_no_delete BEFORE DELETE ON inspections
BEGIN SELECT RAISE(ABORT, 'inspections cannot be deleted; use status voided'); END;
CREATE TRIGGER trg_inspections_no_reopen BEFORE UPDATE OF status ON inspections
WHEN OLD.status = 'completed' AND NEW.status = 'in_progress'
BEGIN SELECT RAISE(ABORT, 'completed inspection cannot be reopened'); END;

-- 公開済みの版の点検項目は変えない（変更は新しい版で）
CREATE TRIGGER trg_items_no_insert_published BEFORE INSERT ON inspection_items
WHEN (SELECT status FROM inspection_template_versions WHERE id = NEW.template_version_id) <> 'draft'
BEGIN SELECT RAISE(ABORT, 'items of a published version are immutable'); END;
CREATE TRIGGER trg_items_no_update_published BEFORE UPDATE ON inspection_items
WHEN (SELECT status FROM inspection_template_versions WHERE id = OLD.template_version_id) <> 'draft'
BEGIN SELECT RAISE(ABORT, 'items of a published version are immutable'); END;
CREATE TRIGGER trg_items_no_delete_published BEFORE DELETE ON inspection_items
WHEN (SELECT status FROM inspection_template_versions WHERE id = OLD.template_version_id) <> 'draft'
BEGIN SELECT RAISE(ABORT, 'items of a published version are immutable'); END;
