# affect CRM

サーフショップ「affect」の顧客・予約・スクール・販売を一元管理するシステム。

**記録する流れ**: 来店 → 接客 → 興味 → 購入／未購入 → フォロー → スクール → 再来店

- 企画書: [docs/企画書.md](docs/企画書.md)
- UI モック: [docs/mockups/index.html](docs/mockups/index.html)（採用は「案F 確定版」）
- 開発規約: [CLAUDE.md](CLAUDE.md)

## 技術構成

Next.js 16 / TypeScript / Tailwind CSS 4 / Prisma 6 / Cloudflare D1 (SQLite) / OpenNext → Cloudflare Workers

運用コストは Cloudflare の無料枠で 0 円に収める。有料 SaaS は構成に入れない。

## 開発の始め方

```bash
npm install
npx prisma generate                 # src/generated/prisma を作る（.gitignore 済み）
npx wrangler types                  # worker-configuration.d.ts を作る（.gitignore 済み）

# ローカル D1 にスキーマと初期データを流す
npx wrangler d1 execute affect-crm --local --file migrations/0001_init.sql
node scripts/seed.mjs
npx wrangler d1 execute affect-crm --local --file migrations/seed.sql

npm run dev                         # http://localhost:3000
```

`.env`（.gitignore 済み）に次の 2 つが必要。**本番の値は書かない。**

```
DATABASE_URL="file:./dev.db"
SESSION_SECRET="ローカル開発用のダミー値"
```

### 開発時の注意

- **`next dev` と `wrangler dev` を同時に動かさない。** 同じローカル D1 を掴むため、片方を落とすと
  もう片方が `Attempted to use poisoned stub` で 500 になる。切り替えたら `next dev` を再起動する
- D1 は**クエリを 1 本ずつ処理する**（`Promise.all` で並べても速くならない）。
  画面が遅いときは、まずクエリの本数を減らせないか考える

### 初期アカウント

| 権限 | メールアドレス | パスワード |
|---|---|---|
| 管理者 | admin@affect.local | affect2026 |
| スタッフ | staff@affect.local | affect2026 |

トークンは sessionStorage に持つので、**タブごとに別アカウントでログインできる**。管理者とスタッフを並べて権限差を確認できる。

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

グラフは外部ライブラリを使わず自前で描いている（バンドルを軽く保ち、運用コスト 0 円の方針を守るため）。

### 匿名来店グループの内訳（年代・性別）

複数人の匿名来店で年代・性別が一様でない場合、「お一人ずつ分けて入力する」から人数分の
内訳（`VisitGuest`）を登録できる。開いた瞬間はグループの代表値で全員分が埋まるので、
違う人だけ変更すればよい（同質なグループなら追加のタップは発生しない）。

- 名前がわかる来店の同伴者（「ほか◯名」）には**適用しない**（同伴者の属性まで追う優先度は低いという判断）
- 内訳があれば一覧・カルテの表示は「お名前不明（3名・年代/性別混在）」のようになる
- データ分析の男女比・年代別は、この機能により**単位が「組」から「人」に変わった**。
  内訳があればそれを使い、なければ匿名グループは代表値を人数分、名前がわかる来店は本人 1 人分だけを数える
  （同伴者の属性は実際には分からないため水増ししない）。購入率など「その来店が買ったか」を問う指標は来店単位のまま変更していない

### Phase 5（デプロイ以外は完了）

- ログイン API に総当たり対策（IP は 15 分 20 回、メールは 10 回。失敗時のみ数え、成功でリセット）
- エラー画面（`error.tsx`）と 404 画面。業務中に真っ白な画面を出さない
- スマホ最適化: 全画面で**横スクロール 0 件**を確認。絞り込みボタンのタップ領域を 44px に統一
- 本番ビルド（`npm run cf:build`）が通ることと、`wrangler dev` で Worker 実体が動くことを確認

**セキュリティの状態**

| 項目 | 対応 |
|---|---|
| 認証 | JWT（jose）+ bcrypt。トークンは sessionStorage、Bearer で送る |
| 認可 | 全 Route Handler の先頭で `requireApiUser` / `requireApiPermission`。画面を隠すだけの制御はしない |
| CSRF | Cookie を使わないため構造的に発生しない |
| XSS | React の自動エスケープのみ。`dangerouslySetInnerHTML` は未使用 |
| SQL インジェクション | Prisma のパラメータバインドのみ。文字列連結でクエリを組まない |
| 総当たり | ログイン・公開予約に D1 ベースのレート制限 |
| 個人情報 | ログに出力しない（`console.*` は 0 件）。CSV 出力は管理者のみで監査ログに残す |

### 公開ページ

| URL | 内容 |
|---|---|
| `/reserve` | スクール予約（認証不要）。既存ホームページからここへリンクする |

Web 予約は**仮予約**として登録され、店舗がカレンダーで確定する。
`/api/public/*` は同一 IP から 1 時間に 10 件までに制限している。

## DB マイグレーション

`prisma migrate deploy` は D1 に使えない。

```bash
npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script > migrations/000N_xxx.sql
npx wrangler d1 execute affect-crm --local  --file migrations/000N_xxx.sql
npx wrangler d1 execute affect-crm --remote --file migrations/000N_xxx.sql
```

各 SQL の冒頭に実行コマンドをコメントで残すこと。

## 本番環境

| | |
|---|---|
| 管理画面 | https://affect-crm.space-app.workers.dev |
| 公開予約ページ | https://affect-crm.space-app.workers.dev/reserve （認証不要） |
| D1 | `affect-crm` / `d72a2080-410d-4caf-8d35-04ab73bfbbcc`（APAC） |

**未対応**: 初期パスワードが `affect2026` のまま。URL を知られると誰でもログインできるので、
運用を始める前にスタッフ管理から変更すること。

### 更新のしかた

```bash
npm run cf:deploy    # ★これを叩かないと本番は変わらない
```

**CI/CD はない。`git push` では本番は一切変わらない。**
DB のスキーマ変更はデプロイに含まれないので、順序は「D1 に SQL 適用 → `cf:deploy`」。

```bash
npx wrangler d1 execute affect-crm --remote --file migrations/000N_xxx.sql
npm run cf:deploy
```

反映確認は HTTP 200 ではなく、**画面上の固有の文字列**で判定する。

### Worker サイズの余裕がない

無料プランの上限は **gzip 後 3 MiB**、現在 **2.88 MiB**。残り 4% しかない。
超えると `Your Worker exceeded the size limit of 3 MiB` でデプロイが失敗する。

`npm run cf:build` が `scripts/cf-build.mjs` 経由なのはこのため。
OpenNext は node_modules 内の全 `.wasm` を列挙してバンドルに含めるので、
prisma CLI が同梱する他 DB 向けエンジン（D1 では未使用）を退避してからビルドしている。

超えたときに削れる候補:

1. `bcryptjs` を Web Crypto の PBKDF2 に置き換える（数百 KB。ただし既存ハッシュの移行が必要）
2. 使っていない依存を `dependencies` から外す

### 別環境に新しく立てる場合

```bash
npx wrangler login
npx wrangler d1 create affect-crm          # 出力の database_id を wrangler.jsonc へ
npx wrangler d1 execute affect-crm --remote --file migrations/0001_init.sql
npx wrangler d1 execute affect-crm --remote --file migrations/0002_rate_limit.sql
node scripts/seed.mjs
npx wrangler d1 execute affect-crm --remote --file migrations/seed.sql
npx wrangler secret put SESSION_SECRET     # 十分に長いランダム値
npm run cf:deploy
```

> `migrations/0003_fix_datetime_type.sql` は既存データの型を直すためのもの。
> 新しく作る DB には不要（修正後のシードを流すため）。
