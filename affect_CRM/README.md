# affect CRM

サーフショップ「affect」の顧客・予約・スクール・販売を一元管理するシステム。

**記録する流れ**: 来店 → 接客 → 興味 → 購入／未購入 → フォロー → スクール → 再来店

- 企画書: [docs/企画書.md](docs/企画書.md)
- UI モック: [docs/mockups/index.html](docs/mockups/index.html)（採用は「案F 確定版」）
- 開発規約: [CLAUDE.md](CLAUDE.md)

## 技術構成

- **フロント/バック**: Next.js 16 (App Router) + React + TypeScript + Tailwind CSS 4
- **DB**: PostgreSQL（開発・本番とも。ローカルは `prisma dev` のローカル Prisma Postgres）
- **ORM**: Prisma 6（driver adapter `@prisma/adapter-pg`、engineType="client"）
- **認証**: JWT（jose）を sessionStorage の Bearer トークンで送る。パスワードは bcrypt でハッシュ化
- **本番**: Railway（Docker、`Dockerfile` / `docker/entrypoint.sh`）。入口は Cloudflare Pages の中継（`cloudflare-proxy/`）

TimeCalc と同じ構成。運用コストは Railway の実費のみで、それ以外の有料 SaaS は構成に入れない。

## 開発の始め方

```bash
npm install
npm run db:dev            # ローカル Prisma Postgres を起動（表示される TCP 接続文字列を .env の DATABASE_URL に）
npx prisma migrate dev    # テーブル作成
npm run db:seed           # 初期データ投入
npm run dev               # http://localhost:3000
```

`.env`（.gitignore 済み）の例。**本番の値は書かない。**

```
DATABASE_URL="postgres://postgres:postgres@localhost:51218/template1?sslmode=disable"
SESSION_SECRET="ローカル開発用のダミー値"
```

2 回目以降は `npx prisma dev start affect-crm`（または `npm run db:dev`）で同じ DB が再開する。

### 初期アカウント

| 権限 | メールアドレス | パスワード |
|---|---|---|
| 管理者 | admin@affect.local | affect2026 |
| スタッフ | staff@affect.local | affect2026 |

トークンは sessionStorage に持つので、**タブごとに別アカウントでログインできる**。管理者とスタッフを並べて権限差を確認できる。
`SEED_MINIMAL=1 npm run db:seed` で管理者だけを投入する（本番の初期化用）。

## できること

### Phase 1（完了）

- ログイン／ログアウト、管理者とスタッフの権限差
- 顧客の登録・編集・検索・削除（削除は管理者のみ・論理削除）、重複顧客の候補提示
- 顧客カルテ（要約 + 7 タブ）
- **クイック来店登録**（お名前が分からないお客様も記録できる）
- 購入・未購入の記録、購入明細の登録
- ダッシュボード

### Phase 2（完了）

- スクールのコース管理（所要時間・料金・定員・担当スタッフ・公開／非公開）
- **予約カレンダー**（月／週／日）。開催枠の作成、予約の登録とステータス変更
- **ホームページからの Web 予約**（`/reserve`・認証不要）。CRM で作った枠がそのまま出て、残り人数まで表示される
- Web 予約から顧客を自動で名寄せ（連絡先と氏名が一致する場合のみ紐付け、そうでなければ新規作成して要確認メモを残す）
- 予約を「参加済」にすると参加履歴が自動で作られ、評価（パドル／テイクオフ／波選び／ライディング／総合）を記録できる

### Phase 3（完了）

- **フォロー管理**（未完了／今日まで／完了で絞り込み、担当者別、ステータスをその場で変更）
- スタッフ管理（追加・権限変更・パスワード変更・無効化。管理者のみ）
- 設定（選択肢マスタと顧客タグの追加・表示名変更・無効化。管理者のみ）
- 商品マスタ、購入履歴の一覧

### Phase 4（完了）

- **データ分析**（今日／今週／今月／先月／今年／期間指定）
  - 来店分析（新規・リピーター・お名前を伺えた率・男女比・年代別・地域別・目的別・経路別）
  - 購入分析（購入率・売上・客単価・カテゴリー別・商品別・年代/性別/経路別の購入率）
  - **未購入分析**（未購入率・理由の内訳・見ていた商品・経路別/年代別の未購入率・**「検討中」の顧客一覧**）
  - スクール分析（開催数・参加人数・定員充足率・キャンセル率・コース別・スタッフ別）
  - 顧客行動（来店→購入、来店→スクール、スクール→購入、初回来店→再来店、未購入→後日購入）
- **CSV 出力**（顧客／来店履歴／購入履歴／スクール履歴／予約／フォロー履歴）
  - BOM 付き UTF-8・CRLF なので Excel でそのまま開ける
  - 氏名・連絡先を含む出力は**管理者のみ**。出力したことは監査ログに残る

グラフは外部ライブラリを使わず自前で描いている。

### 匿名来店グループの内訳（年代・性別）

複数人の匿名来店で年代・性別が一様でない場合、「お一人ずつ分けて入力する」から人数分の
内訳（`VisitGuest`）を登録できる。開いた瞬間はグループの代表値で全員分が埋まるので、
違う人だけ変更すればよい（同質なグループなら追加のタップは発生しない）。

- 名前がわかる来店の同伴者（「ほか◯名」）には**適用しない**（同伴者の属性まで追う優先度は低いという判断）
- 内訳があれば一覧・カルテの表示は「お名前不明（3名・年代/性別混在）」のようになる
- データ分析の男女比・年代別は、この機能により**単位が「組」から「人」に変わった**。
  内訳があればそれを使い、なければ匿名グループは代表値を人数分、名前がわかる来店は本人 1 人分だけを数える
  （同伴者の属性は実際には分からないため水増ししない）。購入率など「その来店が買ったか」を問う指標は来店単位のまま変更していない

### 来店経路の複数選択

来店経路は複数選べる（「Instagram を見て、紹介でも聞いていた」など）。`Visit.channelCode` にカンマ区切りで持ち、
読み書きは `src/lib/visit-channel.ts` に集約している。分析では経路を複数選んだ来店を各経路に 1 件ずつ数える。

### Phase 5（完了）

- ログイン API に総当たり対策（IP は 15 分 20 回、メールは 10 回。失敗時のみ数え、成功でリセット）
- エラー画面（`error.tsx`）と 404 画面。業務中に真っ白な画面を出さない
- スマホ最適化: 全画面で**横スクロール 0 件**を確認。絞り込みボタンのタップ領域を 44px に統一

**セキュリティの状態**

| 項目 | 対応 |
|---|---|
| 認証 | JWT（jose）+ bcrypt。トークンは sessionStorage、Bearer で送る |
| 認可 | 全 Route Handler の先頭で `requireApiUser` / `requireApiPermission`。画面を隠すだけの制御はしない |
| CSRF | Cookie を使わないため構造的に発生しない |
| XSS | React の自動エスケープのみ。`dangerouslySetInnerHTML` は未使用 |
| SQL インジェクション | Prisma のパラメータバインドのみ。文字列連結でクエリを組まない |
| 総当たり | ログイン・公開予約に DB ベースのレート制限（IP は Cloudflare が付ける `CF-Connecting-IP`） |
| 個人情報 | ログに出力しない（`console.*` は 0 件）。CSV 出力は管理者のみで監査ログに残す |

### 公開ページ

| URL | 内容 |
|---|---|
| `/reserve` | スクール予約（認証不要）。既存ホームページからここへリンクする |

Web 予約は**仮予約**として登録され、店舗がカレンダーで確定する。
`/api/public/*` は同一 IP から 1 時間に 10 件までに制限している。

## DB マイグレーション

```bash
npx prisma migrate dev --name <変更内容>   # prisma/migrations/ に SQL が生成される
```

生成されたマイグレーションをコミットして push すれば、Railway 起動時に `docker/entrypoint.sh` が
`prisma migrate deploy` を流す。手で SQL を本番に当てない。

## 本番（Railway）

Railway プロジェクト `poetic-intuition` の **サービス `affect-crm`** ＋ **Postgres `affect-crm-db`**。
GitHub リポジトリ `halspace-front` の **Root Directory `affect_CRM`** から Dockerfile でビルドされ、
対象ブランチへ push すると自動でデプロイされる（Watch Paths `affect_CRM/**`）。

| | |
|---|---|
| 管理画面 | https://affect-crm-app.pages.dev |
| 公開予約ページ | https://affect-crm-app.pages.dev/reserve （認証不要） |
| Railway 直接 | https://affect-crm-production.up.railway.app（通常は使わない） |
| 旧 URL | https://affect-crm.space-app.workers.dev → 新 URL へ 301（`cloudflare-redirect/`） |

- 起動時に `docker/entrypoint.sh` が `prisma migrate deploy` を流してから Next.js を起動する。
  スキーマ変更はマイグレーションをコミットして push するだけでよい
- 環境変数: `DATABASE_URL`（`${{affect-crm-db.DATABASE_URL}}` を参照）、`SESSION_SECRET`（長いランダム値）
- 反映確認: `railway status` が `Online`、`railway logs -d` に `[web] prisma migrate deploy` と起動ログが出ること。
  画面は HTTP 200 ではなく**固有の文字列**で判定する
- 初回だけ `SEED_MINIMAL=1` でシードを流し（管理者のみ）、旧 D1 のデータを下記で移す

**未対応**: 初期パスワードが `affect2026` のまま。URL を知られると誰でもログインできるので、
運用を始める前にスタッフ管理から変更すること。

### Cloudflare 側（中継と旧 URL の転送）

`affect-crm-app.pages.dev` は静的ファイルを持たず、`cloudflare-proxy/functions/[[path]].js` が
全リクエストを Railway へ透過中継する。転送先（`ORIGIN`）を変えたときだけ再デプロイする。

```bash
cd cloudflare-proxy    && npx wrangler@4 pages deploy public --project-name affect-crm-app
cd cloudflare-redirect && npx wrangler@4 deploy    # 旧 URL の転送先を変えるとき
```

### Cloudflare D1 からのデータ移行（移行時の 1 回限り）

```bash
npx wrangler@4 d1 export affect-crm --remote --output=d1.sql
node --env-file=.env.production --import tsx scripts/migrate-d1-to-postgres.mjs d1.sql          # 件数確認
node --env-file=.env.production --import tsx scripts/migrate-d1-to-postgres.mjs d1.sql --write  # 投入（upsert・再実行可）
```

`.env.production` には本番の `DATABASE_URL` だけを書き、作業後に消す。D1 には一切書き込まない。

## 開発コマンド

```bash
npm run dev         # 開発サーバー
npm run build       # 本番ビルド（.next/standalone を出力）
npm start           # 本番サーバー
npm run lint        # ESLint
npm run db:dev      # ローカル Prisma Postgres の起動
npm run db:migrate  # マイグレーション
npm run db:seed     # シード
```
