# TENQ — Smart Inspection System

TENQ（テンク）は、QR コードを使った工場設備の日常点検システムです。設備に貼った QR をスマートフォンで読み、点検項目ごとに「正常 / 異常 / 対象外」を選ぶだけで点検記録が残ります。異常が見つかったら、その場で写真付きの異常報告を上げ、是正処置・再確認・承認まで追跡できます。

Space.app のアプリの1つとして提供し、ログインは Space.app のアカウントを使います。

> 開発は第7段階（総合テスト・本番準備）まで完了しています。本番公開は承認待ちです（[docs/deployment.md](docs/deployment.md) §9）。実機確認用のプレビュー: https://tenq-dev.pages.dev/TENQ/app/ （ダミーデータ）

## 主な機能

- 設備台帳（工場・設置場所・分類・担当者・点検頻度・点検基準）
- 設備ごとの QR コード発行・A4 ラベル印刷・再発行
- スマホでの日常点検（必須項目チェック・二重登録防止・未点検の把握）
- 異常報告と是正処置の追跡（発生 → 未対応 → 対応中 → 是正完了 → 再確認 → 承認・完了）
- ダッシュボード、検索、CSV 出力、印刷帳票、ISO 監査向けの記録一覧
- 訂正履歴・点検基準の版管理・監査ログ

## 構成

| 層 | 技術 |
| --- | --- |
| 画面 | React + TypeScript + Vite（Cloudflare Pages で配信） |
| API | Cloudflare Workers（Hono） |
| データ | Cloudflare D1（記録）、Cloudflare R2（写真） |
| ログイン | Space.app（halspace-api）のアカウント・2段階認証 |

詳しくは [docs/architecture.md](docs/architecture.md)。

## ドキュメント

| 文書 | 内容 |
| --- | --- |
| [docs/requirements.md](docs/requirements.md) | 要件定義（機能・権限・画面・**要確認事項**） |
| [docs/architecture.md](docs/architecture.md) | 技術構成・システム設計・容量見積もり |
| [docs/database.md](docs/database.md) | テーブル定義・索引・マイグレーション |
| [docs/security.md](docs/security.md) | セキュリティ設計・端末紛失時の手順 |
| [docs/operations.md](docs/operations.md) | 運用・バックアップ・復旧・保存期間 |
| [docs/deployment.md](docs/deployment.md) | 環境・デプロイ手順・サイズ記録 |
| [docs/test-plan.md](docs/test-plan.md) | テスト計画 |
| [docs/development-checklist.md](docs/development-checklist.md) | 段階ごとの完了条件・コミット前確認 |
| [docs/user-guide.md](docs/user-guide.md) | 利用者向けの操作説明（役割ごと） |
| [CLAUDE.md](CLAUDE.md) | 開発ルール（Claude Code 向け） |

## 開発環境の構築

必要なもの:

- Node.js 20 以上（LTS）
- npm（workspaces を使用）
- Wrangler（`npx wrangler` で利用。Cloudflare アカウントへのログインはリモート環境を使うときだけ）
- ログインの確認用に、ローカルの halspace-api（Laragon・`http://127.0.0.1:8000`）

手順:

```
cd TENQ
npm install
npm run db:migrate:local      # ローカル D1 にテーブルを作成
npm run db:seed:local         # ダミーデータを投入
npm run dev                   # 画面 http://localhost:5173/TENQ/app/ と API http://127.0.0.1:8787
```

テストとチェック:

```
npm test                      # 単体・API と DB の結合テスト
npm run test:e2e              # E2E（PC・スマホ表示。サーバーは自動で起動）
npm run typecheck             # 型チェック
npm run build                 # 画面をビルド（TENQ/app/ に出力）
npm run check:size            # Worker と画面のサイズ確認
```

ローカルでは D1・R2 とも Wrangler のローカル実装（Miniflare）を使うため、Cloudflare 上のリソースや課金は発生しません。

## 運用上の注意

- 本番デプロイ・本番データの変更・課金を伴う変更は、担当者の承認を得てから行います（[docs/deployment.md](docs/deployment.md)）
- TENQ は記録の信頼性を支える道具です。ISO への適合は、適用規格・社内手順・保存期間・承認方法を品質管理担当者が確認したうえで判断してください
- 危険度の高い異常の扱い（設備の使用停止・連絡）は、会社の安全管理ルールに従ってください
