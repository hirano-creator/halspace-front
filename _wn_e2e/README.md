# What'sNo E2E テスト

バックエンドなしで What'sNo のUIを Playwright 検証するスクリプト集。
Playwright は `../_aa_e2e/node_modules/playwright-core` を共用（Chrome channel 必須）。

## 実行方法

```powershell
# 1. 静的サーバーを my-programming ルートで起動（相対パス ../../solid/... の解決に必要）
cd c:\dev\my-programming
python -m http.server 8765 --bind 127.0.0.1

# 2. 別ターミナルでテスト実行
cd c:\dev\my-programming\_wn_e2e
node compare-e2e.js        # 比較機能フル（選択導線・4モード・ズーム・失敗時エラー表示）
node compare-multipage.js  # 複数ページA4 PDF・モード巡回・フィット/スクロール/ズーム往復
node compare-prod.js       # 本番(space-apps.pages.dev)のデプロイ済みページを直接検証（サーバー不要）
node email-e2e.js          # メール送信導線（iPhone/PC両方でmailto生成・URL長・起動失敗時のフォールバック）
node manual-annotate-e2e.js # マニュアル編集のサムネ→注釈編集の導線（back/manual_id受け渡し・ステップ差し替え）
node large-upload-e2e.js   # 大容量アップロード（R2直送マルチパート）の分割・リトライ・abort・フォールバック
```

## 重要な教訓（並べる機能のjustified layout 2026-08-04）

- **CSS Gridで列幅を固定する限り隙間は消せない**: 縦長と横長が同じ行に並ぶと行の高さが
  最も高いカードに合わせて確保され、低いカードの下に空白が残る。行の構成自体をJSで決める
  justified layout（行内の高さを揃え、幅を縦横比に比例配分してコンテナ幅ちょうどに合わせる）に切り替えた
- **行の高さ上限(clamp)は最終行だけに掛ける**: 途中の行に掛けると幅が足りなくなり右側に空白が残る。
  さらに目標高さの二分探索が「clampで縮んだ偽の総高さ」を見て誤った値に収束していた
- **検証はgridTemplateColumnsではなく実測で**: 「行の右端がコンテナ右端と一致」「行内のカード下端が揃う」
  「サムネ枠の縦横比が元画像と一致」の3点を測れば、レイアウト方式が変わっても意図を検証し続けられる
- **スマホ幅では1行の下限幅を緩める**: PC用の下限(190px)のままだと1行1枚に落ちて延々と縦に伸びる

## 重要な教訓（大容量アップロード 2026-08-03）

- **並列ワーカーの「まとめ取り」は必ず1本に束ねる**: 署名URLをバッチ取得する処理を
  ワーカー3本が同時に叩き、同じ範囲を3回要求していた。in-flight の Promise を共有して抑える
- **後始末は投げっぱなしにしない**: 失敗時の abort を `.catch()` の fire-and-forget で呼ぶと、
  直後に画面遷移されると送信されない。未完了マルチパートは課金対象なので必ず await する
- **ETag が読めないケースを必ずテストする**: R2 の CORS に `ExposeHeaders: ETag` が無いと
  complete できない。モック側で ETag を返さない経路を用意すると本番の設定漏れを事前に検出できる

## 重要な教訓（比較機能 2026-07-18）

- **canvas.cloneNode() は描画内容をコピーしない** → 白紙表示になる。原本を配置するか drawImage でコピーする
- **CSS Grid の 1fr 列には min-width:0 が必要** → ないと大きな canvas の固有幅で列が膨張し max-width:100% が効かない
- **ズーム処理で style.maxWidth を '' にリセットしない** → インラインの max-width:100%（フィット表示）が消えて巨大表示になる
- **E2Eは本番相当のサイズで**: 小さいテスト画像(400px)ではフィット系のバグは検出できない。パネル幅超（3000px級）とA4複数ページを必ず含める
- **失敗時に沈黙させない**: CDN障害・破損ファイルで「スピナー放置」にならないことをテストで保証する（compare-e2e.js テスト6）

## 重要な教訓（メール導線 2026-07-27）

- **PCコンテキストで page.click が一切効かない**: `syncDesktopToken()` が localhost:39876 に失敗すると `whatsno://` へフォールバックし、Chromeの外部プロトコルダイアログが実クリックを飲み込む。`page.route('http://localhost:39876/sync', ...)` を成功で返してから操作する
- **mailto: は実ブラウザで検証できない**（外部ハンドラ任せ）→ `document.createElement` をフックして `<a>.click()` の href を捕捉する。ハンドラ未登録＝実機の「起動しない」状態がそのまま再現できる
- **日本語は %エンコードで1文字9文字**: mailto の長さテストは必ず日本語本文（500字）＋署名で行う。ASCIIだけでは上限に届かない

## 共通パターン（メモリ whatsno_ui_testing より）

- `serviceWorkers: 'block'` でコンテキスト作成（SWがpage.routeを無効化するため）
- トークンは `mock-token` プレフィックス（wn-api.jsが401でもログインへ飛ばさない）
- sessionStorage に `space_token` / `space_user` をセット（addInitScript）
- API は `page.route('**/api/wn/**', ...)` でモック。具体的なパスは汎用の**後**に登録（LIFO優先）
