# a.a 技術設計（MVP）

> 最終更新: 2026-06-21 / MVPローカル実装完了。企画は [01_企画書.md](01_企画書.md)、MVPは [02_計画書.md](02_計画書.md)。

## 決定事項
- **バックエンド = What'sNo APIを拡張**（ローカル `c:\laragon\www\solid-api` / 本番 halspace-api on Railway）。認証・R2・サムネ・Geminiの既存基盤を再利用。
- 既存 `wn_*` テーブルは**変更しない**。会社横断の公開レイヤ `aa_*` を新設。
- フィードに **ユーザー投稿＋自動ニュース** を混在。SNS(X/Instagram)は **後から個別シェア**。
- 通知は **アプリ内通知＋ブラウザPush通知**（Web Push/VAPID、`aa_push_subscriptions`）。`AaNotificationService::notify()`から両方発火。iOSはホーム画面追加（standalone）が前提。
- **PWA**：`manifest.json`＋`sw.js`（v10）でホーム画面追加→standalone起動。`sw.js`に`push`/`notificationclick`ハンドラあり。

## 設計の核心：専用レイヤ aa_* を新設
既存 What'sNo は全テーブルが `company_id` の**社内スコープ**、投稿実体 `wn_files` は `storage_path` 必須で**ファイル前提**（テキスト投稿不可）。改造すると社内機能に副作用。
→ **会社横断の公開レイヤ `aa_*` を新設**し、必要に応じて wn_file を参照。アップロード処理・R2ストリーム中継・Geminiはサービス層で再利用。

## データモデル（実装済みテーブル）

### コアテーブル（migration: 2026_06_20_000001_create_aa_tables）
| テーブル | 主要カラム |
|---|---|
| `aa_posts` | author_user_id / author_company_id / category(補助金/セミナー/設備紹介/お知らせ/相談) / kind(post\|news) / body(nullable) / visibility(industry\|invite) / source_wn_file_id(nullable) / is_masked / status(published\|hidden) / news_title / news_url / news_source / news_summary / dedup_key(unique) |
| `aa_post_media` | post_id / kind(image\|video\|document) / storage_path / mime_type / thumb_path / width / height / duration / sort_order |
| `aa_comments` | post_id / user_id / body |
| `aa_reactions` | post_id / user_id / kind（unique: post_id+user_id+kind） |
| `aa_notifications` | user_id / type(comment/reaction/mention/news) / ref(post_id等) / read_at |
| `aa_company_skills` | company_id / label（対応領域タグ） |

### 管理テーブル（migration: 2026_06_21_000001_create_aa_admin_tables）
| テーブル | 主要カラム |
|---|---|
| `aa_news_feeds` | category / source / url / is_active / last_fetched_at |
| `aa_invites` | code(unique) / note / status(open\|used\|revoked) / used_by_user_id |

## バックエンド構成（solid-api）

### モデル（`app/Models/Aa/`）
`AaPost`, `AaPostMedia`, `AaComment`, `AaReaction`, `AaNotification`, `AaCompanySkill`, `AaNewsFeed`, `AaInvite`

### サービス
- `app/Services/AaNotificationService.php` — 静的 `notify()` メソッド。自己通知スキップ。

### コントローラー（`app/Http/Controllers/Aa/`）
- `AaPostController` — feed / show / store / fromWn / update / destroy / comments / postComment / react / mediaView / mediaRaw / shareLink。`formatPost()` が `is_mine` フラグを付与。
- `AaNotificationController` — index / read / readAll
- `AaAdminController` — stats / posts(CRUD+status) / news(+runImport) / feeds(CRUD+toggle) / members(+toggleUser) / invites(CRUD+revoke)

### Artisanコマンド
- `app/Console/Commands/AaImportNews.php` — `aa:import-news`
  - `aa_news_feeds` からアクティブなフィードを取得（config/aa.php がフォールバック）
  - RSS2/Atom をパース、Gemini で要約、`dedup_key`（sha1）で重複排除
  - `Kernel.php` で毎時スケジュール実行（`->hourly()->withoutOverlapping()`）

### API ルート（`routes/api.php` — prefix `/api/aa`）

| メソッド | パス | 認証 | 用途 |
|---|---|---|---|
| GET | `/aa/feed` | ✅ | 投稿+ニュース混在・カテゴリ絞り込み |
| GET | `/aa/posts/{id}` | ✅ | 投稿詳細 |
| POST | `/aa/posts` | ✅ | 新規投稿（multipart: media[], category, body, is_masked） |
| PATCH | `/aa/posts/{id}` | ✅ | 投稿編集（JSON: category, body） |
| DELETE | `/aa/posts/{id}` | ✅ | 投稿削除（自分のみ） |
| POST | `/aa/posts/from-wn/{id}` | ✅ | What'sNoファイルから公開 |
| GET | `/aa/posts/{id}/comments` | ✅ | コメント一覧 |
| POST | `/aa/posts/{id}/comments` | ✅ | コメント投稿 |
| POST | `/aa/posts/{id}/reactions` | ✅ | 👍トグル |
| POST | `/aa/posts/{id}/share-link` | ✅ | シェアURL生成 |
| GET | `/aa/media/{id}/view` | ✅ | メディアURL取得（R2署名URL） |
| GET | `/aa/media/{id}/raw` | なし | メディアバイナリ（公開ストリーム中継） |
| GET | `/aa/notifications` | ✅ | 通知一覧 |
| POST | `/aa/notifications/{id}/read` | ✅ | 既読 |
| POST | `/aa/notifications/read-all` | ✅ | 全既読 |
| POST | `/aa/push-subscriptions` | ✅ | ブラウザPush購読登録（PushSubscription.toJSON()） |
| DELETE | `/aa/push-subscriptions` | ✅ | ブラウザPush購読解除 |
| GET | `/aa/admin/stats` | 管理者 | ダッシュボード統計 |
| GET/PATCH/DELETE | `/aa/admin/posts{...}` | 管理者 | 投稿モデレーション |
| GET/POST | `/aa/admin/news{...}` | 管理者 | ニュース管理・手動インポート |
| GET/POST/PATCH/DELETE | `/aa/admin/feeds{...}` | 管理者 | RSSフィードCRUD |
| GET/PATCH | `/aa/admin/members`・`users/{id}/toggle` | 管理者 | メンバー・ユーザー管理 |
| GET/POST/PATCH | `/aa/admin/invites{...}` | 管理者 | 招待コードCRUD |

> 管理者ルートは `role:super_admin,jp_admin` ミドルウェアで保護。

## フロント構成（`c:\dev\my-programming\a.a`）

### 共有アセット
| ファイル | 役割 |
|---|---|
| `assets/aa-api.js` | `aaFetch` ラッパー（認証ヘッダ・BaseURL一元管理）、`AA` グローバルオブジェクト |
| `assets/aa-pdf.js` | `aaRenderPdf(url, container)` — pdf.js CDN を遅延ロードして1ページ目をcanvas描画 |
| `assets/aa-shell.js` | PC幅（≥1024px）で3カラム `.deck` に自動切替。右パネルにニュース・話題の投稿を描画。管理者には「管理」ナビリンクを追加 |
| `assets/app.css` | 共有スタイル（`.wrap` max-width 600px、`.post`、`.chip`、`.tabbar`、`.overlay`、`@media(min-width:1024px)` デッキレイアウト） |
| `manifest.json` | name=a.a / display=standalone / theme_color=#0a0a0a |
| `sw.js` | CACHE=`aa-shell-v7`。シェルをキャッシュ。API・メディアURLは常にネットワーク |

### 画面
| ファイル | 内容 |
|---|---|
| `index.html` | ログイン（email+password）、SW登録 |
| `app/feed.html` | カテゴリフィルタ、投稿カード、ニュースカード、👍・シェア |
| `app/post.html` | 投稿詳細、メディアプレビュー（PDF canvas含む）、コメント、自分の投稿はインライン編集 |
| `app/compose.html` | 新規投稿。What'sNoファイルピッカー（modal→選択→フォーム）、カテゴリチップ、画像/動画/PDF入力、マスクエディタ（canvas黒塗り） |
| `app/profile.html` | 会社名・担当者名表示、管理画面へのリンク（管理者のみ） |
| `app/notifications.html` | 通知一覧、全既読 |
| `app/admin.html` | 管理者専用4タブ（ダッシュボード/投稿/ニュース/メンバー） |

### API呼び出し規約
`aaFetch` を必ず使う（直接 `fetch` 禁止）。`apiBase()` がホスト名を見て本番URL/ローカルURLを自動判定。トークンは `localStorage.aa_token`。FormDataの場合はContent-Typeをブラウザに任せる。PATCH/PUTはJSON送信（PHPはmultipart PATCH をパースしない）。

```
ローカル  → http://127.0.0.1:8000/api
本番      → https://halspace-api-production.up.railway.app/api
```

## デプロイ構成
- **API** = Railway（halspace-api-production.up.railway.app）。push で自動デプロイ → migrate 自動実行。
- **フロント** = Cloudflare Pages（push で即時反映）。
- **デプロイ順**: API → フロント。詳細手順は [04_デプロイ.md](04_デプロイ.md)。

## 残課題（後続フェーズ）
- **招待参加フロー**：招待コード → 新規ユーザー登録（コード発行はadminで実装済み。ログインページはスタブ）
- **プロフィール編集**：bio・対応領域タグ・自分の投稿一覧
- **pdf.js ローカル同梱**：現在CDN。オフラインPWA対応には vendor 化が必要
- **動画サムネイル（サーバーサイド）**：現在はクライアント生成を想定
- **2FA**：What'sNo認証側（Laravel Fortify/TOTP）に追加。a.a側の手戻りなし
