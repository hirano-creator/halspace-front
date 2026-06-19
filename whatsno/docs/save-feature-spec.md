# 「What'sNoに直接保存」機能 — 技術説明書

> 計画書：[save-feature-plan.md](./save-feature-plan.md)

メール添付や作成資料を、ダウンロードを挟まず直接 What'sNo に保存するための実装仕様。
**バックエンド（solid-api）・DBは変更しない**。既存 `wnUploadFile()` → `POST /api/wn/files` を流用する。

---

## 1. 全体フロー

### Android（PWA共有経由）
```
メールアプリ等で添付を選択
  → OS共有メニュー「What'sNo」
  → ブラウザが POST /whatsno/app/save.html (multipart/form-data, files[])
  → Service Worker が傍受
      → formData からファイル取得
      → Cache Storage "wn-share" に退避（index + 各ファイル）
      → 303 Redirect: /whatsno/app/save.html?shared=1
  → save.html ロード
      → ?shared=1 を検知 → "wn-share" から File に復元 → キャッシュ掃除
      → キュー表示 → 自動 or ボタンでアップロード
      → wnUploadFile() → POST /api/wn/files
```

### PC / iOS（手動取り込み）
```
save.html を開く（PWA長押しショートカット / ブックマーク / ダッシュボードのリンク）
  → D&D または ファイル選択 / 写真選択 でキューに追加
  → 「保存」 → wnUploadFile() → POST /api/wn/files
```

---

## 2. ファイル別仕様

### 2.1 `manifest.json`

末尾 `"lang": "ja"` の後ろにキーを追加（既存キーは変更しない）。

```jsonc
"share_target": {
  "action": "/whatsno/app/save.html",   // 共有時の遷移先（SWが傍受）
  "method": "POST",
  "enctype": "multipart/form-data",       // ファイル共有には必須
  "params": {
    "title": "title",
    "text":  "text",
    "url":   "url",
    "files": [ { "name": "files", "accept": ["*/*"] } ]
  }
},
"shortcuts": [                            // PWAアイコン長押しメニュー
  {
    "name": "ファイルを保存",
    "short_name": "保存",
    "description": "ファイルや資料をWhat'sNoに直接保存",
    "url": "/whatsno/app/save.html?source=shortcut",
    "icons": [ { "src": "/whatsno/assets/icons/icon-192.png", "sizes": "192x192", "type": "image/png" } ]
  }
]
```

**注意点**
- `share_target.action` は SW スコープ `/whatsno/` 内である必要がある（OK）。
- ファイル付き共有は **`method: POST` + `enctype: multipart/form-data` 必須**（GET だとファイルを運べない）。
- `accept: ["*/*"]` で全形式を受け付ける（製造業の図面・写真・Office等を想定）。

### 2.2 `sw.js`

現状：`CACHE_NAME='whatsno-v32'`、`fetch` 先頭で `method !== 'GET'` は `return`、`activate` で `CACHE_NAME` 以外を全削除。

**変更1：定数**
```js
const CACHE_NAME  = 'whatsno-v33';        // bump（shellにsave.html追加のため）
const SHARE_CACHE = 'wn-share';            // 共有ファイルの一時退避先
const SHELL_URLS  = [
  '/whatsno/app/dashboard.html',
  '/whatsno/app/save.html',                // 追加
  ...
];
```

**変更2：`activate` の掃除対象から `SHARE_CACHE` を除外**
```js
keys.filter(k => k !== CACHE_NAME && k !== SHARE_CACHE).map(k => caches.delete(k))
```
理由：SW更新（activate）が共有直後に走っても退避ファイルを消さないため。`SHARE_CACHE` は復元時に自前で掃除する。

**変更3：`fetch` ハンドラ先頭に共有POST分岐**（`method !== 'GET'` の return より前）
```js
if (event.request.method === 'POST' && url.pathname === '/whatsno/app/save.html') {
  event.respondWith((async () => {
    try {
      const formData = await event.request.formData();
      const files = formData.getAll('files').filter(f => f && f.size > 0);
      const cache = await caches.open(SHARE_CACHE);
      for (const k of await cache.keys()) await cache.delete(k); // 前回分掃除
      const index = [];
      let i = 0;
      for (const f of files) {
        const key = `/whatsno/__share__/${i}`;
        await cache.put(key, new Response(f, {
          headers: { 'Content-Type': f.type || 'application/octet-stream' }
        }));
        index.push({ key, name: f.name || `shared-${i}`, type: f.type, size: f.size });
        i++;
      }
      await cache.put('/whatsno/__share__/index',
        new Response(JSON.stringify(index), { headers: { 'Content-Type': 'application/json' } }));
    } catch (e) { /* 失敗してもsave.htmlへ遷移して手動アップロードに誘導 */ }
    return Response.redirect('/whatsno/app/save.html?shared=1', 303);
  })());
  return;
}
```

**設計理由**
- ファイルは Cache Storage に退避：SW⇄ページ間で `File` を直接渡せない（SWは killed され得る）ため永続層に置く。
- ファイル名は `Response` に乗せず、`index` JSON に別管理（`Content-Disposition` 解釈の差異を避ける）。
- `303` リダイレクトで POST→GET 化（リロードでの再POSTを防ぐ）。

### 2.3 `app/save.html`（新規）

`dashboard.html` と同階層・同作法。

**head**
```html
<link rel="manifest" href="../manifest.json">
<link rel="apple-touch-icon" sizes="180x180" href="../assets/icons/icon-180.png">
<meta name="theme-color" content="#1E3A5F">
<link rel="stylesheet" href="../assets/css/wn-app.css?v=...">
<!-- Fonts / FontAwesome は dashboard.html と同じ -->
```

**body末尾のスクリプト読込順（dashboard.html 準拠）**
```html
<script src="../../solid/assets/js/auth.js?v=6"></script>   <!-- requireSpaceAuth -->
<script src="../assets/js/wn-api.js?v=..."></script>          <!-- wnUploadFile / wnShowToast -->
<script src="../assets/js/pwa.js"></script>                   <!-- SW登録 -->
<script> /* ページロジック（後述） */ </script>
```

**再利用する既存関数**
| 関数 | 定義 | 用途 |
|------|------|------|
| `requireSpaceAuth()` | `solid/assets/js/auth.js:9` | 認証ガード（未ログインはloginへ） |
| `wnUploadFile(file,{onProgress})` | `assets/js/wn-api.js:84` | アップロード（進捗・リトライ込み） |
| `wnShowToast(msg,type)` | `assets/js/wn-api.js:716` | トースト通知 |

**ページロジック概要**
```js
const user = requireSpaceAuth();
if (!user) throw new Error('未認証');

let queue = [];
const MAX = 100 * 1024 * 1024; // 100MB（dashboardのaddToQueueと同方針）

// 1) 共有ファイル復元（?shared=1 のとき）
async function loadSharedFiles() {
  const cache = await caches.open('wn-share');
  const idxRes = await cache.match('/whatsno/__share__/index');
  if (!idxRes) return [];
  const index = await idxRes.json();
  const files = [];
  for (const it of index) {
    const res = await cache.match(it.key);
    if (!res) continue;
    const blob = await res.blob();
    files.push(new File([blob], it.name, { type: it.type || blob.type }));
  }
  for (const k of await cache.keys()) await cache.delete(k); // 復元後に掃除
  return files;
}

// 2) キュー追加（D&D / ファイル選択 / 写真）
function addToQueue(files) {
  files.forEach(f => {
    if (f.size > MAX) { wnShowToast(`${f.name} は100MBを超えています`, 'danger'); return; }
    queue.push(f);
  });
  renderQueue();
}

// 3) アップロード（順次・進捗表示）
async function doUpload() {
  for (let i = 0; i < queue.length; i++) {
    await wnUploadFile(queue[i], { onProgress: pct => updateBar(i, pct) });
  }
  // 完了 → トースト + 「ダッシュボードを開く」「続けて保存」
}
```

**UI構成**
- ヘッダー：戻る（dashboard.html）／タイトル「What'sNoに保存」
- D&Dゾーン（クリックでファイル選択）
- モバイル向け：`<input type="file" accept="image/*" capture>`（写真）と通常ファイル選択
- キュー（ファイル名・サイズ・進捗バー・削除）
- 「保存」ボタン（キューが空なら disabled）
- 完了パネル（成功件数・失敗件数・次アクション）

**共有経由時の挙動**：`?shared=1` 検知 → `loadSharedFiles()` でキュー投入 → そのまま自動アップロード（手間ゼロ）。失敗・空のときは手動アップロードUIにフォールバック。

### 2.4 `app/dashboard.html`（入口リンク）

アップロードモーダル付近に `save.html` への導線を1つ追加（既存モーダルは残す）。例：
```html
<a href="save.html" class="...">メール添付・資料を直接保存</a>
```

---

## 3. 触らないもの
- `solid-api`（エンドポイント／コントローラー）
- DBスキーマ
- 既存アップロードモーダル（後方互換のため残置）
- 保存先フォルダ／プロジェクト選択（現状フラット保存を踏襲）

---

## 4. 検証

| # | 内容 | 期待結果 |
|---|------|----------|
| 1 | ローカル静的配信で `save.html` を開きD&D・選択 | キュー追加→保存で `wnUploadFile` 進捗表示 |
| 2 | DevToolsでSW更新→`save.html`へ疑似POST(multipart) | 303→`?shared=1`でファイル復元 |
| 3 | Android実機（push後）でメール添付を共有→What'sNo | `save.html` で受信・保存成功 |
| 4 | PWAアイコン長押し | 「保存」ショートカット表示 |
| 5 | 回帰：ダッシュボードのアップロード/一覧/オフライン | SW更新後も正常 |

UIテストはバックエンドなしの手順（mock-token / 静的サーバー / API・グローバル関数スタブ）に準拠。

---

## 5. リスクと対策

| リスク | 対策 |
|--------|------|
| SW変更で全ページのキャッシュ挙動に影響 | `CACHE_NAME` bump で旧キャッシュ確実に破棄。共有分岐は `fetch` 先頭のみ追加で既存GET経路は不変 |
| 共有退避が `activate` で消える | `SHARE_CACHE` を掃除対象から除外＋復元時に自前掃除 |
| iOSで共有シートにWhat'sNoが出ない | 仕様（Safari制約）。`save.html` の手動取り込みでカバー、v2で転送アドレス方式検討 |
| 未ログイン状態で共有された | `requireSpaceAuth()` でloginへ。ログイン後の再共有を案内（v1は割り切り） |

---

## 6. v2以降の候補
- メール転送アドレス方式（Inbound受信基盤：Mailgun/CloudMailin等・有料）→ iOS含め確実
- iOS Shortcuts連携で共有シート登録
- 保存先フォルダ/タグ事前指定、共有時のAIタグ自動付与、保存後のスキルバー橋渡し
