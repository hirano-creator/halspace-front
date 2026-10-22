# TENQ データベース設計（Cloudflare D1）

- 版: 0.1（第1段階・ドラフト）／作成日: 2026-10-22
- DB: Cloudflare D1（SQLite 互換）。開発 `tenq-db-dev` / 本番 `tenq-db` を分ける
- 変更は `api/migrations/NNNN_*.sql` のマイグレーションのみ。本番 DB を直接変更しない（deployment.md）

## 1. 共通ルール

| 項目 | ルール |
| --- | --- |
| 主キー | `id TEXT`（`crypto.randomUUID()`）。監査ログのみ `INTEGER PRIMARY KEY AUTOINCREMENT` |
| 日時 | `TEXT`、UTC の ISO 8601（`2026-10-22T01:23:45.678Z`） |
| 日付 | `TEXT`、`YYYY-MM-DD`（工場のタイムゾーンで決めた日付） |
| 真偽 | `INTEGER` 0/1 + `CHECK (x IN (0,1))` |
| 列挙 | `TEXT` + `CHECK (x IN (...))` |
| JSON | `TEXT`（`json_valid()` の CHECK） |
| 会社 | 業務テーブルはすべて `company_id INTEGER NOT NULL`（halspace-api の companies.id）。工場に属するものは `factory_id` も持つ |
| 作成・更新 | `created_at, created_by, updated_at, updated_by`（`*_by` は `users.id`） |
| 楽観ロック | 更新される行は `version INTEGER NOT NULL DEFAULT 1` |
| 削除 | 業務データは物理削除しない（状態・`deleted_at` で表す）。保存期間後の削除は operations.md の手続きで |
| 外部キー | D1 は外部キー制約を有効にして動く前提。第2段階のテストで制約違反が実際に弾かれることを確認する |

SQL は必ず prepared statement＋`bind()`。文字列連結で SQL を組み立てない。

## 2. ER 概要

```
factories ─┬─< user_factories >─ users ─< device_sessions
           ├─< areas ─< equipment（area_id）
           ├─< equipment ─┬─< equipment_qr_tokens
           │              ├─< inspections ─┬─< inspection_results >─ inspection_items
           │              │                └─< inspection_corrections
           │              └─< abnormalities ─┬─< corrective_actions
           │                                 └─< abnormality_events
           └─ (factory_id nullable) inspection_templates ─< inspection_template_versions ─< inspection_items
attachments（owner_type + owner_id で abnormalities / corrective_actions / inspection_results に付く）
audit_logs（追記専用）  system_settings（会社ごとの設定）
```

## 3. テーブル定義

### 3-1. factories（工場）

| カラム | 型 | 制約 | 説明 |
| --- | --- | --- | --- |
| id | TEXT | PK | |
| company_id | INTEGER | NOT NULL | 会社 |
| code | TEXT | NOT NULL | 工場コード（例: `F01`） |
| name | TEXT | NOT NULL | 工場名 |
| address | TEXT | | 所在地 |
| timezone | TEXT | NOT NULL DEFAULT 'Asia/Tokyo' | 点検日の判定に使う |
| working_days | TEXT | NOT NULL DEFAULT '1,2,3,4,5' | 稼働曜日（ISO: 1=月〜7=日） |
| status | TEXT | CHECK IN ('active','inactive') | |
| created_at / created_by / updated_at / updated_by / version | | | 共通 |

索引: `UNIQUE (company_id, code)`

### 3-2. users（TENQ 利用者）

Space.app のユーザーに TENQ 固有の情報を足したもの。氏名・メールは表示用の写し（正は halspace-api）。

| カラム | 型 | 制約 | 説明 |
| --- | --- | --- | --- |
| id | TEXT | PK | TENQ 内のユーザーID |
| hs_user_id | INTEGER | NOT NULL UNIQUE | halspace-api の users.id |
| company_id | INTEGER | NOT NULL | |
| name | TEXT | NOT NULL | 写し（ログインのたびに更新） |
| email | TEXT | | 写し |
| role | TEXT | CHECK IN ('worker','equipment_staff','factory_manager','system_admin') NULL | NULL = ロール未設定（何もできない） |
| status | TEXT | NOT NULL DEFAULT 'active' CHECK IN ('active','suspended') | TENQ 内の利用停止 |
| suspended_reason | TEXT | | 端末紛失など |
| last_seen_at | TEXT | | |
| created_at / updated_at / updated_by / version | | | 共通 |

索引: `(company_id, role)`

### 3-3. user_factories（所属工場）

| カラム | 型 | 制約 |
| --- | --- | --- |
| user_id | TEXT | FK users.id |
| factory_id | TEXT | FK factories.id |
| created_at / created_by | | |

主キー: `(user_id, factory_id)`。索引: `(factory_id)`

### 3-3b. device_sessions（端末のログイン記憶）

スマホでログインを 30 日記憶するための TENQ 独自のセッション（security.md §2-1）。トークン本体は保存せず、SHA-256 だけを持つ。

| カラム | 型 | 制約 | 説明 |
| --- | --- | --- | --- |
| id | TEXT | PK | |
| user_id | TEXT | NOT NULL FK users.id | |
| company_id | INTEGER | NOT NULL | |
| token_hash | TEXT | NOT NULL UNIQUE | 端末に保存したトークンの SHA-256 |
| device_label | TEXT | | 「iPhone / Safari」など（User-Agent から作る表示名） |
| created_at | TEXT | NOT NULL | Space.app でログインした日時 |
| expires_at | TEXT | NOT NULL | 作成から 30 日（`system_settings.device_login_days`） |
| last_used_at | TEXT | | 更新は 10 分に 1 回まで（行ロック・書き込み回数を抑える） |
| revoked_at / revoked_by / revoke_reason | TEXT | | 取り消し（紛失・退職・本人のログアウト） |

索引: `(user_id, revoked_at)`、`(expires_at)`

### 3-4. equipment（設備台帳）

| カラム | 型 | 制約 | 説明 |
| --- | --- | --- | --- |
| id | TEXT | PK | 設備ID（不変。名称・番号を変えても変わらない） |
| company_id | INTEGER | NOT NULL | |
| factory_id | TEXT | NOT NULL FK factories.id | |
| equipment_code | TEXT | NOT NULL | 設備番号（利用者が決める。変更可） |
| name | TEXT | NOT NULL | 設備名 |
| location | TEXT | | 設置場所 |
| category | TEXT | | 設備分類（プレス・旋盤 等。自由入力＋候補表示） |
| maker | TEXT | | メーカー |
| model | TEXT | | 型式 |
| manager_user_id | TEXT | FK users.id | 管理担当者 |
| area_id | TEXT | FK areas.id NULL | カード一覧で置くエリア（NULL = 「未配置」の枠） |
| board_order | INTEGER | NOT NULL DEFAULT 0 | エリア内のカードの並び順 |
| status | TEXT | NOT NULL CHECK IN ('active','stopped','retired') | 使用状態 |
| status_reason | TEXT | | 停止・廃止の理由 |
| frequency | TEXT | NOT NULL CHECK IN ('daily','weekly','monthly') | 点検頻度 |
| template_id | TEXT | FK inspection_templates.id | 割り当てた点検基準 |
| notes | TEXT | | 備考 |
| retired_at | TEXT | | |
| created_at / created_by / updated_at / updated_by / version | | | 共通 |

索引: `UNIQUE (factory_id, equipment_code)`、`(company_id, factory_id, status)`、`(manager_user_id)`、`(area_id, board_order)`

### 3-4b. areas（エリア：カード一覧の枠）

PC のエリア別カード一覧（requirements F-7・F-12）の枠。運用開始後に管理画面で作る・変える。設備台帳の `location`（設置場所の文字情報）とは別物で、こちらは「画面上の置き場所」。

| カラム | 型 | 制約 | 説明 |
| --- | --- | --- | --- |
| id | TEXT | PK | |
| company_id | INTEGER | NOT NULL | |
| factory_id | TEXT | NOT NULL FK factories.id | 工場ごとに別の配置 |
| name | TEXT | NOT NULL | 「A棟 プレスライン」など |
| grid_row | INTEGER | NOT NULL DEFAULT 0 | 画面上の行（0 始まり） |
| grid_col | INTEGER | NOT NULL DEFAULT 0 | 画面上の列（0 始まり。全体は 12 列の格子） |
| col_span | INTEGER | NOT NULL DEFAULT 4 CHECK (col_span BETWEEN 2 AND 12) | 横幅（何列分か） |
| sort_order | INTEGER | NOT NULL DEFAULT 0 | スマホなど 1 列表示のときの並び順 |
| status | TEXT | NOT NULL DEFAULT 'active' CHECK IN ('active','inactive') | 無効化しても設備の割り当ては残す（表示は「未配置」へ） |
| created_at / created_by / updated_at / updated_by / version | | | 共通 |

索引: `UNIQUE (factory_id, name)`、`(factory_id, status, grid_row, grid_col)`

配置は格子（12 列）で持つ。自由な座標にしないのは、画面幅が変わっても崩れず、スマホでは `sort_order` 順の 1 列表示に落とせるため。配置図画像を背景にする方式は Phase 2 で、そのときは `areas` に座標列を追加する。

### 3-5. equipment_qr_tokens（QR コード）

再発行の履歴を持つため設備と分ける。QR には `token` だけを載せる。

| カラム | 型 | 制約 | 説明 |
| --- | --- | --- | --- |
| token | TEXT | PK | ランダム 16 文字（base32、約 80bit）。秘密ではないが推測しにくくする |
| equipment_id | TEXT | NOT NULL FK equipment.id | |
| company_id | INTEGER | NOT NULL | |
| issued_at / issued_by | TEXT | NOT NULL | |
| revoked_at / revoked_by | TEXT | | 再発行で無効化した日時 |
| revoke_reason | TEXT | | 紛失・汚損 等 |

索引: `(equipment_id, revoked_at)`。有効なものは設備ごとに1件（`UNIQUE (equipment_id) WHERE revoked_at IS NULL`）

### 3-6. inspection_templates（点検基準）

| カラム | 型 | 制約 | 説明 |
| --- | --- | --- | --- |
| id | TEXT | PK | |
| company_id | INTEGER | NOT NULL | |
| factory_id | TEXT | FK factories.id NULL | NULL = 会社共通 |
| name | TEXT | NOT NULL | 例: 「プレス機 日常点検」 |
| description | TEXT | | |
| current_version_id | TEXT | FK inspection_template_versions.id | 現在使う版 |
| status | TEXT | CHECK IN ('active','archived') | |
| created_at / created_by / updated_at / updated_by / version | | | 共通 |

### 3-7. inspection_template_versions（点検基準の版）

公開した版は変更しない。変更は新しい版を作る。

| カラム | 型 | 制約 | 説明 |
| --- | --- | --- | --- |
| id | TEXT | PK | |
| template_id | TEXT | NOT NULL FK | |
| version_no | INTEGER | NOT NULL | 1, 2, 3 … |
| status | TEXT | CHECK IN ('draft','published','superseded') | |
| change_reason | TEXT | | 変更理由（版 2 以降は必須） |
| created_at / created_by | TEXT | | |
| published_at / published_by | TEXT | | |

索引: `UNIQUE (template_id, version_no)`

### 3-8. inspection_items（点検項目）

版に属する。公開済みの版の項目は変更不可（トリガーで拒否）。

| カラム | 型 | 制約 | 説明 |
| --- | --- | --- | --- |
| id | TEXT | PK | |
| template_version_id | TEXT | NOT NULL FK | |
| sort_order | INTEGER | NOT NULL | |
| group_label | TEXT | | 外観・安全装置 等の区分 |
| label | TEXT | NOT NULL | 項目名 |
| criteria | TEXT | | 判定基準（例: 「カバーに破損・外れがないこと」） |
| required | INTEGER | NOT NULL DEFAULT 1 | 必須 |
| allow_na | INTEGER | NOT NULL DEFAULT 0 | 対象外を許可 |

索引: `(template_version_id, sort_order)`

### 3-9. inspections（点検）

| カラム | 型 | 制約 | 説明 |
| --- | --- | --- | --- |
| id | TEXT | PK | |
| company_id | INTEGER | NOT NULL | |
| factory_id | TEXT | NOT NULL FK | 点検時点の工場（設備の移設に備えて写しを持つ） |
| equipment_id | TEXT | NOT NULL FK | |
| template_version_id | TEXT | NOT NULL FK | 点検基準の版 |
| period_key | TEXT | NOT NULL | `2026-10-22` / `2026-W43` / `2026-10` |
| inspection_date | TEXT | NOT NULL | 点検日（工場のタイムゾーン） |
| status | TEXT | NOT NULL CHECK IN ('in_progress','completed','voided') | 点検中 / 完了 / 取消 |
| inspector_user_id | TEXT | NOT NULL FK users.id | 点検者（引き継いだら最終の点検者） |
| started_at | TEXT | NOT NULL | |
| completed_at | TEXT | | |
| overall_result | TEXT | CHECK IN ('ok','ng') | 1 項目でも異常なら ng |
| comment | TEXT | | 全体コメント |
| current_revision | INTEGER | NOT NULL DEFAULT 1 | 最新の結果の版 |
| completion_key | TEXT | UNIQUE | 完了 API の冪等キー |
| voided_reason / voided_by / voided_at | TEXT | | 取消 |
| created_at / updated_at / version | | | 共通 |

索引:
- `UNIQUE (equipment_id, period_key) WHERE status <> 'voided'` — 二重登録防止の要
- `(company_id, factory_id, inspection_date)` — ダッシュボード・検索
- `(inspector_user_id, inspection_date)` — 点検者別
- `(equipment_id, inspection_date)` — 設備別履歴

### 3-10. inspection_results（点検結果）

追加のみ（UPDATE・DELETE はトリガーで拒否）。訂正は revision を増やして行を追加する。

| カラム | 型 | 制約 | 説明 |
| --- | --- | --- | --- |
| id | TEXT | PK | |
| inspection_id | TEXT | NOT NULL FK | |
| revision | INTEGER | NOT NULL | 1 = 初回、2 以降 = 訂正 |
| item_id | TEXT | NOT NULL FK inspection_items.id | |
| judgment | TEXT | NOT NULL CHECK IN ('ok','ng','na') | 正常 / 異常 / 対象外 |
| note | TEXT | | 項目コメント |
| abnormality_id | TEXT | FK abnormalities.id NULL | 関連する異常報告 |
| created_at / created_by | TEXT | NOT NULL | |

索引: `UNIQUE (inspection_id, revision, item_id)`、`(abnormality_id)`

### 3-11. inspection_corrections（点検記録の訂正履歴）

| カラム | 型 | 制約 | 説明 |
| --- | --- | --- | --- |
| id | TEXT | PK | |
| inspection_id | TEXT | NOT NULL FK | |
| from_revision / to_revision | INTEGER | NOT NULL | |
| reason | TEXT | NOT NULL | 訂正理由（必須） |
| diff_json | TEXT | NOT NULL CHECK json_valid | 変わった項目の前後 |
| corrected_by / corrected_at | TEXT | NOT NULL | |

索引: `(inspection_id)`

### 3-12. abnormalities（異常報告）

| カラム | 型 | 制約 | 説明 |
| --- | --- | --- | --- |
| id | TEXT | PK | |
| company_id | INTEGER | NOT NULL | |
| factory_id | TEXT | NOT NULL FK | |
| equipment_id | TEXT | NOT NULL FK | |
| inspection_id | TEXT | FK NULL | 点検から報告した場合 |
| inspection_item_id | TEXT | FK inspection_items.id NULL | 点検のどの項目で見つかったか（0002 で追加。点検結果は追記専用のため異常側に持つ） |
| report_no | TEXT | NOT NULL | 表示用の通し番号（例: `F01-2026-0042`） |
| title | TEXT | NOT NULL | 異常内容（要約） |
| description | TEXT | | 詳細 |
| found_at | TEXT | NOT NULL | 発見日時 |
| reported_by | TEXT | NOT NULL FK users.id | 報告者 |
| severity | TEXT | NOT NULL CHECK IN ('low','medium','high') | 危険度 |
| emergency_action | TEXT | | 応急処置 |
| equipment_stopped | INTEGER | NOT NULL DEFAULT 0 | 報告時に使用停止したか |
| status | TEXT | NOT NULL CHECK IN ('reported','assigned','in_progress','corrected','verified','closed') | |
| assignee_user_id | TEXT | FK users.id | 対応担当者 |
| due_date | TEXT | | 対応期限 |
| corrected_date | TEXT | | 対応完了日 |
| verified_by / verified_at | TEXT | | 再確認者 |
| approved_by / approved_at | TEXT | | 承認者 |
| created_at / updated_at / updated_by / version | | | 共通 |

索引: `UNIQUE (company_id, report_no)`、`(inspection_id, inspection_item_id)`、`(company_id, factory_id, status)`、`(status, due_date)`（期限超過）、`(equipment_id, found_at)`、`(assignee_user_id, status)`

### 3-13. corrective_actions（是正処置）

1 件の異常に複数回の処置（仮修理 → 本修理など）を記録できる。

| カラム | 型 | 制約 | 説明 |
| --- | --- | --- | --- |
| id | TEXT | PK | |
| abnormality_id | TEXT | NOT NULL FK | |
| kind | TEXT | CHECK IN ('temporary','permanent','other') | 応急 / 恒久 / その他 |
| cause | TEXT | | 原因 |
| description | TEXT | NOT NULL | 修理・是正内容 |
| performed_by | TEXT | FK users.id | 実施者 |
| performed_at | TEXT | | 実施日 |
| created_at / created_by / updated_at / updated_by / version | | | 共通 |

索引: `(abnormality_id)`

### 3-14. abnormality_events（異常の状態遷移履歴）

追加のみ。

| カラム | 型 | 制約 | 説明 |
| --- | --- | --- | --- |
| id | TEXT | PK | |
| abnormality_id | TEXT | NOT NULL FK | |
| from_status | TEXT | | |
| to_status | TEXT | NOT NULL | |
| comment | TEXT | | 差し戻し理由など |
| actor_user_id | TEXT | NOT NULL | |
| created_at | TEXT | NOT NULL | |

索引: `(abnormality_id, created_at)`

### 3-15. attachments（添付ファイル）

| カラム | 型 | 制約 | 説明 |
| --- | --- | --- | --- |
| id | TEXT | PK | |
| company_id | INTEGER | NOT NULL | |
| owner_type | TEXT | NOT NULL CHECK IN ('abnormality','corrective_action','inspection_result') | |
| owner_id | TEXT | NOT NULL | |
| r2_key | TEXT | NOT NULL UNIQUE | `company/<id>/<yyyy>/<uuid>.jpg` |
| content_type | TEXT | NOT NULL CHECK IN ('image/jpeg','image/png','image/webp') | |
| size_bytes | INTEGER | NOT NULL CHECK (size_bytes <= 10485760) | |
| sha256 | TEXT | | 改ざん確認用 |
| original_name | TEXT | | 表示時はエスケープ |
| uploaded_by / uploaded_at | TEXT | NOT NULL | |
| deleted_at / deleted_by | TEXT | | 論理削除（R2 の実体は保存期間後に削除） |

索引: `(owner_type, owner_id)`

### 3-16. audit_logs（監査ログ）

追加のみ（トリガーで UPDATE・DELETE を拒否）。

| カラム | 型 | 制約 | 説明 |
| --- | --- | --- | --- |
| id | INTEGER | PK AUTOINCREMENT | |
| company_id | INTEGER | NOT NULL | |
| factory_id | TEXT | | |
| actor_user_id | TEXT | | TENQ ユーザー（ログイン失敗などは NULL） |
| actor_hs_user_id | INTEGER | | |
| action | TEXT | NOT NULL | `equipment.update`、`inspection.correct`、`export.csv` … |
| target_type / target_id | TEXT | | |
| detail_json | TEXT | CHECK json_valid | 前後の値・条件など |
| ip | TEXT | | `CF-Connecting-IP` |
| user_agent | TEXT | | 先頭 255 文字 |
| created_at | TEXT | NOT NULL | |

索引: `(company_id, created_at)`、`(target_type, target_id)`、`(actor_user_id, created_at)`

### 3-17. system_settings（システム設定）

| カラム | 型 | 制約 | 説明 |
| --- | --- | --- | --- |
| company_id | INTEGER | NOT NULL | |
| key | TEXT | NOT NULL | |
| value_json | TEXT | NOT NULL CHECK json_valid | |
| updated_at / updated_by | TEXT | | |

主キー: `(company_id, key)`。主な key: `retention_years`、`photo_max_count`、`high_severity_message`、`export_roles`、`reauth_hours`、`qr_base_url`、`device_login_days`（既定 30）、`board_refresh_seconds`（既定 30）、`late_threshold`（「遅れ」と判定する時刻。例: 始業前 = 09:00）

## 4. 保護用トリガー（第2段階で作成）

```sql
-- 監査ログは更新・削除できない
CREATE TRIGGER audit_logs_no_update BEFORE UPDATE ON audit_logs
BEGIN SELECT RAISE(ABORT, 'audit_logs is append-only'); END;
CREATE TRIGGER audit_logs_no_delete BEFORE DELETE ON audit_logs
BEGIN SELECT RAISE(ABORT, 'audit_logs is append-only'); END;
```

同様に `inspection_results`・`inspection_corrections`・`abnormality_events` の UPDATE/DELETE、公開済み版の `inspection_items` の UPDATE/DELETE、`inspections` の completed → in_progress への戻しを拒否する。

保存期間後の正規の削除が必要になったときは、トリガーを外すマイグレーションを手続き（operations.md）に沿って別途作る。

## 5. 主なクエリと索引の対応

| 用途 | クエリの形 | 使う索引 |
| --- | --- | --- |
| 今日の未点検 | 稼働中の設備 LEFT JOIN 当期間の点検 WHERE 点検なし | equipment(company_id, factory_id, status)、inspections 一意索引 |
| QR から設備 | equipment_qr_tokens WHERE token = ? | PK |
| 設備別履歴 | inspections WHERE equipment_id = ? ORDER BY inspection_date DESC LIMIT ? | (equipment_id, inspection_date) |
| 期限超過 | abnormalities WHERE status IN (...) AND due_date < ? | (status, due_date) |
| 期間指定の監査一覧 | inspections WHERE company_id=? AND factory_id IN (...) AND inspection_date BETWEEN ? AND ? | (company_id, factory_id, inspection_date) |

一覧はキーセットページング（`WHERE (inspection_date, id) < (?, ?) ORDER BY inspection_date DESC, id DESC LIMIT 50`）。

## 6. マイグレーション運用

```
npx wrangler d1 migrations create tenq-db-dev <名前>      # ファイル作成
npx wrangler d1 migrations apply tenq-db-dev --local      # ローカルへ適用
npx wrangler d1 migrations apply tenq-db-dev --remote     # 開発用リモート DB
# 本番（tenq-db）への適用は deployment.md の手順とオーナー承認後のみ
```

- 適用済みのマイグレーションファイルは書き換えない。直しは新しいファイルで
- 列の削除・型変更は「新列追加 → 移行 → 旧列を使わなくする」の段階で行う
- 本番適用前に D1 Time Travel の復元地点（ブックマーク）を記録する
