# a.a（エー）

What'sNo発・**経営者のための業界SNS**（製造業の同業者が業界内で会社・業界の情報を発信し合う準公開SNS）。

詳細は `docs/` を参照（このファイルには要点とポインタだけ置く）：
- 企画 → [docs/01_企画書.md](docs/01_企画書.md)
- MVP・進め方 → [docs/02_計画書.md](docs/02_計画書.md)
- 技術設計（データモデル/API/フロント）→ [docs/03_技術設計_MVP.md](docs/03_技術設計_MVP.md)
- UIモック（スマホ6画面）→ [mock/index.html](mock/index.html) ／ PC版 → [mock/pc.html](mock/pc.html)
- デプロイ手順 → [docs/04_デプロイ.md](docs/04_デプロイ.md)

## 規約
- **API呼び出しは `wnFetch` / `WN_API_BASE` / `space_token` 必須**（独自fetch禁止。index.htmlが返るJSONエラーの元）。
- バックエンドは **What'sNo API（solid-api / 本番halspace-api）を拡張**。社内用 `wn_*` は触らず、会社横断の公開レイヤ **`aa_*`** を新設（aa_posts / aa_post_media / aa_comments / aa_reactions / aa_news / aa_notifications / aa_company_skills）。新規エンドポイントは prefix `/api/aa`。
- **スマホ第一**（モバイルファースト・レスポンシブ）。viewport/safe-area対応、タッチ44px以上、`<input capture>`でカメラ直アップ。
- **デザイン**：白黒＋**コバルト1色**（#1f48ff、押せる所だけ）／余白多め・枠線ゼロ。👍は白黒アイコン。機密伏せ機能の表記は「マスク」。
- **投稿カテゴリ**：補助金 / セミナー / 設備紹介 / お知らせ / 相談。メディア種別：テキスト / 画像 / 動画 / 資料(PDF)。
- フィードは**ユーザー投稿＋自動ニュース**を混在。SNS(X/Instagram)は**後から個別シェア**。通知はMVPでは**アプリ内のみ**。

## ファイル取り扱い注意
- 既存skill基盤v2 WIPがwn系に未コミットであるため、Wn系ファイルを触る場合は `git add -p` / `git diff --staged` で混入確認。`aa_*` は新規中心で影響小。

## 起動 / デプロイ
（コード未着手。実装に入ったら起動コマンド等を追記）
- **フロント**：a.a＝**Cloudflare Pages**（push即時反映の静的ホスティング）。
- **API（バックエンド）**：Laravel＝**Railway**（halspace-api）。Cloudflareではない。
- **エッジ**：Cloudflare Pages Functions が API の前段プロキシ（大容量アップロード等の中継）。
- デプロイ順は **API→フロント**。
