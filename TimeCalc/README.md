# TimeCalc — 勤怠時間計算システム

株式会社ヒラノの勤怠時間計算システム。
Square タイムカードのエクスポート CSV を取り込み、自社ルールに基づいて
勤務時間・残業時間・早出時間を自動計算する。

## 技術構成

- **フロント/バック**: Next.js (App Router) + React + TypeScript + Tailwind CSS
- **DB**: SQLite（開発）→ PostgreSQL（本番想定）
- **ORM**: Prisma
- **認証**: JWT（jose）+ httpOnly Cookie、パスワードは bcrypt でハッシュ化

## セットアップ

```bash
npm install
npx prisma migrate dev   # DB作成（prisma/dev.db）
npm run db:seed          # 初期データ投入
npm run dev              # http://localhost:3000
```

### 初期ログイン（シードデータ）

| 社員番号 | パスワード | ロール |
|---|---|---|
| 0001 | admin123 | 管理者 |
| 0002 | password123 | 店長 |
| 0003 | password123 | 一般社員 |
| 0004 | password123 | アルバイト |

※本番運用前に必ずパスワードを変更すること。

## 主な機能（Phase 1）

- ログイン（社員番号またはメールアドレス＋パスワード）
- 権限管理（管理者・店長・一般社員・アルバイト）
- Square CSV 取込（UTF-16/UTF-8/Shift_JIS 自動判定、列マッピング設定、取込履歴）
- 勤務時間計算（夏季/冬季勤務・早出・残業・30分単位丸め）
- 勤怠一覧（社員・部署・月で検索）／社員詳細（日別一覧・勤怠修正）
- 月次集計 CSV 出力（集計・明細）
- 設定画面（勤務ルール・部署管理）

## 設計の要点

- **計算結果は DB に保存しない。** 打刻の生データ（出勤・退勤・休憩）だけを保存し、
  表示・出力のたびに設定値から計算する。設定変更だけで過去分も含めて
  勤務ルールを変更できる。
- 業務ロジックは `src/lib/attendance/` に純粋関数として分離
  （`calculator.ts` が計算の中核。`npm test` で単体テスト実行）。
- 権限は `src/lib/auth/roles.ts` に集約。画面・Server Action・API の
  すべてで `can()` / `requirePermission()` によるチェックを通す。

## 勤務ルール（初期値・設定画面から変更可能）

| 項目 | 値 |
|---|---|
| 夏季（4/1〜10/31） | 8:00〜18:00 |
| 冬季（11/1〜3/31） | 8:00〜16:00（16:00〜18:00 は通常勤務扱い） |
| 残業開始 | 18:00（割増率 25%） |
| 残業の丸め | 30分単位・切り捨て |
| 早出 | 始業前の勤務。計算対象の開始時刻は設定で変更可能 |

## Square CSV について

`samples/square-timecard-sample.csv` が実際のエクスポート形式のサンプル。

- UTF-16 LE（BOM付き）・タブ区切り
- 時刻は `8:19:25 JST` 形式（秒・タイムゾーン付き）
- 氏名は「姓」「名」の2列に分割
- 末尾の「合計」行は取込時に自動スキップされる

## Netlify へのデプロイ

Netlify はサーバーレスのため SQLite は使えない。本番 DB は PostgreSQL
（[Neon](https://neon.tech) 無料枠 / Railway など）を用意する。
ローカルは SQLite のまま、Netlify ビルド時に
`scripts/gen-postgres-schema.mjs` が PostgreSQL 用スキーマを自動生成して使う
（`netlify.toml` の `npm run netlify:build`）。

### 手順

1. **PostgreSQL を用意** — Neon などで DB を作成し、接続文字列を控える
2. **Netlify にサイト作成** — リポジトリを接続し、
   **Base directory を `TimeCalc`** に設定（モノレポのため必須。
   Build command / Publish directory は netlify.toml とプラグインが自動設定）
3. **環境変数を設定**（Site settings → Environment variables）
   - `DATABASE_URL` = PostgreSQL 接続文字列
   - `SESSION_SECRET` = 十分に長いランダム値（例: `openssl rand -base64 48`）
4. **デプロイ** — push すると自動ビルド。ビルド中に `prisma db push` で
   テーブルが自動作成される
5. **初期データ投入（初回のみ）** — ローカルから本番 DB に向けてシードを実行:

   ```powershell
   $env:DATABASE_URL = "<PostgreSQLの接続文字列>"
   npm run db:seed:prod
   npx prisma generate   # ローカル用(SQLite)クライアントに戻す
   ```

CLI 派なら `npx netlify-cli` でも可（`login` → `init` → `env:set` → `deploy --build --prod`）。

## 開発コマンド

```bash
npm run dev         # 開発サーバー
npm run build       # 本番ビルド
npm start           # 本番サーバー
npm test            # 単体テスト（vitest）
npm run db:migrate  # マイグレーション
npm run db:seed     # シード
```
