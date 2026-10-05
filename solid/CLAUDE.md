# SOLID

3D モデリング受発注の案件管理アプリ（発注者 ⇄ HaLSpace 運営 ⇄ モデラー）。HaLSpace モノレポ（git ルートは `c:\dev\my-programming`）の兄弟アプリの1つで、whatsno / space / a.a と同一オリジンで配信される。

## 構成
- フロント: ビルドなしの静的 HTML/JS。`login.html`（独自ログイン）、`app/*.html`（各画面）、`assets/js/`（共通）、`assets/js/pages/`（画面別）、`assets/css/`
- 共通 JS: `api.js`（`apiFetch`）、`auth.js`（ログイン状態・権限判定・サイドバー。**space 等の他アプリとも共有**なので変更はパス分岐で影響を限定する）、`uploader.js`（R2 直送）、`chat-reply.js`（チャット画面と案件詳細で共通）、`wn-picker.js`（What'sNo のファイルを取り込む）
- バックエンド: 別リポジトリ `c:\laragon\www\solid-api`（Laravel）。SOLID 用ルートは `routes/api.php` の `app.member:solid` グループ内
- ファイル実体: Cloudflare R2。署名 URL を一括取得 → ブラウザから PUT → 一括登録
- `_mock-*.html` はデザイン提案用のモック（本番画面ではない）。設計メモは `docs/`

## 権限（ここを間違えると発注者に見えてはいけないものが見える）
- `role`（super_admin / admin / general）はサイト権限、`solid_type`（発注者 / `id_modeler`）は SOLID 内の種別。混同しない
- 判定は `auth.js` の `isInternalAdmin` / `hasAdminLevelAccess` / `isClient` / `canUseChat` を使う。発注者会社の admin は「社外」なので、社内→発注者の操作（納期回答・検査など）は `isInternalAdmin` で判定する
- フロントの判定はバックエンド（`User::isInternalAdmin()` / `isClientSide()`、`SolidChatController::canUseChat()`）と必ず揃える。表示制御だけでなく API 側でも絞る
- チャットと「制作チーム」コメントは社内専用（発注者には出さない）。不具合対策書は HaLSpace・HILANO の2社専用

## 規約
- API 呼び出しは `apiFetch()` を使う（Bearer 付与・20秒タイムアウト・GET のみ再試行・401 でログアウト）。POST 等は二重登録になるので再送しない
- 認証は sessionStorage の `space_token` / `space_user`（タブごとに独立）。localStorage に戻さない
- 通信失敗時に `MOCK` データへ差し替えない。一覧は前回取得分を残してトーストで知らせる（本番で実データが消えて見えた前例あり）
- 新しい Controller を `routes/api.php` に追加したら `use` 文を忘れない
- ファイルを「納品済み（review_status=delivered）」にする処理を新しく作るときは、パーツ台帳 `SolidPartLedger::record()` にも記録する（月間パーツ上限の集計は台帳だけを見るので、漏れるとその納品が数えられない）。`ProjectFile` の save/create を通れば自動で記録されるが、クエリビルダーの一括 `update()` はモデルイベントを通らないので個別に呼ぶ（例: `ProjectController::updateStatus` の物件一括納品）
- 利用者の入力（ファイル名・コメント等）を HTML に埋め込むときはエスケープする
- スマホのズーム対策として入力欄のフォントは 16px 未満にしない
- 調査済みで再調査不要: ブラウザで 3D PDF(PRC) は表示できない／ファイル選択ダイアログで複数フォルダは選べない（D&D で対応）

## キャッシュ
- CSS/JS を変えたら、読み込み元 HTML の `?v=` を上げる（`auth.js` は全画面で読むので全 HTML を揃える）

## デプロイ
- **本番は `main` への push のみ**（Cloudflare Pages 自動デプロイ → space-apps.pages.dev/solid/）。作業ブランチ（`feat/cloudflare-migration`）にコミットし、main へは worktree で cherry-pick して push する。作業ツリーには他アプリの未コミット変更が多いので `git add` はファイル指定で
- 反映確認は HTTP 200 ではなく `curl -sL "<URL>?cb=$RANDOM" | grep -c "<今回追加した固有文字列>"` で行う
- API は solid-api を Railway に push（起動時に migrate が走る）。ローカルは Laragon（`127.0.0.1:8000`）、localhost で開くと自動でローカル API に向く
