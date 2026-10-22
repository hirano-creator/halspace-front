# TENQ セキュリティ設計

- 版: 0.1（第1段階・ドラフト）／作成日: 2026-10-22
- 構成の前提は [architecture.md](architecture.md) の案 A

## 1. 守るもの

| 資産 | 脅威 | 主な対策 |
| --- | --- | --- |
| 点検記録・異常記録 | 改ざん・削除・なりすまし記録 | 認証必須、追記型の記録、訂正履歴、監査ログ、DB トリガー |
| 他社・他工場のデータ | 越境閲覧 | 全 SQL を会社・工場スコープで絞る共通関数、API テストで越境を確認 |
| 写真 | 外部流出 | R2 非公開、Worker で権限確認してから返す、推測しにくいキー |
| アカウント | 端末紛失・共有 | Space.app 側の停止＋TENQ 内停止、sessionStorage（タブを閉じれば消える） |
| 秘密情報 | Git への混入 | `.dev.vars` / Wrangler secrets、`.gitignore`、コミット前チェック |

## 2. 認証

- ログインは Space.app（halspace-api）のメール＋パスワード＋メール OTP の2段階認証をそのまま使う
- トークンは sessionStorage の `space_token`（Space.app 共通。localStorage に置かない＝タブ間の混線と持ち出しを防ぐ）
- tenq-api は毎リクエストでトークンを検証する（halspace-api `/auth/me`。結果はトークンの SHA-256 をキーに 60 秒だけ Worker のメモリにキャッシュ。トークン本体はキャッシュキーにもログにも残さない）
- `apps_enabled` に `tenq` がなければ 403、TENQ 内で利用停止なら 403
### 2-1. 端末のログイン記憶（2026-10-22 決定）

QR を標準カメラで読むと新しいタブで開くため、Space.app 方式（タブを閉じると消える）のままでは毎回ログインになる。TENQ だけ端末にログインを記憶する。

- 仕組み: Space.app でログイン成功 → 「この端末にログインを記憶する」が ON なら、tenq-api が**TENQ 専用のランダムなトークン（256bit）**を発行し、端末の localStorage（キー `tenq_device_token`）に保存。D1 の `device_sessions` には SHA-256 だけを保存する
- **Space.app のトークン（`space_token`）は localStorage に置かない**。記憶するのは TENQ でしか使えないトークンなので、盗まれても他アプリには入れない
- 有効期限 30 日（設定で変更可）。期限が来たら Space.app のログイン（2段階認証を含む）からやり直す
- 取り消し: 本人のログアウト、TENQ の「ユーザー管理」での利用停止・端末単位の取り消し、Space.app 側でのアプリ付与の解除（次の Space ログインで弾かれる）
- 既定: スマホでは ON、PC では OFF。共用 PC・共用タブレットでは OFF にする運用（記憶すると、そのブラウザの全タブが同じ人になるため。2026 年に Space.app で起きた「別タブで別アカウントにログインすると混線する」問題の再発を避ける）
- **弱点と対策**: 記憶中は halspace-api に問い合わせないため、Space.app でアカウントを停止しても、TENQ の記憶トークンは期限まで残る。退職・紛失の手順（§8）では**必ず TENQ 側でも利用停止**する。将来、halspace-api に「ユーザーの有効状態を確認する内部 API」を作れば自動化できる（TENQ 外の変更・要承認）
- 画面の表示データは sessionStorage、記憶トークンだけ localStorage。トークンを URL やログに出さない

### 2-2. Space.app のトークン

- **既知の課題**: Sanctum のトークンは無期限（`sanctum.expiration = null`）。TENQ 側で「最後の検証から `reauth_hours`（既定 12 時間）を超えたら再ログイン」を画面で強制するが、盗まれたトークンを API 側で失効させるのは Space.app 側の作業になる。Space.app 側にトークン有効期限の設定を提案する（TENQ 外の変更なので別途承認）

## 3. 認可

- 権限表は `shared/permissions.ts` の1か所に定義し、API の `can()` と画面の表示制御の両方で使う
- **API 側の判定が正**。画面で非表示にしても API が拒否しなければ不可
- スコープ: すべての取得・更新は `company_id = 利用者の会社` かつ `factory_id IN (所属工場)`（system_admin は会社内全工場）。ID を直接指定された場合もスコープ外なら 404（存在を知らせない）
- 状態遷移（異常の reported → … → closed）は遷移表に書かれた組み合わせ以外を拒否。再確認者は是正実施者と別人であることを API で確認
- QR トークンは「どの設備か」を示すだけ。トークンを知っていても、ログインと権限がなければ何も見えない

## 4. 入力値・Web 脆弱性

| 項目 | 対策 |
| --- | --- |
| 入力検証 | API の入口で型・長さ・列挙値・日付形式を検証（画面の検証は補助）。文字列は上限長を決める（項目名 100、コメント 2,000 文字 等） |
| SQL インジェクション | prepared statement＋`bind()` のみ。並び替え列などの可変部分は許可リストから選ぶ |
| XSS | React のエスケープに任せ、`dangerouslySetInnerHTML` を使わない。印刷帳票も React で描画。CSP を設定（`script-src 'self'`、`object-src 'none'`、`frame-ancestors 'none'` 相当） |
| CSRF | Cookie を使わず Authorization ヘッダーの Bearer のみ → ブラウザが自動送信しないため CSRF は成立しない。CORS は許可オリジン（本番 Pages・ローカル開発）だけ |
| CSV インジェクション | `= + - @ タブ CR` で始まるセルに `'` を前置。UTF-8 BOM＋CRLF |
| オープンリダイレクト | ログイン後の戻り先はアプリ内のハッシュルートだけを許可 |
| クリックジャッキング | `X-Frame-Options: DENY`（API）、画面は CSP の frame-ancestors |
| ヘッダー | `X-Content-Type-Options: nosniff`、`Referrer-Policy: same-origin`、HSTS（Cloudflare 側） |
| 列挙・総当たり | QR トークンは 80bit 程度のランダム値。QR 解決 API にレート制限（Cloudflare の Rate Limiting ルール、または Worker 内の簡易制限） |

## 5. 写真アップロード

- 形式: JPEG / PNG / WebP のみ。Content-Type とファイル先頭のマジックナンバーの両方を確認（SVG・HEIC・PDF は拒否。HEIC は端末側で JPEG に変換してから送る）
- サイズ: 1 枚 10 MB 以下（Content-Length を先に確認し、超えたら本体を読まずに 413）
- 枚数: 1 件あたり上限（既定 10 枚）
- 保存: R2 は非公開バケット。キーは UUID。ファイル名は表示用に保存するだけで、キーには使わない
- 配信: `GET /api/attachments/:id` で権限確認後に返す。`Content-Disposition` と `Content-Type` はサーバーが決める。キャッシュは `private`

## 6. 秘密情報・環境分離

- 秘密情報をソースコード・`wrangler.toml`・ドキュメントに書かない
- ローカル: `api/.dev.vars`（Git 管理外）。本番・開発のリモート: `wrangler secret put`
- 現時点で TENQ が持つ秘密情報はない想定（halspace-api の検証は利用者のトークンで行う）。将来メール送信等で鍵が必要になったら secrets に入れる
- 環境: `dev`（tenq-api-dev / tenq-db-dev / tenq-files-dev）と `production`（tenq-api / tenq-db / tenq-files）を `wrangler.toml` の env で完全に分ける。開発環境の画面は開発 API にしか向かない
- テストデータはダミーのみ。本番データをローカルへコピーしない
- コミット前: `git diff --cached` に `.dev.vars`・トークン・パスワードが含まれていないか確認（development-checklist.md）

## 7. 操作ログ（監査ログ）

記録する操作（例）:

- 認証: TENQ 初回利用、ロール変更、利用停止・解除
- 台帳: 工場・設備・点検基準の作成・更新・停止・廃止（前後の値）、QR 発行・再発行
- 点検: 開始・引き継ぎ・完了・取消・訂正（理由）
- 異常: 報告、状態遷移、担当・期限の変更、承認
- 出力: CSV・帳票の出力（条件と件数）
- 設定: システム設定の変更

閲覧は工場長・システム管理者。ログは追記専用でトリガーにより更新・削除不可。

## 8. 端末紛失・退職時の手順

1. 本人または上長がシステム管理者に連絡
2. システム管理者が TENQ の「ユーザー管理」で利用停止（即時に API が 403 を返す。端末に記憶したログインもすべて取り消される）
3. Space.app 管理画面でパスワードを再発行（＝既存トークンの失効は Space.app 側の機能に依存。§2 の既知の課題）
4. 監査ログで紛失時刻以降の操作を確認し、不審な記録があれば訂正手続き
5. 端末が見つかった・新端末を用意したら、利用停止を解除

詳細手順は [operations.md](operations.md)。

## 9. 確認方法（第7段階）

- 権限表の全マス × API の自動テスト（許可・拒否の両方）
- 他社・他工場の ID を指定した越境テスト
- 不正な写真（偽装拡張子・巨大ファイル・SVG）の拒否テスト
- `npm audit` と依存の棚卸し
- CSP・セキュリティヘッダーの確認（curl でレスポンスヘッダーを見る）
