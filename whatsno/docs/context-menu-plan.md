# What'sNo Windowsコンテキストメニュー連携 — 技術計画書

作成日: 2026-06-24

---

## 概要

Windowsエクスプローラーでファイルを右クリックすると「What'sNoに保存」が表示され、クリック一発で本番APIにアップロードできる仕組みを実装する。

---

## アーキテクチャ

```
ユーザー操作
  └─ 右クリック → 「What'sNoに保存」
        │
        ▼
  wn-upload.ps1（PowerShellスクリプト）
        │  ① %APPDATA%\WhatsNo\config.json からトークン読み取り
        │  ② ファイルをrawバイナリで読み込み
        │
        ▼
  POST https://halspace-api-production.up.railway.app/api/wn/files
        Authorization: Bearer {space_token}
        X-File-Name: {URLエンコード済みファイル名}
        Content-Type: {MIMEタイプ}
        Body: rawバイナリ
        │
        ▼
  Windowsトースト通知（成功 / エラー）
```

---

## API仕様（調査済み）

| 項目 | 値 |
|------|-----|
| エンドポイント | `POST /wn/files` |
| 本番ベースURL | `https://halspace-api-production.up.railway.app/api` |
| 認証 | `Authorization: Bearer {space_token}` |
| ファイル名 | `X-File-Name: {URLエンコード}` ヘッダーで送信 |
| ボディ形式 | rawバイナリ（multipartではない） |
| Content-Type | ファイルのMIMEタイプ |
| タイムアウト | 300秒 |

トークン取得元: ブラウザの `localStorage.getItem('space_token')`

---

## 構成要素（4ファイル）

| ファイル | 役割 |
|----------|------|
| `wn-install.ps1` | セットアップ（初回1回実行） |
| `wn-upload.ps1` | アップロード本体スクリプト |
| `wn-uninstall.ps1` | アンインストール |
| What'sNo側: ダッシュボードにトークン表示UI | トークン取得の導線 |

---

## レジストリ方針: HKCU（個人）を採用

### 採用理由

| 観点 | 理由 |
|------|------|
| UX | UAC（管理者確認）が出ない。ダブルクリックのみで完結 |
| 管理 | 各自のアカウントに閉じるため他ユーザーへの影響なし |
| セキュリティ | 最小権限の原則に従い、システム全体への影響なし |

### レジストリパス

```
HKEY_CURRENT_USER\Software\Classes\*\shell\WhatsNoSave
  (既定) = "What'sNoに保存"

HKEY_CURRENT_USER\Software\Classes\*\shell\WhatsNoSave\command
  (既定) = powershell.exe -WindowStyle Hidden -ExecutionPolicy Bypass
           -File "%APPDATA%\WhatsNo\wn-upload.ps1" "%1"
```

---

## トークン橋渡し設計

`space_token` はブラウザの `localStorage` にあり、PowerShellから直接読めない。

```
What'sNo ダッシュボード（設定パネル）
  └─ 「デスクトップ連携」セクション追加
       ├─ トークン表示（マスク）+ コピーボタン
       └─ セットアップ手順の案内
        │
        ▼（ユーザーがコピー）
  wn-install.ps1 を実行
        └─ 「トークンを貼り付けてください:」→ 入力
        └─ %APPDATA%\WhatsNo\config.json に保存
```

---

## 実装ステップ

### Step 1 — What'sNoダッシュボードにトークン表示UI追加

対象: `app/dashboard.html`, `assets/js/pages/wn-dashboard.js`

- 設定パネルに「デスクトップ連携」セクションを追加
- `localStorage.getItem('space_token')` を取得してマスク表示
- 「コピー」ボタンでクリップボードに送る
- `wn-install.ps1` のダウンロードリンクと手順案内を表示

### Step 2 — PowerShellスクリプト群の作成

**`wn-install.ps1`（初回セットアップ）**
1. `%APPDATA%\WhatsNo\` フォルダを作成
2. `wn-upload.ps1` を `%APPDATA%\WhatsNo\` に配置
3. トークン入力を促し `config.json` に保存
4. `HKCU` にレジストリエントリを追加
5. 「セットアップ完了」を表示

**`wn-upload.ps1`（アップロード本体）**
1. `config.json` からトークン読み取り（なければ案内を表示して終了）
2. ファイルをバイト配列で読み込み
3. MIMEタイプを判定（拡張子ベース）
4. `Invoke-WebRequest` で POST 送信
5. 成功 → トースト通知、失敗 → エラーダイアログ

**`wn-uninstall.ps1`**
1. `HKCU` のレジストリエントリを削除
2. `%APPDATA%\WhatsNo\` フォルダを削除（`config.json` 含む）

### Step 3 — トークン更新フロー

What'sNoダッシュボード →「デスクトップ連携」→ 新トークンをコピー → `wn-install.ps1` 再実行

---

## セキュリティ考慮事項

| 項目 | 対策 |
|------|------|
| `config.json` のトークン保護 | ファイルACLをカレントユーザーのみに制限（`icacls` で設定） |
| PowerShell実行ポリシー | `-ExecutionPolicy Bypass` をスクリプト実行時のみ限定（ポリシー変更はしない） |
| ファイルパスのインジェクション | `%1` は `""` で囲み、スクリプト内でパス検証 |
| HTTPS通信 | 本番エンドポイントはHTTPS固定 |

---

## 制限事項（初期スコープ外）

- 複数ファイル同時アップロード（Windows の `%1` は1ファイルのみ渡す仕様）
- フォルダごとのアップロード
- アップロード先フォルダの指定

---

## 作業量見積もり

| タスク | 規模 |
|--------|------|
| ダッシュボードUI追加（Step 1） | 小（HTML数行 + JS数行） |
| `wn-install.ps1` | 中（50〜80行） |
| `wn-upload.ps1` | 中（60〜100行） |
| `wn-uninstall.ps1` | 小（20行） |
