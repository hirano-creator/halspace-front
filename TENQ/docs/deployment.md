# TENQ デプロイ手順書

- 版: 0.1（第1段階・ドラフト）／作成日: 2026-10-22
- **本番環境へのデプロイ・本番 DB の変更・課金を伴うリソース作成は、オーナーの明示的な承認があるときだけ行う**

## 1. 環境

| 環境 | 画面 | API | D1 | R2 |
| --- | --- | --- | --- | --- |
| ローカル | Vite 開発サーバー（`http://localhost:5173/TENQ/app/`） | `wrangler dev`（`http://localhost:8787`） | ローカル D1（`.wrangler/` 内） | ローカル R2 |
| 開発（リモート） | Pages プレビュー（main 以外のブランチ） | `tenq-api-dev` | `tenq-db-dev` | `tenq-files-dev` |
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
| 2026-10-22 | 未コミット（第2段階） | 68.36 KiB | 17.49 KiB | 67.65 KiB | 仮画面のみ。React 本体で約 70 KiB |

## 7. ロールバック

- API: `npx wrangler deployments list` → `npx wrangler rollback <deployment-id>`
- DB: マイグレーションは戻さず、修正のマイグレーションを追加する。データが壊れた場合は operations.md §4
- 画面: main を前のコミットに戻すコミットを push（承認後）
