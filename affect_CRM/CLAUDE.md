@AGENTS.md

# affect CRM

サーフショップ「affect」の顧客・予約・スクール・販売を一元管理する基幹システム。

**記録する流れ**: 来店 → 接客 → 興味 → 購入／未購入 → フォロー → スクール → 再来店

判断に迷ったら基準は 1 つ。**「実際の店舗スタッフが毎日使い続けられるか」**。動くことより入力の簡単さを優先する。

企画書: [docs/企画書.md](docs/企画書.md)

## 技術構成

Next.js 16 (App Router) / TypeScript / Tailwind CSS 4 / Prisma 6 / Cloudflare D1 (SQLite) / OpenNext → Cloudflare Workers

同一モノレポの `../TimeCalc` が同じ構成で本番稼働している。実装パターンで迷ったら**まず TimeCalc を読む**。

## 運用コストは 0 円

Cloudflare の無料枠で完結させる。**有料 SaaS を構成に入れない。**

- 認証は自前実装（Auth0 等を使わない）
- グラフはクライアント側で描画（外部 API を使わない）
- 監視 SaaS を入れない（`wrangler tail` で足りる）
- 集計値を毎日バッチで書き直すような実装をしない（D1 の書き込み無料枠を圧迫する）

## 絶対に守るルール

### 日付は必ず JST 変換を通す

**Cloudflare Workers は常に UTC で動く。`TZ` 環境変数は効かない。** 日付境界の計算は `src/lib/utils/time.ts` に集約し、各所で `new Date()` から直接組み立てない。

これを守らないと「今日の来店者数」が静かにズレる。TimeCalc が実際に踏んだ。

### PrismaClient のキャッシュキーに env を使わない

`env` は同一 isolate 内でリクエスト間に共有されるため、PrismaClient が使い回されて**応答がハングし 500 になる**。`getCloudflareContext()` の戻り値そのものを WeakMap のキーにする。

`../TimeCalc/src/lib/db.ts` に理由のコメント込みで実装があるので流用する。

### SQL で日時を入れるときは ISO 8601 文字列

Prisma(D1) は `DateTime` を **ISO 8601 文字列**（`2026-08-31T15:28:23.831+00:00`）で読み書きする。シードやデータ修正の SQL で **epoch ミリ秒（数値）を入れてはいけない**。

同じ列に数値と文字列が混在すると、その列を `select` した瞬間に
`Inconsistent column data: expected a either an i64 or a f64` で **500 になる**（実際に `/api/staff` が落ちた）。

```js
const now = new Date().toISOString().replace("Z", "+00:00"); // Prisma と同じ表記
```

混ざってしまった場合は `migrations/0003_fix_datetime_type.sql` と同じ要領で
`strftime('%Y-%m-%dT%H:%M:%f', col/1000.0, 'unixepoch') || '+00:00'` に変換する。

### Prisma の import 元

```ts
import { PrismaClient } from "@/generated/prisma/client";
```

`@prisma/client` から import すると本番で壊れる。generator は `provider = "prisma-client"`（`-js` ではない）+ `runtime = "cloudflare"`。

### `.env` に本番シークレットを置かない

OpenNext は `.env` の内容を Worker のバンドルに焼き込む。本番の値は `npx wrangler secret put <NAME>` で設定する。`.env` はローカル用のダミー値のみ。

**ローカル開発では `SESSION_SECRET` を `.env` に置く。** `next dev` は `.dev.vars` を `process.env` に載せないため、`.dev.vars` だけだとログイン API が 500 になる（実際に踏んだ）。`.dev.vars` は `cf:preview` 用に残してある。

### 認証は sessionStorage + Bearer

Cookie 認証と Server Action は使わない。タブごとに別アカウントでログインできる状態を保つため（管理者とスタッフを並べて検証できる）。

- 管理画面のページは全て `"use client"`。データ取得は `apiFetch()` で `/api/*` を叩く
- Route Handler の先頭で必ず `requireApiUser()` / `requireApiPermission()` を通す。画面のボタンを隠すだけの制御はしない
- 例外: 公開予約ページ `(public)/reserve` は認証不要なので Server Component で書いてよい

### Tailwind は v4

- `tailwind.config.ts` を**作らない**。トークンは `globals.css` の `@theme inline` で定義する
- `!important` は**後置き**（`p-0!`）。v3 の `!p-0` は効かない

### SQLite に enum はない

`String` + `src/lib/constants.ts` の `as const` タプル（→ union 型）と zod で値を担保する。

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

## DB マイグレーション

`prisma migrate deploy` は D1 に使えない。

```bash
npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script > migrations/0001_init.sql
npx wrangler d1 execute affect-crm --local  --file migrations/0001_init.sql
npx wrangler d1 execute affect-crm --remote --file migrations/0001_init.sql
```

**各 SQL ファイルの冒頭に実行コマンドをコメントで残す。** これがないと後から再現できない。

## デプロイ

**CI/CD はない。`git push` しても本番は一切変わらない。**

```bash
npm run cf:preview   # ローカルで Worker 実体を確認
npm run cf:deploy    # ★これを叩かないと本番は変わらない
```

### Worker のサイズ制限（3 MiB）に注意

無料プランの上限は **gzip 後 3 MiB**。現在 **2.88 MiB** でほぼ余裕がない。
機能を足して超えたら、まず削れるものを探すこと（有料プランに逃げない）。

`npm run cf:build` は `scripts/cf-build.mjs` 経由になっている。これは
**ビルドの間だけ `node_modules/prisma`（CLI）を退避する**ためのもの。

OpenNext は node_modules 内の **すべての .wasm** を列挙してローダーを生成するため、
prisma CLI が同梱する PostgreSQL / MySQL / CockroachDB / SQLServer 向けエンジン
（D1 では 1 つも使わない）まで巻き込まれて 3 MiB を超える。実際にデプロイが失敗した。

`opennextjs-cloudflare build` を直接呼ぶスクリプトに戻さないこと。

### ビルドが EPERM で失敗したら
`.open-next` を消せずに落ちる場合、`workerd.exe` がフォルダを掴んでいる。
**`next dev` はローカル D1 エミュレーションのため裏で `workerd` を常駐させており**
（`wrangler dev` を使っていなくても発生する）、`next dev` を起動したまま
`cf:build` / `cf:deploy` を実行すると必ずこれで失敗する（実際に踏んだ）。

対処: `npm run dev`（`next dev`）を完全に停止してから `cf:build` / `cf:deploy` を実行する。
`workerd` だけ kill しても `next dev` が生きていれば即座に再起動されるため、
親の `next dev` プロセスごと止めること。

- DB のスキーマ変更はデプロイに含まれない。順序は「D1 に SQL 適用 → `cf:deploy`」
- 反映確認は HTTP 200 ではなく、**画面上の固有の文字列**で判定する
- デプロイしていないのに「本番に反映しました」と報告しない

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
- 来店目的・来店経路・未購入理由は自由記述にせず、`MasterOption` のコード値で持つ（分析が成立しなくなるため）
- **個人情報をログに出力しない**。氏名・電話・メール・住所は出さず、顧客 ID のみ記録する

## 安定性

Cloudflare Workers は散発的に応答を返さず 500 になることがある。共通の fetch ラッパーで防ぐ。

- **GET のみ**自動リトライ（0.7 秒・2 秒 空けて 2 回まで）。POST は二重登録を防ぐため対象外
- 再取得に失敗しても、画面に出ている内容を消さない
- 401 を受けたらトークンを破棄してログイン画面へ
