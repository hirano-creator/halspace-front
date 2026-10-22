# TENQ デプロイ手順書

- 版: 0.1（第1段階・ドラフト）／作成日: 2026-10-22
- **本番環境へのデプロイ・本番 DB の変更・課金を伴うリソース作成は、オーナーの明示的な承認があるときだけ行う**

## 1. 環境

| 環境 | 画面 | API | D1 | R2 |
| --- | --- | --- | --- | --- |
| ローカル | Vite 開発サーバー（`http://localhost:5173/TENQ/app/`） | `wrangler dev`（`http://localhost:8787`） | ローカル D1（`.wrangler/` 内） | ローカル R2 |
| 開発（リモート・実機確認用） | https://tenq-dev.pages.dev/TENQ/app/（Pages プロジェクト `tenq-dev`。space-apps とは別） | https://tenq-api-dev.space-app.workers.dev | `tenq-db-dev`（ce092ce0-…） | `tenq-files-dev` |
| 本番 | `https://space-apps.pages.dev/TENQ/app/`（main のみ） | `tenq-api` | `tenq-db` | `tenq-files` |

ログイン API の向き先: localhost で開いたときはローカルの halspace-api（`http://127.0.0.1:8000/api`）、それ以外は本番 halspace-api（既存アプリと同じ切替規則）。開発（リモート）環境のログインをどこに向けるかは第2段階で決める。

## 2. 初回のリソース作成（第2段階・承認後）

いずれも無料枠内で作成できる。作成前にオーナーへ一覧を示して承認をもらう。

```
npx wrangler d1 create tenq-db-dev
npx wrangler r2 bucket create tenq-files-dev
# 本番分（tenq-db / tenq-files）は第7段階の本番準備で作成
```

出力された `database_id` を `api/wrangler.toml` に書く（ID は秘密情報ではない）。

## 3. デプロイ前チェック（毎回）

1. `npm run lint && npm run typecheck`
2. `npm test`（API・画面の単体テスト）
3. `npm run test:e2e`（主要な流れ。スマホ・PC 表示）
4. `npm run check:size` — Worker の非圧縮バンドルが 1 MiB 以内か（2 MiB 超なら原因を §6 に記録してから進める）、画面の初回 JS が目標内か
5. 新しいマイグレーションがあれば、開発環境に適用して動作確認済みか
6. `git diff --cached` に秘密情報・`.dev.vars`・エクスポート `.sql` が入っていないか
7. 変更内容・テスト結果・残課題をオーナーに報告し、承認を得る

## 4. API（Workers）のデプロイ

```
cd TENQ/api
npx wrangler deploy --dry-run --outdir dist      # サイズ確認（Total Upload を見る）
npx wrangler deploy --env dev                    # 開発
# 本番（承認後）:
npx wrangler d1 time-travel info tenq-db         # 復元地点を控える
npx wrangler d1 migrations apply tenq-db --remote --env production
npx wrangler deploy --env production
```

マイグレーションは**コードより先に**適用する。古いコードでも新しいスキーマで動くよう、列の追加は後方互換にする。

## 5. 画面（Pages）のデプロイ

配信方法は architecture.md §6 で決定する。推奨案①の場合:

1. `npm run build -w web`（出力先 `TENQ/app/`）
2. ビルド成果物をコミット（`git add TENQ/...` とファイル・フォルダを指定。リポジトリ直下の他アプリの未コミット変更を混ぜない）
3. モノレポの決まりに従い、作業ブランチ → worktree で main に cherry-pick → main へ push（承認後）
4. 反映確認: HTTP 200 では判断しない（共有 Pages は存在しないパスでも 200 を返すことがある）。`curl -sL "https://space-apps.pages.dev/TENQ/app/?cb=$RANDOM" | grep -c "<今回のビルド固有の文字列>"` と `npx wrangler pages deployment list --project-name space-apps` の Production 行で確認

Space.app のアプリ一覧に TENQ を出す変更（`space/assets/js/space.js`、`space/admin.html`、solid-api の `SpaceApps::ALL`）は TENQ 外のファイルなので、別の承認・別コミットで行う。

## 6. サイズ記録

| 日付 | コミット | Worker 非圧縮 | gzip（参考） | 画面 初回 JS gzip | 備考 |
| --- | --- | --- | --- | --- | --- |
| 2026-10-22 | 第6段階 | 212.07 KiB | 49.18 KiB | 75.87 KiB | 帳票・集計・CSV は画面ごとに分割 |
| 2026-10-22 | 第5段階 | 181.49 KiB | 42.41 KiB | 75.01 KiB | 写真は Worker で変換せず、そのまま R2 へ（縮小は端末側） |
| 2026-10-22 | 第4段階 | 155.20 KiB | 36.55 KiB | 74.54 KiB | jsQR（QR 読み取り）は読み取り画面でブラウザに機能がないときだけ読み込む |
| 2026-10-22 | 第3段階 | 119.08 KiB | 29.26 KiB | 72.25 KiB | 画面は画面単位で分割。QR 生成ライブラリ（約 7 KiB gzip）は QR を表示する画面だけで読み込む |
| 2026-10-22 | 第2段階 | 68.36 KiB | 17.49 KiB | 67.65 KiB | 仮画面のみ。React 本体で約 70 KiB |

## 7. ロールバック

- API: `npx wrangler deployments list` → `npx wrangler rollback <deployment-id>`
- DB: マイグレーションは戻さず、修正のマイグレーションを追加する。データが壊れた場合は operations.md §4
- 画面: main を前のコミットに戻すコミットを push（承認後）

## 8. 開発用リモート環境（実機確認用、2026-10-22 作成）

- Cloudflare アカウント: Space.app（space-apps）と同じアカウント（h.hirano@hirano50.com）。wrangler のログイン先がこのアカウントであることを `npx wrangler whoami` で確かめてから操作する
- 作成したもの（すべて無料枠）: D1 `tenq-db-dev`、R2 `tenq-files-dev`、Worker `tenq-api-dev`、Pages `tenq-dev`
- 画面の更新: `npm run deploy:preview`（開発用 API に向け、開発用の簡易ログインを有効にしてビルドし、tenq-dev に送る。TENQ/app/ と space-apps には触れない）
- API の更新: `cd api && npx wrangler deploy --env dev`
- DB の変更: `cd api && npx wrangler d1 migrations apply DB --remote --env dev`
- データはダミーのみ（`seed/dev-seed.sql`）。QR の宛先は `system_settings.qr_base_url = https://tenq-dev.pages.dev/TENQ/q/`（開発用 DB だけ）なので、プレビューで印刷した QR はプレビューを開く
- 注意: 開発用の簡易ログイン（`dev-<番号>`）が有効で、URL を知っていればダミーの利用者で入れる。本物のデータを入れない。サイト全体に `X-Robots-Tag: noindex` を付けている。ログインは Space.app の本番 API に向いていない（`HALSPACE_API` は開発用）ので、実アカウントでのログインはプレビューでは使えない
- 不要になったら削除できる: `wrangler pages project delete tenq-dev`、`wrangler delete --env dev`、`wrangler d1 delete tenq-db-dev`、`wrangler r2 bucket delete tenq-files-dev`（中身を空にしてから）

## 9. 本番公開の手順（承認後に実施）

前提: Cloudflare は Space.app と同じアカウント（h.hirano@hirano50.com）。作業前に `npx wrangler whoami` で確認する。

| # | 作業 | 影響 | 承認 |
| --- | --- | --- | --- |
| 1 | Workers の料金プランの確認（無料なら有料プランへ。月 5 米ドル〜） | 課金 | **要** |
| 2 | 本番の D1 `tenq-db`・R2 `tenq-files` を作成し、`api/wrangler.toml` の production に database_id を書く | 新しいリソース（無料枠） | **要** |
| 3 | 本番 D1 にマイグレーションを適用（`npx wrangler d1 migrations apply DB --remote --env production`）。ダミーデータは入れない | 本番 DB | **要** |
| 4 | 本番の API をデプロイ（`npx wrangler deploy --env production` → https://tenq-api.space-app.workers.dev ） | 本番 API | **要** |
| 5 | Space.app 側の `tenq` 登録を本番に反映（solid-api のブランチ `feat/tenq-app-key`、フロントのコミット 2b8d90a） | Space.app 本番（API の再起動を伴う） | **要** |
| 6 | TENQ のコミット一式を main に反映（worktree で cherry-pick → main へ push。`TENQ/app/` に本番用のビルド成果物を含める） | space-apps.pages.dev に /TENQ/ が公開される | **要** |
| 7 | 会社の TENQ 利用を有効にする（Space.app 管理画面で会社・利用者の利用アプリに TENQ） | 対象会社の利用者 | **要** |
| 8 | 初回設定（Space.app の管理者が TENQ を開くと TENQ のシステム管理者になる → 工場・エリア・利用者のロール・点検基準・設備を登録） | 本番データ | 担当者 |
| 9 | QR ラベルの印刷と貼り付け（本番の URL `https://space-apps.pages.dev/TENQ/q/#…` で印刷されることを確認してから） | 現場 | 担当者 |
| 10 | 並行運用（紙の点検表と一定期間併用）→ 紙の廃止 | 現場 | 品質管理担当者 |

反映の確認は、本文の固有文字列（`curl -sL https://space-apps.pages.dev/TENQ/app/ | grep -c "TENQ — Smart Inspection System"`）と `npx wrangler pages deployment list --project-name space-apps` の Production 行、API の `/api/health` で行う。
