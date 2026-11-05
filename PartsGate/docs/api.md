# PARTS GATE API 設計

- 版: 0.1（STEP 3 設計・ドラフト）／作成日: 2026-11-05
- ベース URL: `https://partsgate-api.<アカウント>.workers.dev/api`（開発は `http://127.0.0.1:8787/api`）

## 1. 共通の約束

| 項目 | 内容 |
| --- | --- |
| 認証 | `Authorization: Bearer <space_token>`。全 API で必須（`/api/health` を除く） |
| 会社 | **リクエストに company_id を書かない**。送られても無視し、ログイン情報から決める |
| 形式 | JSON（UTF-8）。日時は UTC の ISO 文字列、業務日は `YYYY-MM-DD` |
| 成功 | `{ "data": … }`、一覧は `{ "data": [...], "next_cursor": "…" | null }` |
| 失敗 | `{ "message": "担当者を選んでから読み取ってください。", "code"?: "STAFF_NOT_SELECTED", "errors"?: { "項目": "理由" } }`（TENQ と同じ形。入力エラーは 422 で項目ごとの `errors`） |
| ページ送り | `?limit=50&cursor=<前回の next_cursor>`。limit は最大 200 |
| 更新 | 編集系の PUT は `version` を送る。違えば 409「ほかの人が先に変更しました。画面を開き直してください」 |
| 二重送信 | 登録系の POST は `Idempotency-Key`（読み取りは本文の `client_scan_id`）。同じキーなら前回の結果を返す |
| CORS | 許可オリジンは `https://space-apps.pages.dev`（開発はローカルの Vite）のみ |

### エラーコード

| HTTP | code | 画面の案内 |
| --- | --- | --- |
| 400 / 422 | `VALIDATION` | どの項目がなぜだめか（422 の `errors` に項目ごと） |
| 401 | `UNAUTHENTICATED` | 「ログインし直してください」 |
| 403 | `FORBIDDEN` / `APP_NOT_ENABLED` / `COMPANY_SUSPENDED` | 「この操作は管理者だけができます」など |
| 404 | `NOT_FOUND` | 他社の ID を指定した場合もこれ（存在を知らせない） |
| 409 | `CONFLICT` / `STAFF_NOT_SELECTED` / `SESSION_ENDED` | 「担当者を選び直してください」など |
| 413 | `TOO_LARGE` | 「ファイルが大きすぎます（10MB まで）」 |
| 429 | `RATE_LIMITED` | 「少し待ってからやり直してください」 |
| 502 | `AUTH_UPSTREAM` | 「ログインの確認先に接続できません」 |
| 503 | `DB_UNAVAILABLE` | 「データベースに接続できません。しばらくしてから…」 |

## 2. 一覧

権限: 一般＝一般ユーザー以上、管理＝PARTS GATE 管理者、運営＝HaLSpace の運営者（Space.app の `is_operator`）

| 区分 | メソッド・パス | 権限 | 内容 |
| --- | --- | --- | --- |
| 認証 | GET `/me` | 一般 | 自分・会社・ロール・設定の要約 |
| 企業 | GET `/admin/companies` | 運営 | PARTS GATE を使う会社の一覧 |
| | PUT `/admin/companies/:id` | 運営 | 会社情報・利用状態 |
| 設定 | GET / PUT `/settings` | 管理 | 照合ルール・CSV 列の対応 |
| ユーザー | GET `/users`、PUT `/users/:id`（`role`・`status`） | 管理 | ロール・利用状態の変更（自分の管理者権限は外せない。最後の管理者は外せない） |
| 担当者 | GET `/staff`、POST `/staff`、PUT `/staff/:id` | 一覧は一般、他は管理 | |
| 作業 | POST `/work-sessions` | 一般 | 担当者を選ぶ `{ staff_id, device_id, device_label }` → `{ id, staff }` |
| | POST `/work-sessions/:id/end` | 一般 | 担当者変更・終了 |
| 照合 | POST `/scans` | 一般 | `{ work_session_id, client_scan_id, raw_value, client_scanned_at, input }` → 判定結果と明細の要約 |
| | GET `/scans/today-summary` | 一般 | 自分（作業セッション）の今日の件数 |
| 履歴 | GET `/scan-logs` | 一般 | 日付（必須・最長 3 か月）・担当者・商品コード・得意先・納品先・置場・結果・バーコードで検索 |
| | POST `/scan-logs/:id/corrections` | 管理 | 取消など `{ action, reason }` |
| 注文 | GET `/orders/items` | 一般 | 明細の検索（出荷日の範囲は必須） |
| | GET `/orders/items/:id` | 一般 | 明細詳細＋読み取り履歴＋取込履歴 |
| | POST `/orders/items/:id/resolve` | 管理 | 要確認の明細を照合済みにする・取消にする（理由必須） |
| 取込 | POST `/imports/lookup` | 管理 | `{ keys: [グローバル番号…] }`（500 件まで）→ 既存明細の row_hash・状態 |
| | POST `/imports` | 管理 | multipart（ファイル本体＋ファイル名・文字コード・件数）→ 取込回 ID |
| | POST `/imports/:id/rows` | 管理 | 200 行まで → 行ごとの区分 |
| | POST `/imports/:id/commit` | 管理 | 確定 |
| | GET `/imports`、GET `/imports/:id`、GET `/imports/:id/rows` | 管理 | 取込履歴・行ごとの結果 |
| | GET `/imports/:id/file` | 管理 | 元ファイル（R2 から権限確認して返す） |
| 置場 | GET `/locations`、POST、PUT `/locations/:id` | 一覧は一般、他は管理 | 利用停止は PUT で `status` |
| 納品先 | GET `/destinations`、POST、PUT `/destinations/:id`、POST `/destinations/bulk` | 一覧は一般、他は管理 | bulk は取込画面からのまとめて登録（Q-7） |
| 集計 | GET `/dashboard?day=` | 一般 | 本日の注文件数・読み取り件数・正常・エラー・未確認・担当者別・置場別・得意先別・日別 |
| 分析 | GET `/analytics/scans?from=&to=&group=day|month|staff|location|result` | 管理 | 集計表から |
| | GET `/analytics/orders?from=&to=&group=customer|product|location` | 管理 | 出荷日の範囲で明細を集計 |
| | GET `/analytics/unmatched?from=&to=` | 一般 | 未確認の一覧 |
| 出力 | GET `/exports/<種類>?…&cursor=` | 管理（未確認一覧は一般） | 500 件ずつの JSON。画面で CSV に組み立てる |
| 監査 | GET `/audit-logs` | 管理 | |
| 運用 | GET `/health` | なし | 稼働確認（DB に 1 回問い合わせ） |

## 3. 照合 API の例

```http
POST /api/scans
Authorization: Bearer …
{ "work_session_id": 812, "client_scan_id": "d8c1…", "raw_value": "5P000000000001",
  "client_scanned_at": "2026-11-05T01:23:45.678Z", "input": "scanner" }
```

```json
{ "data": {
    "scan_id": 50123, "result": "ok", "message": "正常",
    "barcode": "5P000000000001",
    "item": { "id": 3321, "product_code": "MVSHM-XXXXXXX-XXX-XXXXX", "product_name": "MEVIY SHEET METAL",
              "quantity": 1, "customer_name": "サンプル工業（株）", "destination_name": "サンプル工業（株）第1工場",
              "ssd": "2026-11-04", "vrd": "2026-11-05", "location": { "code": "0053", "name": "東日本" },
              "export_type": "D", "slip_no": "AB0000000001", "slip_progress": { "matched": 3, "total": 9 } },
    "staff_name": "山田", "scanned_at": "2026-11-05T01:23:45.901Z",
    "previous": null
} }
```

重複のときは `previous` に最初に照合した日時・担当者を入れる。

## 4. 回数制限

- 照合: 作業セッションごとに 1 秒 10 回まで（リーダーの連続読み取りを妨げない範囲）
- 取込: 会社ごとに同時に 1 回分だけ（`uploading` が他にあれば 409）
- 制限は D1 に書かず、Worker のメモリで大まかに数える（無料枠の書き込みを使わないため。厳密さより負荷の抑制が目的）
