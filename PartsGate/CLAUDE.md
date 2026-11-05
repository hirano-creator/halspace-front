# PARTS GATE

バーコード照合・出荷確認システム。HaLSpace モノレポ（git ルート `c:\dev\my-programming`）の Space.app アプリ。構成は TENQ と同じ（画面 = `space-apps.pages.dev/PartsGate/app/`、API = Cloudflare Workers + Hono、D1、R2、ログインは halspace-api の `/auth/me`）。TENQ のコード（`TENQ/api/src/middleware/auth.ts` など）を流用してよい。

## 状態

STEP 6（バーコード照合）までローカルで完了（2026-11-05）。次は STEP 7（履歴・分析）。実機の USB リーダーでの確認（Q-1）が残り。設計書は `docs/`、未確定事項は `docs/requirements.md` §6、画面の方向性は `_mock-c-compact.html`（読み取り）・`_mock-import-analytics.html`（取込・分析）。起動・テストは README。

## 実装の決まり

- 業務データの SQL は `api/src/lib/db.ts` の `scoped(c)` を通す。会社は SQL の中で必ず `?1`（`company_id = ?1`）、値は `?2` 以降。企業管理（`routes/companies.ts`）だけが例外
- API を足したら `api/test/tenancy.test.ts` の `COVERED` にも足す（足し忘れるとテストが失敗する）
- マスターは `api/src/lib/master.ts` の `masterRoutes()`、画面は `web/src/pages/MasterPage.tsx` の設定で作る
- `npm run db:reset:local` は開発サーバーを止めてから（動いたままだとサーバーが DB を見失う）

## 必ず守ること

- **企業間のデータ分離が最優先**。company_id はログイン情報からだけ取り、SQL は共通のスコープ関数を通す（`docs/security.md` §1）。API を足したらテナント分離テストも足す
- **無料プランで運用する**（CPU 1 回 10ms、D1 読み取り 1 日 500 万行）。重い処理は画面側、検索は索引必須、ダッシュボードは集計表。性能テストはローカルだけ（`docs/architecture.md` §6）
- 照合の最終判定は API。数え上げは scan_logs の INSERT とトリガーで行う（`docs/scan-matching.md` §5）
- 読み取り履歴・監査ログは上書き・削除しない。CSV の取り込み直しで読み取り履歴を変えない
- 不明な業務ルールは推測で決めず、オーナーに聞く
- 実データ（得意先名・グローバル番号など）をコード・文書・テストに入れない。サンプル CSV はコミットしない
- コミットは `git add PartsGate/...` のようにファイル指定（`git add -A` 禁止。モノレポに他アプリの未コミット変更がある）
- 課金・本番反映・Space.app 側の変更はオーナーの承認後
- コメント・ドキュメントは日本語
