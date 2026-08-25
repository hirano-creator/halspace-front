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
node skill-speed-e2e.js    # スキルバー（検索欄→メーラー自動起動）の待ち時間（AI非依存の即時経路・先読み・AI経路の重ね合わせ）
node unknown-contact-e2e.js # 連絡先に未登録の宛先ポップアップ（報告・その場で登録・登録せず送信・再確認しない）
node manual-annotate-e2e.js # マニュアル編集のサムネ→注釈編集の導線（back/manual_id受け渡し・ステップ差し替え）
node large-upload-e2e.js   # 大容量アップロード（R2直送マルチパート）の分割・リトライ・abort・フォールバック
node manual-thumb-e2e.js   # マニュアルのサムネイル（PDF等をクライアント生成→サーバー保存、生成不可は崩れない）
node align-e2e.js          # 並べる機能（justified layout・ライトボックス・PDF/DXFのサムネ生成）
```

## 重要な教訓（マニュアルのサムネイル 2026-08-24）

- **サーバーサムネは画像とOfficeだけ**: `/wn/files/{id}/thumb` は PDF/HEIC/動画/DXF に 404 を返す。
  `<img src="${wnThumbUrl(...)}">` を貼るだけの画面ではこれらが永久にアイコンのままになる。
  クライアント生成（`assets/js/wn-thumb.js`）を通してから表示し、生成物は POST で保存し直す
- **IntersectionObserver は display:none の要素で発火しない**: 「サムネが出たときだけ見せる枠」を
  作ると、隠しているせいで永久に解決されないデッドロックになる。非表示の受け皿は監視せず即解決する
- **成功したときだけ差し替える**: `<img>` の onload まではアイコンを残す。差し替えを先にやると
  生成に失敗した種別（xlsx等）で空枠が残る
- 同じ穴が「並べる」(align.html) にもあった。`wnThumbUrl` を直に貼っている画面は全部同じ症状になるので、
  新しい画面を足すときは `wn-thumb.js`（`wnThumbResolve` / `wnThumbSlotHtml`）を通す

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

## 重要な教訓（スキルバーの待ち時間 2026-08-25）

- **待ち時間の犯人はほぼLLMの往復**。Gemini(2.5-flash-lite) は1往復1.6秒前後かかるので、
  「連絡先で宛先が決まる定型の指示ならAIを呼ばない」経路を作るのが唯一の効く手だった（49ms）。
  リンク発行の並列化やキャッシュは効くが、AI待ちが残る限り体感は変わらない
- **速度のE2Eは遅延つきモックで測る**: `wnRunSkill` / `wnCreateSharesBulk` に固定の遅延を入れ、
  「合計 < AI + リンク発行」で重なりを、`aiCalls === 0` でAI未使用を判定する。実時間は環境で揺れるので
  絶対値ではなく**足し算になっていないこと**を条件にする
- **先読みを測るテストは待ち時間の設計に注意**: 入力デバウンス(500ms)＋発行(モック600ms)が終わる前に
  Enterを押すと残りを待たされ、実装は正しいのにFAILする。実際の入力は数秒かかるので、
  テストでも `デバウンス + 発行 + α` 待ってからEnterする
- **未登録宛先のポップアップが送信を止める**: 連絡先に無いアドレスを使うケースでは
  `localStorage['wn_unknown_contact_popup_off']='1'` を入れておかないと mailto が来ずタイムアウトする
  （ポップアップ自体の検証は unknown-contact-e2e.js の担当）

## 共通パターン（メモリ whatsno_ui_testing より）

- `serviceWorkers: 'block'` でコンテキスト作成（SWがpage.routeを無効化するため）
- トークンは `mock-token` プレフィックス（wn-api.jsが401でもログインへ飛ばさない）
- sessionStorage に `space_token` / `space_user` をセット（addInitScript）
- API は `page.route('**/api/wn/**', ...)` でモック。具体的なパスは汎用の**後**に登録（LIFO優先）
