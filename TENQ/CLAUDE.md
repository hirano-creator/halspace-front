# TENQ

TENQ（テンク）— Smart Inspection System。QR コード式の工場設備日常点検アプリ。紙の点検表をスマホに置き換え、点検漏れの防止・異常の追跡（発生 → 是正 → 再確認 → 承認）・ISO 監査向けの記録保存を行う。HaLSpace モノレポ（git ルートは `c:\dev\my-programming`）の Space.app アプリの1つで、solid / whatsno と同じオリジン（`space-apps.pages.dev/TENQ/`）で配信する。

名称は画面・文書・コードのどこでも「TENQ」に統一する。

## 状態

第7段階の本番前の作業（総合テスト・セキュリティ確認・負荷/容量の計測・バックアップ訓練・操作説明）まで完了（2026-10-22）。**本番公開は承認待ち**（`docs/deployment.md` §9 の表）。**要確認事項は `docs/requirements.md` §10**。構成（案 A）・QR の URL・権限表（`docs/requirements.md` §3-2）はすべて決定済み（2026-10-22）。

QR の印字 URL は `https://space-apps.pages.dev/TENQ/q/#<トークン>`。**`TENQ/q/` の場所とフォルダ名 `TENQ` は印刷済み QR が壊れるので変更禁止**（`docs/architecture.md` §4-3）。

決定済みの画面方針: PC = エリア別の設備カード一覧（`_mock-qr-card-proposals.html` の C 案。エリア配置は管理画面であとから作る）、スマホ = 同モックの共通点検画面（QR → その設備の点検表）、スマホはログインを 30 日記憶。`_mock-*.html` は検討用のモックで本番画面ではない。

## 構成

- `web/` 画面: React 18 + TypeScript + Vite。UI ライブラリなし（素の CSS）。ハッシュルーティング。ビルド出力は `app/`（`base: '/TENQ/app/'`）
- `api/` tenq-api: Cloudflare Workers + Hono。D1（`tenq-db`）・R2（`tenq-files`）。マイグレーションは `api/migrations/`
- `shared/` web と api で共有する型・権限表・状態遷移表
- `e2e/` Playwright、`scripts/` サイズ確認など、`docs/` 設計書
- ログイン: Space.app の halspace-api（Laravel、`c:\laragon\www\solid-api`）。tenq-api は Bearer トークンを `/api/auth/me` で検証し、TENQ ロール・所属工場は D1 の `users` / `user_factories` で持つ

詳細: `docs/architecture.md`（構成）、`docs/database.md`（テーブル）、`docs/security.md`

## 開発・テスト・ビルド

```
npm install                 # TENQ 直下（npm workspaces）
npm run dev                 # web（Vite :5173）と api（wrangler dev :8787）
npm run db:migrate:local    # ローカル D1 にマイグレーション適用
npm run db:seed:local       # ダミーデータ
npm run db:reset:local      # ローカル D1 を作り直す（マイグレーション＋ダミーデータ）
npm run typecheck           # 型チェック（shared / api / web / e2e）
npm test                    # Vitest（単体・API 結合）
npm run test:e2e            # Playwright
npm run build               # web → app/、api の dry-run
npm run check:size          # Worker バンドルサイズ確認
```

## コーディングルール

- TypeScript strict。`any` を使わない。API の入出力型は `shared/` に置く
- 画面は画面単位で `React.lazy` 分割。QR 生成・読み取り・印刷用のコードは該当画面だけで読み込む
- API 呼び出しは `web/src/api/` のラッパーだけを使う（Bearer 付与・タイムアウト・**GET のみ再試行**。POST の再送は二重登録になるので冪等キーで守る）
- 通信に失敗しても画面のデータをダミーに差し替えない（前回の表示を残して知らせる）
- 入力欄のフォントは 16px 以上（iOS の自動ズーム対策）。タップ領域 44px 以上
- 正常・異常を色だけで区別しない（文字・アイコン併記）
- 日時は UTC で保存、点検日・期限は工場のタイムゾーンで計算（`shared/period.ts` に集約）
- コメント・ドキュメントは日本語

## セキュリティルール

- 権限判定は API 側の `can()` が正。画面の出し分けは補助。権限表は `shared/permissions.ts` の1か所だけ
- すべての SQL は prepared statement＋`bind()`、かつスコープ関数で `company_id`・`factory_id` を絞る（手書きの WHERE で会社スコープを付けない。HaLSpace で漏れの前例あり）。スコープ外の ID は 404
- 確定した点検記録・点検結果・状態遷移履歴・監査ログは上書き・削除しない（訂正は版を追加）。DB トリガーでも拒否している
- QR には URL とランダムトークンだけ。QR だけでは何も見られない
- トークンは sessionStorage の `space_token`（Space.app 共通）。localStorage に置かない。例外は TENQ 専用の端末記憶トークン `tenq_device_token` だけ（30 日・D1 の `device_sessions` で取り消し可能。`docs/security.md` §2-1）
- `dangerouslySetInnerHTML` 禁止。CSV は BOM＋CRLF＋数式セルの `'` 前置
- 写真は JPEG/PNG/WebP・10 MB 以下・マジックナンバー確認。R2 は非公開、配信は権限確認付きの API 経由

## Cloudflare 容量最適化ルール

- Worker 非圧縮バンドル **1 MiB 以内**（社内目標。公式上限は 2026-10 時点で 64 MiB）。2 MiB を超えたら原因を `docs/deployment.md` §6 に記録
- 依存を増やすときは理由・サイズ・代替を書く。同じ役割のライブラリを重複させない。Next.js・Prisma・大きな UI ライブラリ・zod は入れない（affect_CRM / TimeCalc が Workers から撤退した原因）
- 開発用パッケージは devDependencies。本番バンドルに入っていないことを `check:size` で確認
- 無料プランの CPU は 1 リクエスト 10ms。重い集計・大量 CSV は分割する。D1 クエリは 1 リクエスト 50 本以内（`db.batch` でまとめる）
- 一覧は必ずページネーション（キーセット）。画像変換を Worker でしない（端末側で縮小）

## D1 の変更方法

- `npx wrangler d1 migrations create tenq-db-dev <名前>` で新しいファイルを作る。適用済みファイルは書き換えない
- ローカル → 開発リモート（`tenq-db-dev`）の順に適用して確認。本番（`tenq-db`）は承認後に `docs/deployment.md` の手順で
- 本番 DB を直接 SQL で変更しない

## 環境変数・秘密情報

- ローカルは `api/.dev.vars`（Git 管理外）。リモートは `wrangler secret put`
- `wrangler.toml` に書くのは名前と D1/R2 の ID だけ。秘密情報をコード・文書に書かない
- 環境は `--env dev` / `--env production` で完全に分ける。テストはダミーデータのみ

## デプロイ前チェック

`docs/deployment.md` §3 と `docs/development-checklist.md`。lint・型・テスト・E2E・サイズ・マイグレーション確認・秘密情報確認 → オーナーに報告して承認。

## 本番環境を無断で変更しない

- 本番デプロイ（Workers・Pages の main への push）、本番 D1 へのマイグレーション・データ変更、課金を伴うリソースの作成・プラン変更、データの削除は**オーナーの明示的な承認があるときだけ**
- TENQ 外のファイル（`space/`・`solid/`・solid-api など）の変更も承認を得てから、別コミットで
- モノレポの作業ツリーには他アプリの未コミット変更が多い。`git add` はファイル指定。本番は main のみで、作業ブランチから worktree で cherry-pick する（`solid/CLAUDE.md` のデプロイ節と同じ）
- 反映確認は HTTP 200 ではなく、本文の固有文字列と `wrangler pages deployment list` の Production 行で

## 開発環境の注意（第2段階で分かったこと）

- API のテストは `@cloudflare/vitest-plugin` を使う（旧名 `@cloudflare/vitest-pool-workers` は非推奨で、古い wrangler を同梱していて npm audit に引っかかる）。ローカル D1 にマイグレーション＋`api/seed/dev-seed.sql` を入れてから実行する（`api/test/setup.ts`）
- `dev-seed.sql` は「; + 改行」で文を区切って流し込むので、seed にトリガー定義や文字列中の「;改行」を書かない
- ダミーデータの点検日は SQL の `strftime('%Y-%m-%d','now','+9 hours')` で「今日（日本時間）」になる。日付を固定値で書かない
- E2E は `npx playwright test` が API（wrangler dev）と画面（Vite）を自動で起動する。Playwright は TimeCalc と同じ 1.61 に合わせ、ブラウザの追加ダウンロードをしない
- `app/` はビルド成果物（Pages でそのまま配信する。docs/architecture.md §6 ①）。手で編集しない

## 第3段階で決めた実装上のルール

- 更新系 API は楽観ロック（`version`）。監査ログは `auditStatement(c, entry, updatedBy(...))` で「更新が実際に効いたときだけ」書く（同時編集で 409 になったのに監査ログだけ残る、を防ぐ）。業務の更新と監査ログは同じ `db.batch()` に入れる
- 権限は `authorize(c, action, target)`（shared の権限表）、範囲は `scopeWhere(auth, alias)`。範囲外の ID は 404
- 開発用の簡易ログイン（`dev-<hs_user_id>`）は `APP_ENV=dev` かつ `DEV_AUTH_STUB=1` のときだけ。画面側のボタンは `import.meta.env.DEV` で囲み、本番ビルドに入らないことを確認する（`grep 開発用ログイン app/assets/*.js`）
- ログイン後の移動先（QR の設備へ戻る等）は `App.tsx` の1か所で決める。ログイン画面で別に navigate すると、React の描画のタイミングで上書きされる（第3段階で実際に起きた）
- E2E の `devLogin()` はログイン完了まで待つ。スマホはログイン記憶の登録が1回多く、待たないと次の移動が上書きされる
- `useEffect` の中で同期的に setState しない（ESLint の react-hooks が指摘する）。読み込みは `useLoad()` を使う
- 実際の Space.app アカウントでログインするには、Space.app 側の利用アプリに `tenq` が必要（未登録の間は 403）
- 実機確認用のプレビューは https://tenq-dev.pages.dev/TENQ/app/（`npm run deploy:preview`）。Cloudflare の操作前に `npx wrangler whoami` で Space.app のアカウント（h.hirano@hirano50.com）か確かめる。別のアカウントにログインしていたことがある

## 第4段階で決めた実装上のルール

- 点検は「最初の項目を選んだとき」に開始する（開いただけで点検中を作らない）。入力途中は sessionStorage（`tenq_draft_<設備>_<期間>`）
- 完了は `Idempotency-Key` 必須。画面はキーを sessionStorage に持ち、通信に失敗して押し直しても同じキーを送る
- 点検結果・点検項目のまとめての保存は `json_each` の1文で行う（項目ごとに文を分けると D1 無料枠の「1回あたり50クエリ」を超えうる）
- 画面のルートは `key={path}` で作り直す。同じ画面部品のまま別の設備に移ると、前の設備の状態（完了など）が残るため
- E2E は PC とスマホで2回走る。データを変えるテストは端末ごとに別の設備を使うか、PC だけで行う（`test.skip`）
- Space.app 側の `tenq` 登録はフロント・API とも**本番未反映**。本番で TENQ を開けるようにするには、両方を main に反映する承認が要る

## 第5段階で決めた実装上のルール

- 異常の状態遷移は shared の `ABNORMALITY_TRANSITIONS` / `nextStatus()` だけを正とする。遷移ごとに権限表を確認し、`abnormality_events` に必ず残す
- 写真は `POST /api/attachments?owner_type=…&owner_id=…` に画像そのものを送る（multipart にしない）。Content-Type とマジックナンバーの両方を確認。表示は `AuthImage`（権限付きで取得して blob: URL）。`<img src>` に API の URL を直接書かない（ログイン情報が付かない）
- 画面の読み込みは、後から届いた古い結果で入力中の内容・新しい結果を上書きしない（`alive` フラグ、または最新の要求番号で判定）。第5段階で編集画面と一覧検索で実際に起きた
- 全体の `input { width:100% }` は詳細度が高い。隠したファイル選択などは `input[type="file"]` まで指定して上書きする（ページが横にはみ出した前例）
- E2E は PC とスマホが同時に走る。同じデータを同時に変えると楽観ロックの 409 になるので、データを変えるテストは端末ごとに別のデータを使う

## 第6段階で決めた実装上のルール

- 点検記録の検索条件は `api/src/lib/filters.ts` の `inspectionFilter()` 1か所（検索画面・CSV で共通）。ページ送りは `lib/cursor.ts`（値の組。時刻だけで区切ると同時刻の行が抜ける）
- CSV は `lib/csv.ts` の `csvResponse()` を使う（BOM・CRLF・数式セルの `'` 前置）。1 回 `CSV_MAX_ROWS`（1 万行）まで。出力・帳票は必ず監査ログ（`export.csv` / `report.print`）
- 画面の CSV 保存は `apiDownload()`（権限付きで取得してファイル名はサーバーの Content-Disposition）
- 帳票の印刷は名前付きページ（`@page doc` / `doc-landscape`）で用紙の向きを分ける。QR ラベルは余白 0 の既定ページ
- システム設定のうち `qr_base_url` は画面・API から変えない（印刷済み QR が壊れる）
- E2E で「他のテストが変えうるデータ」を前提にしない（訂正のテストで P-01 が異常になる等）。結果が入れ替わる画面は、古い表示が消えるのを待ってから確かめる

## 第7段階で決めたこと

- 画面の CSP は `web/vite.config.ts` でビルド時に meta で入れる（共有の Pages の設定は触らない）。新しい接続先を増やしたら connect-src も足す
- 本番の画面が呼ぶ API は `web/.env.production`（Git 管理。秘密情報ではない）
- 権限表を変えたら `api/test/permissions.test.ts`（総当たり）が追従する。新しい操作を足したら CASES に代表の API を足す
- CPU 時間は `npx wrangler tail tenq-api-dev --format json` の cpuTime で測れる。無料プランの上限は 1 回 10ms
