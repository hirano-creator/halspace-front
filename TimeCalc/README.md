# TimeCalc — 勤怠時間計算システム

株式会社ヒラノの勤怠時間計算システム。
Square タイムカードのエクスポート CSV を取り込み、自社ルールに基づいて
勤務時間・残業時間・早出時間を自動計算する。

## 技術構成

- **フロント/バック**: Next.js (App Router) + React + TypeScript + Tailwind CSS
- **DB**: PostgreSQL（開発・本番とも。ローカルは `prisma dev` のローカル Prisma Postgres）
- **ORM**: Prisma（driver adapter `@prisma/adapter-pg`、engineType="client"）
- **認証**: JWT（jose）を sessionStorage の Bearer トークンで送る。パスワードは bcrypt でハッシュ化。
  トークンは「誰か」の証明にだけ使い、権限・所属・在籍はリクエストごとにDBで引き直す（`src/lib/auth/api-guard.ts`）ので、
  退職処理（在籍オフ）や権限変更は即時に効く。ログインは識別子ごと5回/15分・IPごと30回/15分の失敗でロック（`src/lib/auth/login-throttle.ts`）
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

### パスワードの運用

- 管理者が社員を登録（個別・一括・パスワード再設定）すると、その社員は **初回ログイン時にパスワード変更を求められる**
  （`User.mustChangePassword`）。変更が済むまで他の画面・APIは使えない（`/password` と `/api/my/password` のみ通す）。
- 本人はいつでもサイドバー下の「パスワード変更」から変更できる。
- 管理者は社員管理の編集画面からパスワードを再設定できる（再設定後は上記のとおり本人に変更を求める）。

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
- 打刻APIは「状態確認→登録→勤怠の導出」をユーザー単位の advisory lock 付きトランザクションで行う
  （二重タップ・複数端末の同時送信で出勤が2件入らない）。QRで指定できる店舗は本人の所属部署と
  **同じ会社の部署だけ**（GPS判定や日替わりQRが無効な別部署のIDを送って素通りさせない）。
  同じ会社の中で店舗ごとに GPS/日替わりQR の有無が違う場合、その差は塞げないので設定は会社内で揃えること。

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
- ヘルスチェックは `/api/health`（DB疎通込み、失敗時503）。**サービス設定（Settings → Deploy → Healthcheck Path）に直接入れてある**
  （`railway.json` の config-as-code は Railway 側で非推奨になり、healthcheckPath が反映されなかったため。
  2026-09-18 に API で設定済み）。デプロイ直後の `migrate deploy` 中は新コンテナへ切り替わらないので、起動中の 502 は出ない。
  旧 `/api/warm` は同じ内容を返す別名
- 環境変数: `DATABASE_URL`（`${{timecalc-db.DATABASE_URL}}` を参照）、`SESSION_SECRET`（長いランダム値）、
  `DB_POOL_MAX`（任意、既定20。レプリカを増やすときに下げる）、
  `PUBLIC_BASE_URL`（QR・キオスクURLのベース。本番は `https://timecalc-app.pages.dev`。無ければ中継の X-Original-Host から組み立てる）、
  `TZ=Asia/Tokyo`（打刻の日時は固定+9時間で計算しているので無くても正しいが、取込履歴の表示時刻だけコンテナのTZに依存する）。
  `LOGIN_DEBUG_LOG=1` を付けるとログイン試行を識別子・UA付きで全件ログに出す（実機の不具合切り分け用。普段は付けない）
- 反映確認: `railway status` が `Online`、`railway logs -d` に `[web] prisma migrate deploy` と起動ログが出ること
- 旧URL `https://timecalc.space-app.workers.dev` は新URLへ 301 リダイレクトする Worker だけを残している
  （2026-09-19 に切替完了。旧 D1 のデータは新側へ移行済みで、D1 自体は退避用にしばらく残す。
  再デプロイは `cloudflare-redirect/` で `npx wrangler@4 deploy`）

### バックアップと復元

給与計算の元データなので、Railway 側のバックアップとは別に **自前で日次の pg_dump を R2 に置く**（`scripts/backup-db.sh`）。

**バックアップ用サービス（Railway、初回だけ手で作る）**

1. `poetic-intuition` プロジェクトに同じリポジトリ・同じ Root Directory（`TimeCalc`）・同じブランチでサービスを追加（名前は `timecalc-backup`）。
   Dockerfile は共通で、`CRON_COMMAND` があると `docker/entrypoint.sh` が Web サーバーを起動せずにそのコマンドを回す。
2. 変数を設定する:

   | 変数 | 値 |
   |---|---|
   | `CRON_COMMAND` | `app-backup-db` |
   | `CRON_DAILY_UTC` | `18:00`（= JST 3:00。カンマ区切りで複数可） |
   | `DATABASE_URL` | `${{timecalc-db.DATABASE_URL}}` |
   | `R2_ACCOUNT_ID` / `R2_BUCKET` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | R2 のバケットと、そのバケットの読み書き権限を持つ API トークン |
   | `BACKUP_KEEP_DAYS` | 任意。既定 30（それより古い日付分を毎日1本消す） |

3. 公開ドメインは不要（Networking は何も設定しない）。ログに `[cron] next run at ...` が出れば待機中。
4. **初回は必ず1回手動で流して R2 にファイルが置かれるのを確認する**:
   `railway ssh --service timecalc-backup app-backup-db`（コンテナ内で実行。`railway run` はローカルで動くので不可）。
   ssh が使えなければ一時的に `CRON_DAILY_UTC` を外して再デプロイ→ログで `[backup] done` を確認→戻す。
   `CRON_ENABLED=false` で一時停止できる（ループは止まらず実行だけスキップ）。

保存先は `s3://<R2_BUCKET>/timecalc/<YYYY-MM-DD>.dump`（pg_dump のカスタム形式、圧縮済み）。同じ日に複数回走ると上書き。

**復元（別のDBに戻して確認してから本番に当てる）**

```bash
# 1. R2 からダウンロード（Cloudflare ダッシュボード、または wrangler r2 object get <bucket>/timecalc/2026-09-18.dump --file=backup.dump）
# 2. まずローカルの Prisma Postgres（npm run db:dev）に戻して中身を確認する
pg_restore --clean --if-exists --no-owner --no-privileges -d "$DATABASE_URL" backup.dump
# 3. 本番に戻すときは Railway の timecalc-db に TCP プロキシを一時的に開け、その接続文字列で同じコマンドを流す
#    （復元中は timecalc サービスを止めておく。終わったら TCP プロキシは閉じる）
```

`pg_restore` は PostgreSQL 15 以上のクライアントが必要（Windows は EDB のインストーラーから「Command Line Tools」だけ入れれば足りる）。
`--clean --if-exists` で既存テーブルを落としてから作り直すので、`_prisma_migrations` も含めて丸ごとバックアップ時点に戻る。

### Cloudflare D1 からのデータ移行（移行時の1回限り・2026-09-19 完了）

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
