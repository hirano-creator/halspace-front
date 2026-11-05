# PARTS GATE

バーコードを使った部品照合・出荷確認システム。注文 CSV と実際の部品をバーコードで照合して、誤出荷・取り違えを防ぐ。誰がいつ何を確認したかを記録し、置場・履歴・分析を一つの画面で扱う。Space.app（HaLSpace）のアプリの一つで、最初の導入先は株式会社ヒラノ。

## 状態

STEP 5（CSV 取込）までローカルで完成。次は STEP 6（バーコード照合）。

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
