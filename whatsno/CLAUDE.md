# What'sNo

工場・図面向けファイル管理 PWA。HaLSpace モノレポ（git ルートは `c:\dev\my-programming`）の兄弟アプリの1つで、solid / space / a.a と同一オリジンで配信される。

## 構成
- フロント: ビルドなしの静的 HTML/JS。`index.html`（LP）、`app/*.html`（各画面）、`assets/js/`（共通）、`assets/js/pages/`（画面別）、`assets/css/wn-app.css`
- バックエンド: 別リポジトリ `c:\laragon\www\solid-api`（Laravel）。`app/Http/Controllers/WhatsNo/Wn*Controller.php`、ルートは `routes/api.php`
- ファイル実体: Cloudflare R2。50MB超はブラウザから R2 へ直接マルチパート送信
- `tools/`: Windows のデスクトップ連携（右クリックメニュー等）用の PowerShell
- 設計メモ: `docs/`

## 規約
- API 呼び出しは必ず `assets/js/wn-api.js` の `wnFetch('/wn/...')` を使う。独自の fetch は相対パスになり、JSON の代わりに index.html が返ってくる。`null`（401 処理済み）→ `res.ok` → `res.json()` の順で確認する
- 認証は sessionStorage の `space_token` / `space_user`（タブごとに独立）。localStorage に戻さない
- 新しい Controller を `routes/api.php` に追加したら `use` 文を忘れない（本番が 500 のまま気付かなかった前例あり）
- ファイル名など利用者の入力を HTML・JS に埋め込むときはエスケープする（`jsq()` 等）。共有リンクの実体配信は `authorizeShareToken` を必ず通す
- Gemini は無料枠（1日20リクエスト）で運用しているため、LLM の呼び出し回数を増やさない

## キャッシュ（変更が反映されない原因の大半）
- CSS/JS を変えたら、読み込み元 HTML の `?v=` をコミットのたびに上げる
- アプリシェルを変えたら `sw.js` の `CACHE_NAME` も上げる
- サムネイル生成を変えたら `THUMB_VER` を上げる

## デプロイ
- **本番は `main` への push のみ**（Cloudflare Pages が自動デプロイ → space-apps.pages.dev/whatsno/）。作業ブランチへの push は preview 環境にしか出ない。作業ツリーには他アプリの未コミット変更が多いので、main へは worktree で cherry-pick して push する
- 反映確認に HTTP 200 は使えない（存在しないパスでも 200 のフォールバックが返る）。`curl -sL "<URL>?cb=$RANDOM" | grep -c "<今回追加した固有文字列>"` で確認する
- API は solid-api を Railway に push（起動時に migrate が走る）

## テスト
- UI の E2E は `../_wn_e2e/`（Playwright、手順は README.md）。静的サーバーは my-programming ルートで起動し、トークンは `mock-token...` にする。`serviceWorkers: 'block'` を指定しないと `page.route` のモックが効かない
- スマホで入力欄にフォーカスしたときのズーム対策として、入力欄のフォントは 16px を下回らないようにする
