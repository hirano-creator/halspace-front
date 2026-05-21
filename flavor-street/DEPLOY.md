# Netlify デプロイ手順

このリポジトリには WordPress テーマのソースと、Netlifyで静的プレビューを公開するための設定が含まれています。

## デプロイ方法

### 方法1: ドラッグ&ドロップ（最も簡単）

1. [Netlify](https://app.netlify.com/) にログイン
2. **Sites** 画面を開く
3. `flavor-street` フォルダを丸ごとドラッグ&ドロップ
4. 自動で公開URLが発行されます

### 方法2: Netlify CLI

```bash
# Netlify CLIをインストール（初回のみ）
npm install -g netlify-cli

# ログイン
netlify login

# flavor-street フォルダで実行
cd flavor-street
netlify deploy --prod
```

初回実行時は以下を選択:
- **Create & configure a new site**
- チーム / サイト名を指定
- **Publish directory**: `.`（カレントディレクトリ）

### 方法3: Git連携（継続的デプロイ）

1. GitHub / GitLab / Bitbucket にリポジトリをプッシュ
2. Netlify で **Add new site** → **Import an existing project**
3. リポジトリを選択
4. ビルド設定は `netlify.toml` が自動で読み込まれます
   - Publish directory: `.`
   - Build command: なし

## 設定ファイル

- **`netlify.toml`** — メイン設定（リダイレクト・キャッシュ・セキュリティヘッダー）
- **`_redirects`** — ルートアクセスを `preview.html` にリダイレクト

## デプロイ後のURL構成

| URL | 表示内容 |
|---|---|
| `/` | トップページ（`preview.html`） |
| `/preview.html` | 同上 |
| `/*.php` | `preview.html`にリダイレクト（ソース保護） |

## WordPressとNetlifyの関係

このプロジェクトは **デザインプレビュー用の静的HTML**（`preview.html`）と **WordPressテーマのソース**（`.php`ファイル群）の両方を含んでいます。

- **Netlify** は `preview.html` のみを配信（デザイン確認・共有用）
- **WordPress本番環境** では `.php` ファイル群をテーマとして使用

本番でWordPress運用する際は、Netlifyではなく通常のWordPressホスティング（Xserver, ConoHa WING, Kinsta等）にテーマフォルダをアップロードしてください。
