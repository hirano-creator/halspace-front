@AGENTS.md

# affect CRM

サーフショップ「affect」の顧客・予約・スクール・販売を一元管理する基幹システム。

**記録する流れ**: 来店 → 接客 → 興味 → 購入／未購入 → フォロー → スクール → 再来店

判断に迷ったら基準は 1 つ。**「実際の店舗スタッフが毎日使い続けられるか」**。動くことより入力の簡単さを優先する。

企画書: [docs/企画書.md](docs/企画書.md)

## 技術構成

Next.js 16 (App Router) / TypeScript / Tailwind CSS 4 / Prisma 6 (engineType="client") / PostgreSQL

```
ブラウザ → Cloudflare Pages（affect-crm-app.pages.dev、cloudflare-proxy/ の Function が全リクエストを中継）
        → Railway サービス affect-crm（Dockerfile、Next.js standalone）
        → Railway Postgres affect-crm-db
```

同一モノレポの `../TimeCalc` が同じ構成で本番稼働している。実装パターンで迷ったら**まず TimeCalc を読む**。

2026-09 まで Cloudflare Workers + D1 で動いていた（Worker の 3 MiB 制限に達したため移行）。
旧 URL `affect-crm.space-app.workers.dev` は新 URL へ 301 する Worker（`cloudflare-redirect/`）だけを残し、
D1 データベース `affect-crm` は退避データとして残置している。

## 運用コスト

Railway（サービス + Postgres）の実費だけ。Cloudflare は無料枠。**それ以外の有料 SaaS を構成に入れない。**

- 認証は自前実装（Auth0 等を使わない）
- グラフはクライアント側で描画（外部 API を使わない）
- 監視 SaaS を入れない（`railway logs` で足りる）

## 絶対に守るルール

### 日付は必ず JST 変換を通す

**Docker コンテナは UTC で動く。** 日付境界の計算は `src/lib/utils/time.ts` に集約し、各所で `new Date()` から直接組み立てない。

これを守らないと「今日の来店者数」が静かにズレる。TimeCalc が実際に踏んだ。

### Prisma の import 元

```ts
import { PrismaClient } from "@/generated/prisma/client";
```

`@prisma/client` から import すると壊れる。generator は `provider = "prisma-client"`（`-js` ではない）+ `runtime = "nodejs"` + `engineType = "client"`。
`prisma` は `src/lib/db.ts` のシングルトンだけを使う（`new PrismaClient()` を各所で作らない）。

### `.env` に本番の値を置かない

`.env` はローカル用のみ（`.gitignore` 済み、Docker イメージにも入らない）。本番の `DATABASE_URL` / `SESSION_SECRET` は Railway の環境変数で設定する。

### 認証は sessionStorage + Bearer

Cookie 認証と Server Action は使わない。タブごとに別アカウントでログインできる状態を保つため（管理者とスタッフを並べて検証できる）。

- 管理画面のページは全て `"use client"`。データ取得は `apiFetch()` で `/api/*` を叩く
- Route Handler の先頭で必ず `requireApiUser()` / `requireApiPermission()` を通す。画面のボタンを隠すだけの制御はしない
- 公開予約ページ `(public)/reserve` は認証不要。`/api/public/*` は `checkRateLimit()` で連打を防ぐ

### Tailwind は v4

- `tailwind.config.ts` を**作らない**。トークンは `globals.css` の `@theme inline` で定義する
- `!important` は**後置き**（`p-0!`）。v3 の `!p-0` は効かない

### enum は使わない

`String` + `src/lib/constants.ts` の `as const` タプル（→ union 型）と zod で値を担保する。
選択肢を設定画面から増やせる設計（MasterOption）と相性がよいので、PostgreSQL でもこの方針を維持する。

## ディレクトリ規約

機能フォルダは 4 点セットで統一する。

```
(app)/customers/
  page.tsx           "use client"。useRequireAuth → apiFetch → 描画
  types.ts           Route Handler とクライアントの両方から import する型
  client-actions.ts  フォーム送信（FormData をそのまま POST）
  customer-form.tsx  フォーム本体
```

API 側は `route.ts` / `[id]/route.ts` / `_shared.ts`（複数ルートが共有するパース・バリデーション。`_` 始まりはルートにならない）。

UI は Button コンポーネントを作らず、`src/components/ui.tsx` が export するクラス定数（`buttonPrimaryClass` 等）を使う。

## ローカル開発

```bash
npm install
npm run db:dev            # ローカル Prisma Postgres（prisma dev --name affect-crm）。表示される TCP 接続文字列を .env の DATABASE_URL に
npx prisma migrate dev    # テーブル作成
npm run db:seed           # 初期データ（admin@affect.local / staff@affect.local、パスワード affect2026）
npm run dev
```

2 回目以降は `npx prisma dev start affect-crm` で同じ DB が再開する。

## DB マイグレーション

```bash
npx prisma migrate dev --name <変更内容>   # prisma/migrations/ に SQL が生成される
```

生成された `prisma/migrations/<timestamp>_<name>/migration.sql` をコミットして push すれば、
Railway 起動時に `docker/entrypoint.sh` が `prisma migrate deploy` を流す。手で SQL を本番に当てない。

## デプロイ

**push すると Railway が自動でビルド・デプロイする**（GitHub `halspace-front`、Root Directory `affect_CRM`、Watch Paths `affect_CRM/**`。対象ブランチは TimeCalc と同じ）。

- 反映確認: `railway logs -d` に `[web] prisma migrate deploy` と起動ログが出て、**画面上の固有の文字列**で判定する（HTTP 200 では判定しない）
- 起動時のマイグレーションに失敗すると起動しない（古いスキーマで動くより止める）。`railway logs` を見る
- 環境変数（Railway）: `DATABASE_URL`（`${{affect-crm-db.DATABASE_URL}}`）、`SESSION_SECRET`
- Cloudflare 側は通常触らない。中継の転送先や旧 URL の転送先を変えるときだけ:
  - `cloudflare-proxy/` で `npx wrangler@4 pages deploy public --project-name affect-crm-app`
  - `cloudflare-redirect/` で `npx wrangler@4 deploy`

### 中継の注意

`cloudflare-proxy/functions/[[path]].js` は `Host` 以外のヘッダーをそのまま Railway へ渡す。
元のホスト名は `X-Original-Host` で渡す（`X-Forwarded-Host` は Railway のエッジが上書きするので使えない。TimeCalc が踏んだ）。
`CF-Connecting-IP` もそのまま届くので、レート制限（`src/lib/rate-limit.ts`）はこれを見る。

## UI の原則

- **スマホ優先**。店舗スタッフは接客の合間にスマホで入力する
- 入力欄のフォントは **16px 以上**（`text-base`）。これより小さいと iOS Safari が勝手にズームする。PC は `sm:text-sm` で戻す
- タップ領域は **44px 以上**（`min-h-11 sm:min-h-10`）
- スマホでテーブルを横スクロールさせない。**カード表示**に変換する
- 選択式を多用し、キーボード入力を減らす。日時・人数は既定値を入れておく
- **エラーは項目名を含める**。「入力してください」ではなく「氏名を入力してください」
- 操作名称を統一する（保存／登録／編集／削除／キャンセル）

## データの扱い

- 購入／未購入は**必須**。買わなかった記録こそが資産になる
- 顧客は論理削除（`deletedAt`）。削除は管理者のみ
- マスタ類（タグ・選択肢・商品・コース）は削除せず `isActive = false` で無効化する。過去データの表示が壊れるため
- 金額はすべて `Int`（円）
- 来店目的・来店経路・未購入理由は自由記述にせず、`MasterOption` のコード値で持つ（分析が成立しなくなるため）。来店経路は複数選択で、`Visit.channelCode` にカンマ区切り（読み書きは `src/lib/visit-channel.ts` 経由）
- **個人情報をログに出力しない**。氏名・電話・メール・住所は出さず、顧客 ID のみ記録する

## 安定性

共通の fetch ラッパー（`apiFetch`）で守る。

- **GET のみ**自動リトライ（0.7 秒・2 秒 空けて 2 回まで）。POST は二重登録を防ぐため対象外
- 再取得に失敗しても、画面に出ている内容を消さない
- 401 を受けたらトークンを破棄してログイン画面へ
