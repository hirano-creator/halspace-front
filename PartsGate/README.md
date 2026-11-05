# PARTS GATE

バーコードを使った部品照合・出荷確認システム。注文 CSV と実際の部品をバーコードで照合して、誤出荷・取り違えを防ぐ。誰がいつ何を確認したかを記録し、置場・履歴・分析を一つの画面で扱う。Space.app（HaLSpace）のアプリの一つで、最初の導入先は株式会社ヒラノ。

## 状態

STEP 8（セキュリティ・性能・バックアップ）までローカルで完成。次は STEP 9（本番公開）。実機の USB リーダーでの確認と、専用の Cloudflare アカウントが残っている。

## 開発の始め方（ローカルだけで動く）

```
cd PartsGate
npm install
npm run db:reset:local   # ローカル D1 を作り直す（マイグレーション＋ダミーデータ）。開発サーバーを止めてから実行する
npm run dev              # API（http://127.0.0.1:8787）と画面（http://localhost:5174/PartsGate/app/）
```

画面のログインに「開発用ログイン」のボタンが出る（ローカルのダミーデータ。会社 A・会社 B の管理者と一般）。本番のビルドには含まれない。

| コマンド | 内容 |
| --- | --- |
| `npm test` | 単体・API 結合テスト（Workers の中でローカル D1 を使う。遠隔の D1 には触れない） |
| `npm run typecheck` / `npm run lint` | 型チェック / ESLint |
| `npm run build` | 画面を `PartsGate/app/` にビルド |

構成: `shared/`（画面と API で共有する権限表・型）、`api/`（Workers + Hono + D1。`migrations/`・`seed/`・`test/`）、`web/`（React + Vite + Tailwind）。

## バックアップと復元

| 方法 | いつ | 中身 | 戻し方 |
| --- | --- | --- | --- |
| D1 Time Travel | 自動（無料は 7 日分） | DB 全体 | `wrangler d1 time-travel restore <DB> --timestamp=<日時> --env production`（直近の誤操作） |
| 差分バックアップ | 毎日 日本時間 3 時（Cron。`api/src/lib/backup.ts`） | 前回以降に増えた・変わった行を R2 の `backups/<日付>/<kind>-<ID>/*.ndjson` に | 下の「差分から戻す」 |
| 全体バックアップ | 月 1 回、手作業 | `wrangler d1 export <DB> --remote --env production --output full-YYYYMM.sql` を R2 と手元に保存 | マイグレーションしていない空の D1 に `wrangler d1 execute <DB> --file full-YYYYMM.sql`（データのあとにトリガーを作る順なので、読み取りを二重に数えない） |

差分から戻す（全体バックアップのあとの変更を足す）:

1. R2 から、全体バックアップより後の `backups/<日付>/incremental-<ID>/` を日付順にダウンロードする（`wrangler r2 object get`）
2. `node scripts/restore.mjs --out restore.sql <フォルダ1> <フォルダ2> ...`（古い順。manifest の行数と合わないと止まる）
3. 全体バックアップを流した D1 に `wrangler d1 execute <DB> --file restore.sql`（数え上げのトリガーを外して流し、最後に作り直す）
4. 件数を確かめる（`scripts/perf/` のような SELECT で、元の件数と比べる）

復元の手順は `api/test/backup.test.ts`（全体 → 差分で全部の表が一致）と、`wrangler d1 export` → 空の D1 に流して件数・トリガー・索引が一致することで確認済み（2026-11-05）。**流す先の DB は必ず人が確かめる**（本番に流すのはオーナーの承認後）。

## 性能テスト（ローカルだけ）

```
cd PartsGate/api
npx wrangler d1 migrations apply DB --local --env dev --persist-to .wrangler/perf
npx wrangler d1 execute DB --local --env dev --persist-to .wrangler/perf --file=seed/dev-seed.sql
node ../scripts/perf/make-perf-sql.mjs perf.sql 360000
npx wrangler d1 execute DB --local --env dev --persist-to .wrangler/perf --file=perf.sql   # 明細 36 万・読み取り 47 万（約 40 秒）
node ../scripts/perf/measure-sql.mjs                                                      # SQL の時間と実行計画
npx wrangler dev --env dev --port 8788 --persist-to .wrangler/perf                         # 別の窓で
node ../scripts/perf/measure-api.mjs                                                       # API の応答時間
```

遠隔の D1 では行わない（D1 の読み取り上限はアカウント全体で共有。TENQ の停止事故の再発防止）。

## 設計書

| 文書 | 内容 |
| --- | --- |
| [docs/requirements.md](docs/requirements.md) | 確定事項・実 CSV の分析・指示書からの変更点・未確定事項（Q-n） |
| [docs/architecture.md](docs/architecture.md) | 構成図・技術スタック・無料プランに収める設計・容量見積もり |
| [docs/database.md](docs/database.md) | ER 図・テーブル定義・索引・トリガー |
| [docs/api.md](docs/api.md) | API 一覧・共通形式・エラー |
| [docs/csv-import.md](docs/csv-import.md) | CSV 取込仕様 |
| [docs/scan-matching.md](docs/scan-matching.md) | バーコード照合仕様・同時読み取り |
| [docs/security.md](docs/security.md) | 企業間データ分離・認証・権限 |
| [docs/screens.md](docs/screens.md) | 画面一覧・読み取り画面 |
| [docs/development-plan.md](docs/development-plan.md) | 工程・テスト計画・バックアップ・課題 |

環境構築・公開・バックアップ・復元の手順は、STEP 4 以降で実装に合わせてここに書く。
