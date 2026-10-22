# TENQ 技術構成・システム設計

- 版: 0.1（第1段階・ドラフト）／作成日: 2026-10-22
- 前提: [requirements.md](requirements.md)。未確定事項は requirements.md §10 の番号（Q-n）で参照する

## 1. 現状調査の結果（2026-10-22）

| 項目 | 調査結果 | TENQ への影響 |
| --- | --- | --- |
| 作業フォルダ | `c:\dev\my-programming\TENQ` は空 | 新規作成。既存ファイルの上書きなし |
| Git | ルートは `c:\dev\my-programming`（HaLSpace モノレポ、リモート halspace-front）。現在ブランチ `feat/cloudflare-migration`。作業ツリーに他アプリの未コミット変更が多数 | コミット時は `git add TENQ/...` のようにファイル指定。`git add -A` 禁止 |
| フロント配信 | Cloudflare Pages プロジェクト `space-apps`（https://space-apps.pages.dev）。リポジトリ直下をビルドなしで静的配信。**main への push のみ本番** | TENQ の画面も同じオリジンの `/TENQ/` 配下に置けば Space.app のログインを引き継げる |
| 既存アプリ | solid / whatsno / meetlog / space はビルドなしの HTML/JS。共通認証は `solid/assets/js/auth.js`、トークンは sessionStorage の `space_token` / `space_user`（タブごとに独立） | TENQ も同じキーを使う |
| 認証 API | Laravel（`c:\laragon\www\solid-api`、本番 Railway `halspace-api-production.up.railway.app`）。Sanctum の Bearer トークン、`GET /api/auth/me` が `id / role / company_id / apps_enabled` を返す。メール OTP の2段階認証あり。**トークンの有効期限は無期限（`sanctum.expiration = null`）** | TENQ の API はこのトークンを検証して利用者を特定する（§4） |
| アプリ登録 | アプリキーの登録簿はバックエンド `App\Support\SpaceApps::ALL`、フロント `space/assets/js/space.js` の `APP_CATALOG`、管理画面 `space/admin.html` の3か所 | `tenq` を3か所に追加する作業が必要（TENQ 外の変更。第3段階で別途承認をもらう） |
| 過去の教訓 | affect_CRM・TimeCalc は Next.js+Prisma を Workers に載せ、バンドル上限（当時 3MiB）と Worker のハングで Railway に移行した | TENQ は Next.js / Prisma を使わず、Workers 上は軽量ルーター＋D1 の素の SQL にする |

公式ドキュメントで確認した上限（2026-10-22 時点。変わるので本番前に再確認する）:

| サービス | 無料プラン | 有料プラン（Workers Paid） |
| --- | --- | --- |
| Workers バンドル | 64 MiB（非圧縮のみが対象。gzip 値は参考） | 同左 |
| Workers 起動時間 | グローバルスコープの実行 1 秒以内 | 同左 |
| Workers CPU 時間 | **1 リクエスト 10ms** | 既定 30 秒（最大 5 分） |
| Workers リクエスト | 10 万/日 | 上限なし（従量） |
| Workers サブリクエスト | 50 / 回 | 10,000 / 回 |
| D1 DB サイズ | 500 MB / DB、アカウント計 5 GB | 10 GB / DB |
| D1 クエリ数 | 50 / 回 | 1,000 / 回 |
| D1 Time Travel（復元） | 7 日 | 30 日 |
| D1 その他 | 1 行・文字列 2 MB、SQL 文 100 KB、バインド変数 100 個 | 同左 |
| R2 | 10 GB-月、Class A 100 万/月、Class B 1,000 万/月、エグレス無料 | 従量 |

## 2. 全体構成（案 A・2026-10-22 決定）

```
スマホ / PC のブラウザ
   │  https://space-apps.pages.dev/TENQ/app/   ← 画面（React をビルドした静的ファイル）
   │       sessionStorage: space_token / space_user（Space.app と共通）
   │
   ├─ ログイン ──────────→ halspace-api（Railway・Laravel）  POST /api/auth/login, MFA
   │
   └─ 業務 API（Bearer） ─→ tenq-api（Cloudflare Workers）
                              │  ① トークン検証: halspace-api GET /api/auth/me（結果を短時間キャッシュ）
                              │  ② TENQ ロール・所属工場・利用停止を D1 で確認
                              ├─ D1  tenq-db       … 台帳・点検・異常・監査ログ
                              └─ R2  tenq-files    … 写真（非公開。Worker 経由で権限確認して配信）
```

役割分担:

- **Space.app（halspace-api）**: 「この人は誰か」「会社はどこか」「TENQ を契約・利用できるか」。アカウントの作成・パスワード・2段階認証・停止
- **TENQ（tenq-api + D1）**: 「TENQ の中で何ができるか（TENQ ロール・所属工場）」と、点検に関わる全データ

### 2-1. 案 A を推す理由

1. 指示書のインフラ候補（Workers / D1 / R2）に沿い、TENQ のデータを独立した DB に分けられる（他アプリの障害・マイグレーションの影響を受けない）
2. ログインを共通にすることで、Space.app のアプリとして契約・個人単位のアプリ設定（`effectiveApps()`）・2段階認証・アカウント停止がそのまま効く
3. 同じオリジンに画面を置くので、Space.app から TENQ へ移ってもログインし直さなくてよい

### 2-2. 案 A の弱点と対策

| 弱点 | 対策 |
| --- | --- |
| Railway（halspace-api）が止まると TENQ も使えない | /auth/me の結果を Worker 内で 60 秒キャッシュ。障害時は紙の点検表に切り替える手順（operations.md） |
| 毎リクエストの /auth/me が halspace-api の負荷になる（2026-07 の Sanctum 行ロック障害の前例） | トークンの SHA-256 をキーにキャッシュ。画面側で API の並列乱発をしない |
| Sanctum トークンが無期限 | TENQ 側でも「最終確認から N 時間で再ログイン」を設定可能にする。根本対策（有効期限の設定）は Space.app 側の課題として記録（security.md） |
| 画面とAPIが別オリジン（pages.dev と workers.dev） | CORS を許可オリジン限定で設定。Cookie を使わず Bearer なので CSRF の対象外。必要なら Pages Functions で同一オリジン中継に切り替えられる |

### 2-3. 検討した他案

- **案 B: solid-api（Laravel / MySQL on Railway）に TENQ の API を追加** — 既存アプリと同じ作りで認証連携は最も簡単。ただし指示書の Cloudflare 中心の方針から外れ、TENQ の監査記録が他アプリと同じ DB・同じデプロイに乗る。Q-1 で案 A が却下された場合の代替
- **案 C: TENQ 専用の独立認証（Workers 内でパスワード管理）** — Space.app のアプリとしての一体感がなく、パスワードハッシュは無料プランの CPU 10ms を超えやすい。不採用

## 3. 技術スタック

| 層 | 採用 | 理由・注意 |
| --- | --- | --- |
| 画面 | React 19 + TypeScript 5.9 + Vite 8 | 指示どおり。UI ライブラリは入れず、素の CSS（CSS 変数＋画面ごとの CSS ファイル） |
| ルーティング | ハッシュ方式（`#/equipment/...`） | 共有の Pages は SPA のフォールバックを持たないため。ハッシュはサーバーログに残らない利点もある |
| QR 生成 | `qrcode-generator`（依存なし・小型）を QR 画面だけで遅延読み込み | 候補。第3段階でサイズを比較して決める |
| QR 読み取り | `BarcodeDetector`（対応ブラウザ）→ 非対応（iOS Safari 等）は `jsqr` を遅延読み込み | TimeCalc で実績あり |
| API | Cloudflare Workers + Hono 4.13 | Hono は小さく（数十 KB）Workers 向け。Next.js / Prisma は使わない |
| 入力検証 | 自前の小さな検証関数、または `valibot`（tree-shaking が効く） | zod は大きいので避ける。第2段階で決定 |
| DB | Cloudflare D1（SQLite）、SQL は prepared statement＋バインドのみ | ORM なし。マイグレーションは `wrangler d1 migrations` |
| ファイル | Cloudflare R2（バインディング経由） | 写真は端末側で縮小してから送る |
| テスト | Vitest 4.1（`@cloudflare/vitest-plugin` で D1 込みの API テスト。旧名 vitest-pool-workers は非推奨）、Playwright 1.61（E2E・PC とスマホ表示） | 開発専用。本番バンドルに入れない。TypeScript 7 は周辺ツールの対応待ちのため 5.9 系 |
| 管理 | Git、Wrangler、npm workspaces | |

依存を1つ追加するたびに「なぜ必要か・サイズ・代替」を PR / コミットに書く（CLAUDE.md）。

## 4. 認証・認可の流れ

1. ログイン画面（`/TENQ/app/#/login`）で halspace-api の `/auth/login` を呼ぶ（2段階認証の画面も TENQ 側に持つ。手順は `space/assets/js/mfa.js` と揃える）
2. 成功したら sessionStorage に `space_token` / `space_user` を保存（他アプリと同じ形式）
3. TENQ の API 呼び出しは `Authorization: Bearer <space_token>`
4. tenq-api のミドルウェア:
   1. トークンの SHA-256 をキーにキャッシュを引く。なければ halspace-api `/auth/me` を呼ぶ（タイムアウト 5 秒）
   2. 401 → 401 を返す（画面はログインへ）。`apps_enabled` に `tenq` がない → 403
   3. D1 の `users` を `hs_user_id` で引く。なければ作成（ロール未設定。Q-13 の初期 system_admin 判定のみ例外）
   4. `users.status = suspended` → 403
   5. リクエストに `{ user, companyId, role, factoryIds }` を載せて各ハンドラへ
5. 各ハンドラは**必ず** `companyId` と `factoryIds` で絞った SQL を使う（共通関数 `scope()` を通し、手書きの WHERE 漏れを防ぐ。HaLSpace で会社スコープ漏れの前例あり）
6. 操作ごとの権限は `can(user, action, resource)` の1か所に集約し、画面側も同じ表（requirements §3-2）から生成した定義を使う

端末のログイン記憶（2026-10-22 決定。security.md §2-1）: ミドルウェアは Bearer に `space_token` のほか、TENQ 独自の記憶トークン（`tenq_device_token`、D1 `device_sessions` で照合）も受け付ける。記憶トークンのときは halspace-api に問い合わせず、D1 の `users.status` と期限・取り消しだけで判定する。

QR から開いた場合: `#/q/<token>` → 端末に記憶トークンがあればそのまま `/api/qr/<token>` で設備を解決して点検表へ（**ログイン操作なし**）→ 記憶がなければ QR トークンを sessionStorage に一時保存してログインへ → ログイン後に元の設備へ戻る。

## 4-3. QR に印字する URL（2026-10-22 決定）

```
https://space-apps.pages.dev/TENQ/q/#<QRトークン>
```

- `TENQ/q/index.html` は**QR 専用の転送ページ**（数行の静的 HTML）。`#` 以降のトークンを読み、アプリ本体の `/TENQ/app/#/q/<トークン>` へ移動するだけ
- アプリ本体のパスや画面の作りを変えても、転送先を書き換えれば印刷済みの QR はそのまま使える。**`TENQ/q/` の場所は今後変えない**（フォルダ名 `TENQ` の変更・大文字小文字の変更も不可。Pages はパスの大文字小文字を区別する）
- トークンを `#` の後ろに置くので、サーバーのアクセスログに残らない
- 将来、独自ドメインに移る場合も space-apps.pages.dev の転送ページは残す

## 4-2. PC のエリア別カード一覧（2026-10-22 決定）

- 画面: `#/board`。工場を選ぶと、`areas`（12 列の格子）の配置どおりに枠を並べ、各枠に `equipment.area_id` の設備カードを `board_order` 順に表示
- API: `GET /api/board?factory=<id>` が「エリア一覧＋設備ごとの今日の状態（遅れ / 異常あり / 点検中 / 未点検 / 完了 / 停止中）＋未対応異常の件数」を1回で返す（D1 クエリ 3〜4 本を `batch` で）。30 秒ごとに再取得し、変わったカードだけ描き直す
- 状態は「今日の点検期間（period_key）の inspections」と `equipment.status`、`late_threshold` から API 側で決める（画面で判定しない）
- 配置の編集（S-15）: 同じ画面の「配置を編集」で編集モードに切り替え、枠とカードをドラッグ。保存は `PUT /api/areas/layout` でまとめて送り、楽観ロックで同時編集を検出する。ドラッグは標準の Pointer Events で実装し、ライブラリを入れない

## 5. フォルダ構成（予定）

```
TENQ/
├── CLAUDE.md / README.md
├── docs/                    設計書（本書など）
├── package.json             npm workspaces（web, api）とチェック用スクリプト
├── web/                     画面（React + Vite）
│   ├── index.html
│   ├── src/
│   │   ├── main.tsx / App.tsx / router.ts
│   │   ├── api/             fetch ラッパー（Bearer 付与・タイムアウト・GET のみ再試行）
│   │   ├── auth/            ログイン・MFA・セッション
│   │   ├── pages/           画面（S-01〜S-14）。画面単位で遅延読み込み
│   │   ├── components/      共通部品（ヘッダー、ロゴ、判定ボタン 等）
│   │   ├── shared/          権限表・定数（api と共有する型は ../shared から）
│   │   └── styles/
│   └── vite.config.ts       base: '/TENQ/app/'、出力先は ../app
├── api/                     tenq-api（Cloudflare Workers）
│   ├── src/
│   │   ├── index.ts         Hono アプリ・ルート定義
│   │   ├── middleware/      認証・CORS・エラー・監査ログ
│   │   ├── routes/          equipment / inspections / abnormalities / exports …
│   │   ├── domain/          権限判定、状態遷移、期間計算、CSV
│   │   └── db/              SQL とスコープ関数
│   ├── migrations/          D1 マイグレーション（0001_init.sql …）
│   ├── test/
│   └── wrangler.toml        env.dev / env.production を分ける（ID のみ。秘密情報は書かない）
├── shared/                  web と api で共有する型・権限表・状態遷移表
├── e2e/                     Playwright
├── scripts/                 check-bundle-size.mjs など
└── app/                     web のビルド成果物（Pages で配信。§6 の決定次第）
```

## 6. 画面の配信方法（要決定）

共有 Pages プロジェクト `space-apps` はビルド手順を持たない。React のビルド成果物を配信する方法は次のどれか。

| 方法 | 長所 | 短所 |
| --- | --- | --- |
| ① ビルド成果物 `TENQ/app/` を Git にコミット（推奨） | Pages の設定を変えずに済み、他アプリに影響しない | 生成物がリポジトリに入る。コミット前のビルド忘れに注意（チェックスクリプトで防ぐ） |
| ② Pages にビルドコマンドを設定 | 生成物をコミットしない | 共有プロジェクト全体の設定変更。失敗すると SOLID・What'sNo の配信まで止まる |
| ③ TENQ 専用の Pages / Workers Static Assets（別オリジン） | 独立 | ログインがオリジンをまたぐため SSO チケットが必要（a.a と同じ苦労） |

いずれも本番反映はオーナーの承認後。独自ドメインにする場合（Q-4）は③に近い構成になり、ログイン引き継ぎの設計を見直す。

## 7. 容量・コスト見積もり

前提: 1社 100 台、1台 15 項目、毎日点検、異常 1 日 5 件・写真 2 枚（各 400KB）。

| 対象 | 1 年あたり | 判断 |
| --- | --- | --- |
| D1（点検結果 約 55 万行＋索引） | 約 100〜150 MB | 無料の 500 MB で 3〜4 年。複数社で使うなら有料（10 GB）へ |
| R2（写真） | 約 1.5 GB | 無料 10 GB で数年 |
| Workers リクエスト | 1 日数千件 | 無料の 10 万/日で足りる |
| Workers CPU | 通常の API は数 ms。**大きな CSV 出力・集計は 10ms を超える可能性** | 本番前に Workers Paid（月 5 米ドル〜、D1 有料枠を含む）の要否を判断（Q-12）。それまでは出力を分割して処理する設計にする |

課金を伴う変更（有料プランへの切替・独自ドメイン）はオーナーの承認なしに行わない。

## 8. 容量最適化の方針

- Worker の非圧縮バンドルは **1 MiB 以内**（社内目標）。2 MiB を超えたら原因を調べて docs/deployment.md の記録欄に書く
- 確認: `npm run check:size`（中身は `wrangler deploy --dry-run --outdir dist` の Total Upload を読み取り、閾値を超えたら失敗）
- 画面は画面単位で `React.lazy` 分割。QR 生成・読み取り・印刷は該当画面だけで読み込む
- 初回表示 JS（gzip）200 KB 以内を目標
- D1: 一覧は必ず `LIMIT`＋カーソル（`(created_at, id)`）でページング。ダッシュボードの集計は索引が効くクエリに限る。1 リクエストのクエリ数は無料枠の 50 を超えない（`db.batch` でまとめる）
- R2: Worker で画像を変換しない。端末側で縮小し、Worker はサイズと形式の確認・保存だけ

## 9. 主な処理の設計メモ

### 9-1. 点検期間（period_key）

工場のタイムゾーンで計算する。`daily` → `2026-10-22`、`weekly` → `2026-W43`（ISO 週）、`monthly` → `2026-10`。稼働曜日外の日は daily の対象外。

### 9-2. 二重登録防止

- `inspections` に「同じ設備・同じ period_key で voided 以外は1件」の部分一意索引
- 点検開始 API は既存の点検中があればそれを返す（新規作成しない）
- 完了 API は `Idempotency-Key`（画面で生成した UUID）を `inspections.completion_key` に保存し、同じキーの再送は前回の結果を返す
- 楽観ロック: 更新系は `version` を受け取り、`WHERE version = ?` で更新できなければ 409

### 9-3. 記録の訂正

`inspection_results` は版（revision）付きで追加のみ。訂正は新しい revision の行を追加し、`inspection_corrections` に理由・訂正者・前後差分を残す。`inspections.current_revision` が最新版を指す。

### 9-4. 写真アップロード

画面で JPEG に再エンコード（長辺 2048px、品質 0.8）→ `POST /api/attachments`（本体は 10 MB 以下）→ Worker が Content-Length・先頭バイト（マジックナンバー）・Content-Type を確認 → R2 に `company/<id>/<yyyy>/<uuid>.jpg` で保存 → `attachments` に登録。表示は `GET /api/attachments/:id`（権限確認後に R2 から返す。公開 URL は作らない）。

### 9-5. CSV 出力

API が UTF-8 BOM＋CRLF でストリーム出力。数式インジェクション対策は requirements F-8。大量出力は期間を区切る（上限 1 回 1 万行、超える場合は分割を案内）。

## 10. ロゴ・表記

- 表記は「TENQ」、サブタイトル「Smart Inspection System」、読み「テンク」
- ロゴは SVG 1 ファイル（画像ライブラリ不使用）。四角い枠の中にチェックマークを組み合わせた単純な図形＋「TENQ」の文字。既存の商標・ロゴに似せない
- favicon / PWA アイコン（192・512・apple-touch）は同じ SVG から作る
