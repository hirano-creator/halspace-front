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
```

## 重要な教訓（比較機能 2026-07-18）

- **canvas.cloneNode() は描画内容をコピーしない** → 白紙表示になる。原本を配置するか drawImage でコピーする
- **CSS Grid の 1fr 列には min-width:0 が必要** → ないと大きな canvas の固有幅で列が膨張し max-width:100% が効かない
- **ズーム処理で style.maxWidth を '' にリセットしない** → インラインの max-width:100%（フィット表示）が消えて巨大表示になる
- **E2Eは本番相当のサイズで**: 小さいテスト画像(400px)ではフィット系のバグは検出できない。パネル幅超（3000px級）とA4複数ページを必ず含める
- **失敗時に沈黙させない**: CDN障害・破損ファイルで「スピナー放置」にならないことをテストで保証する（compare-e2e.js テスト6）

## 共通パターン（メモリ whatsno_ui_testing より）

- `serviceWorkers: 'block'` でコンテキスト作成（SWがpage.routeを無効化するため）
- トークンは `mock-token` プレフィックス（wn-api.jsが401でもログインへ飛ばさない）
- sessionStorage に `space_token` / `space_user` をセット（addInitScript）
- API は `page.route('**/api/wn/**', ...)` でモック。具体的なパスは汎用の**後**に登録（LIFO優先）
