# TimeCalc — 勤怠時間計算システム

株式会社ヒラノの勤怠時間計算システム。
Square タイムカードのエクスポート CSV を取り込み、自社ルールに基づいて
勤務時間・残業時間・早出時間を自動計算する。

## 技術構成

- **フロント/バック**: Next.js (App Router) + React + TypeScript + Tailwind CSS
- **DB**: PostgreSQL（開発・本番とも。ローカルは `prisma dev` のローカル Prisma Postgres）
- **ORM**: Prisma（driver adapter `@prisma/adapter-pg`、engineType="client"）
- **認証**: JWT（jose）を sessionStorage の Bearer トークンで送る。パスワードは bcrypt でハッシュ化
- **本番**: Railway（Docker、`Dockerfile` / `docker/entrypoint.sh`）

## セットアップ

```bash
npm install
npm run db:dev           # ローカル Prisma Postgres を起動（表示される TCP 接続文字列を .env の DATABASE_URL に）
npx prisma migrate dev   # テーブル作成
npm run db:seed          # 初期データ投入
npm run dev              # http://localhost:3000
```

`.env` の例（`npm run db:dev` の出力に合わせる）:

```
DATABASE_URL="postgres://postgres:postgres@localhost:51214/template1?sslmode=disable"
SESSION_SECRET="ローカル用の適当な文字列"
```

2回目以降は `npx prisma dev start timecalc`（または `npm run db:dev`）で同じ DB が再開する。

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

## 本番（Railway）

Railway プロジェクト `poetic-intuition` の **サービス `timecalc`** ＋ **Postgres `timecalc-db`**。
GitHub リポジトリ `halspace-front` の **Root Directory `TimeCalc`** から Dockerfile でビルドされ、
対象ブランチへ push すると自動でデプロイされる（Watch Paths `TimeCalc/**`）。

- 起動時に `docker/entrypoint.sh` が `prisma migrate deploy` を流してから Next.js を起動する。
  スキーマ変更はマイグレーションをコミットして push するだけでよい。
- 環境変数: `DATABASE_URL`（`${{timecalc-db.DATABASE_URL}}` を参照）、`SESSION_SECRET`（長いランダム値）
- 反映確認: `railway status` が `Online`、`railway logs -d` に `[web] prisma migrate deploy` と起動ログが出ること
- 旧URL `https://timecalc.space-app.workers.dev` は新URLへ 301 リダイレクトする Worker だけを残している

### Cloudflare D1 からのデータ移行（移行時の1回限り）

```bash
npx wrangler@4 d1 export timecalc --remote --output=d1.sql
node --env-file=.env --import tsx scripts/migrate-d1-to-postgres.mjs d1.sql          # 件数確認
node --env-file=.env --import tsx scripts/migrate-d1-to-postgres.mjs d1.sql --write  # 投入
```

## 開発コマンド

```bash
npm run dev         # 開発サーバー
npm run build       # 本番ビルド（.next/standalone を出力）
npm start           # 本番サーバー
npm test            # 単体テスト（vitest）
npm run db:dev      # ローカル Prisma Postgres の起動
npm run db:migrate  # マイグレーション
npm run db:seed     # シード
```
