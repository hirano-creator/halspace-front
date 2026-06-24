# What'sNo スキル機能 仕様書

> ハンズオンでゼロから再構築するための設計仕様。現行の途中実装には依存せず、目標とする完成形を定義する。
> フロント=`whatsno`（バニラJS・PWA）／バックエンドAPI=`solid-api`（Laravel）。デプロイ順は **API → フロント**。

---

## 1. 目的

ダッシュボードの1つの入力欄に自然言語を打ち込むと、文意に応じて**複数のスキルが自動で振り分けられて発動**する。さらに**ユーザー自身が自分のスキル（マイスキル）を作れる**。誤操作を防ぐため、すべてのスキルは「**下書き → 人が確認 → 実行**」を徹底する。

達成する3要件:
1. **ディスパッチャ型** — 1入力欄から、入力文に応じて色々なスキルが発動する。
2. **ユーザー定義スキル** — ノーコード＋会話で自分のスキルを作れる。
3. **実行ログ** — いつ・誰が・どのスキルを・どの引数で実行したかをDBに残す。

---

## 2. 用語

| 用語 | 意味 |
|------|------|
| スキル | 自然言語の指示から発動する1つのアクション（メール送信・共有リンク発行など） |
| ディスパッチャ / ルーター | 入力文から「どのスキルを・どの引数で」発動するかを決めるLLM処理 |
| ハンドラ | 各スキルの本体。確認用の下書き(draft)を作るだけで副作用は持たない |
| draft（下書き） | ユーザーに確認させるための内容。実行前のプレビュー |
| 組み込みスキル | 開発者が用意した固定スキル |
| マイスキル | ユーザーが定義した独自スキル（組み込みツール＋固定パラメータの組合せ） |
| 実行ログ | スキル実行の監査記録（`wn_skill_runs`） |

---

## 3. 全体アーキテクチャ

```
[ skillInput 自然言語 ]
   │  POST /api/wn/skills/run { instruction, file_id, contacts }
   ▼
[ WnSkillController::run ]
   ① ルーティング   GeminiService::routeSkill(instruction, スキルカタログ, contacts)
                    → { skill, args, missing, confidence }
   ② スキル解決     SkillRegistry が「組み込み＋マイスキル」から該当ハンドラを取得
   ③ 下書き生成     SkillHandler::draft(file, args, user)  ← 副作用なし
   ④ ログ記録       wn_skill_runs に status='drafted' で保存 → run_id
   │  レスポンス { skill, action_type, draft, missing, message, blocked, run_id }
   ▼
[ フロント runSkill ]
   action_type で分岐 → スキル別の確認UI → 既存API（send-email / share / approval / ai-tags）で実行
   │  POST /api/wn/skills/runs/{id}/confirm { status:'executed'|'canceled' }
   ▼
[ 実行ログ更新 ]
```

**設計の肝**: LLMは「どのスキルを・どの引数で」だけを決める。副作用（送信・発行・申請）は**既存の安全なAPIだけ**が起こす。ハンドラ自身は副作用を持たず、実行はフロントの既存API呼び出しに委譲する。これで全スキルの「下書き→確認→実行」が統一される。

---

## 4. 設計原則（安全モデル）

1. **任意コード実行はさせない。** スキルが呼べるのは開発者が用意した既存APIに限定。
2. **下書き→確認→実行を徹底。** ハンドラは副作用なし。実行は必ずユーザー確認の後。
3. **マイスキルは「組み込みツール＋固定パラメータ＋テンプレ」の組合せに限定。** 自由なロジックは持たせない。テンプレは `{{file_name}}` 等の固定プレースホルダのみ安全展開（任意式評価をしない）。
4. **会社スコープ厳守。** ファイル・連絡先・マイスキル・ログはすべて `company_id` で隔離。
5. **LLMはGemini継続・JSON抽出方式。** function callingは使わず、既存の「JSONを1個返させて正規表現抽出」方式を踏襲。
6. **起動は手動（オンデマンド）のみ。** イベント駆動の自動起動は対象外。

---

## 5. データモデル

### 5.1 `wn_skill_runs`（実行ログ・新規）

| カラム | 型 | 説明 |
|--------|----|----|
| id | bigint PK | |
| company_id | bigint, index | 会社スコープ |
| user_id | bigint, index | 実行者 |
| file_id | bigint, nullable, index | 対象ファイル |
| skill | string(50), nullable | `send_email` / `create_share` / `submit_approval` / `ai_tags` / `user:{id}` / null(未解決) |
| instruction | text | 元の自然言語 |
| args_json | json, nullable | ルーターが抽出した引数 |
| draft_json | json, nullable | 返した下書き（監査用） |
| status | string(20), default 'drafted' | `drafted` / `executed` / `canceled` / `failed` / `unmatched` |
| confidence | float, nullable | ルーターの確信度 0〜1 |
| error | text, nullable | 失敗理由 |
| timestamps | | |

index: `(company_id, created_at)`。

### 5.2 `wn_user_skills`（マイスキル・新規）

| カラム | 型 | 説明 |
|--------|----|----|
| id | bigint PK | |
| company_id | bigint, index | |
| created_by | bigint, nullable | 作成者 |
| name | string | 表示名（例「A社へ見積依頼」） |
| trigger_phrases | json | 発動の手がかり例文（ルーティングプロンプトへ） |
| base_tool | string(50) | 使う組み込みツール（`send_email` 等。allowlist検証） |
| config | json, nullable | ツール別の固定パラメータ・テンプレ（宛先・件名・本文・共有日数など） |
| conditions | json, nullable | 対象条件（任意・将来拡張: タグ/拡張子など） |
| is_active | boolean, default true | |
| timestamps | | |

index: `(company_id, is_active)`。

### 5.3 既存参照

- `wn_contacts`（既存）: `company_id / name / email / created_by`、unique`(company_id,email)`。宛先解決に使用。
- `wn_files`（既存）: `company_id / file_name / mime_type / is_deleted / approval_status(none|pending|approved|rejected)` 等。

---

## 6. バックエンド仕様（API）

ベースは既存の `wn` ルートグループ（`routes/api.php`、認証ミドルウェア配下）。

### 6.1 スキル

| メソッド | パス | コントローラ | 説明 |
|---------|------|------------|------|
| POST | `/wn/skills/run` | `WnSkillController@run` | 指示→スキル判定→下書き返却＋ログ記録 |
| POST | `/wn/skills/runs/{id}/confirm` | `WnSkillController@confirm` | 実行結果を記録（executed/canceled） |
| GET | `/wn/skills/runs` | `WnSkillController@history` | 実行履歴（自社・最新100件） |

### 6.2 マイスキル

| メソッド | パス | コントローラ | 説明 |
|---------|------|------------|------|
| GET | `/wn/skills/my` | `WnUserSkillController@index` | 自社のマイスキル一覧 |
| POST | `/wn/skills/my` | `WnUserSkillController@store` | 作成 |
| PATCH | `/wn/skills/my/{id}` | `WnUserSkillController@update` | 更新 |
| DELETE | `/wn/skills/my/{id}` | `WnUserSkillController@destroy` | 削除 |
| POST | `/wn/skills/my/chat` | `WnUserSkillController@chat` | 会話型ビルダー（実現可否判定＋proposal） |

### 6.3 `POST /wn/skills/run`

**リクエスト**
```json
{
  "instruction": "このファイルを山田さんに見積依頼で送って",
  "file_id": 123,
  "contacts": [{ "name": "山田", "email": "yamada@example.com" }]
}
```
- validate: `instruction` required string max:500 / `file_id` required integer / `contacts` nullable array max:200（`contacts.*.name` max:100、`contacts.*.email` max:200）
- ファイルは `company_id` 一致かつ `is_deleted=false` のもののみ（`firstOrFail`）。

**処理**
1. `SkillRegistry` を構築（組み込み＋自社マイスキル）。
2. `GeminiService::routeSkill(instruction, registry->catalogForPrompt(), contacts)` でスキル判定。
3. 該当ハンドラが無ければ `status='unmatched'` でログ記録し、`action_type=null` を返す。
4. ハンドラの `draft()` を実行（例外時は `status='failed'` で記録し500）。
5. `status='drafted'` でログ記録。

**レスポンス**
```json
{
  "skill": "send_email",
  "action_type": "email",
  "file": { "id": 123, "file_name": "図面A.pdf" },
  "draft": { "...": "action_type ごとに異なる（後述）" },
  "missing": ["to_email"],
  "message": "メールの下書きを作成しました。内容を確認して送信してください。",
  "blocked": false,
  "run_id": 456
}
```
- `action_type`: `email` / `share` / `approval` / `ai_tags` / `null`。フロントはこれで分岐する。
- `blocked`: 実行不可状態（例: 既に承認申請中）。フロントは実行せず案内する。

### 6.4 `POST /wn/skills/runs/{id}/confirm`
- validate: `status` required in:`executed,canceled`。
- 自社かつ自分の run のみ更新可（`company_id` と `user_id` 一致）。

### 6.5 `GET /wn/skills/runs`
- 自社の最新100件。`id` 降順。返却: `id / user_id / file_id / skill / instruction / status / confidence / created_at`。

---

## 7. スキルハンドラ仕様

スキルを増やしやすくするための内部インターフェイス。`app/Skills/WhatsNo/` に配置。

```php
interface SkillHandler {
    public function key(): string;          // "send_email"
    public function label(): string;        // "メール送信"
    public function description(): string;  // ルーティングプロンプト用の説明
    public function argSpec(): array;       // 引数キー => 説明（プロンプトに渡す）
    public function triggerHints(): array;  // 発動の手がかり例文
    public function draft(WnFile $file, array $args, $user): array; // 副作用なし
}
```

**`draft()` の戻り値（共通フォーマット）**
```php
[
  'action_type' => 'email'|'share'|'approval'|'ai_tags',
  'draft'       => [...],   // フロントが使う下書きデータ（action_type 別）
  'missing'     => [...],   // 不足している必須引数のキー
  'message'     => '...',   // 確認用メッセージ
  'blocked'     => false,   // 任意。実行不可なら true
]
```

**`SkillRegistry`**
- 組み込みハンドラ配列を保持。
- コンストラクタで `$user` を受け、`wn_user_skills`（is_active）を読んで `UserDefinedSkillHandler` を動的に追加。
- `get(key)` / `all()` / `catalogForPrompt()` を提供。
- マイスキルのキーは `user:{id}` 形式で組み込みと衝突回避。
- `catalogForPrompt()` は `[{ key, label, description, args, examples }]` を返す。

---

## 8. 組み込みスキル一覧

| key | label | draft で返す内容 | 実行（フロント委譲先） | blocked条件 |
|-----|-------|----------------|---------------------|------------|
| `send_email` | メール送信 | `intent/to_name/to_email/subject/body_message/missing` | 既存メールモーダル（mailto/Gmail） | — |
| `create_share` | 共有リンク発行 | `expires_days` | `wnCreateShare(fileId,{expiresDays})` | — |
| `submit_approval` | 承認申請 | `current_status` | `wnSubmitApproval(fileId)` | `approval_status` が none/rejected 以外 |
| `ai_tags` | AIタグ付け | `suggested_tags[]`（`suggestTags()` で生成） | `wnApplyAiTags(fileId, tags)` | — |

### 8.1 send_email の draft 構造（重要・フロント互換）
```json
{
  "intent": "send_email",
  "to_name": "山田",
  "to_email": "yamada@example.com",
  "subject": "お見積もりのご依頼",
  "body_message": "お世話になっております。…（2〜4文）",
  "missing": []
}
```
- `to_email` が空なら `missing` に `"to_email"` を入れる（フロントが手入力を促す）。
- **コスト最適化**: ルーター(`routeSkill`)が send_email と判定した時点で `to_name/to_email/subject/body_message` まで args に含めて返させ、Gemini呼び出しを1回に統合する。`SendEmailSkill::draft` は args を整形するだけ（再度LLMを呼ばない）。

### 8.2 各スキルの argSpec / triggerHints（プロンプト用）

- **send_email** — args: `to_name`(宛先人物名/敬称除く) / `to_email`(連絡先一致で埋め、無ければ空) / `subject`(件名) / `body_message`(丁寧な日本語本文。署名・URL・ファイル名羅列は含めない)。例:「山田さんに見積依頼で送って」。
- **create_share** — args: `expires_days`(有効期限日数。既定30)。例:「共有リンクを作って」「7日間有効なリンクを作成して」。
- **submit_approval** — args: なし。例:「承認申請して」「部長に承認をお願いして」。
- **ai_tags** — args: なし。例:「AIタグを付けて」「タグを自動で付けて」。

---

## 9. フロントエンド仕様

### 9.1 API規約（厳守）

- API呼び出しは必ず `assets/js/wn-api.js` の `wnFetch(path, options)` を使う。ベースURL=`WN_API_BASE`、認証トークンは localStorage キー `space_token`。独自fetchを書かない（index.htmlが返る不具合の元）。
- JS変更時は参照HTMLの `?v=` キャッシュバスターを更新（PWA SWキャッシュ対策）。

### 9.2 追加するAPIラッパー（wn-api.js）

```js
wnRunSkill(instruction, fileId, contacts)   // POST /wn/skills/run
wnConfirmSkillRun(runId, status)            // POST /wn/skills/runs/{id}/confirm
wnGetSkillRuns()                            // GET  /wn/skills/runs
wnGetMySkills() / wnSaveMySkill() / wnUpdateMySkill() / wnDeleteMySkill()
wnChatBuildSkill(message, history)          // POST /wn/skills/my/chat
```
既存で再利用: `wnGetContacts/wnSaveContact`、`wnCreateShare`、`wnSubmitApproval`、`wnApplyAiTags`。

### 9.3 スキルバー UI（dashboard.html）

- ダッシュボード上部にカード（`#skillBar`）。入力欄 `#skillInput` ＋実行ボタン `#skillSendBtn`。
- 説明文は複数スキル例:「見積依頼で送って／共有リンクを作って／AIタグを付けて／承認申請して」。
- 右側に「連絡先」ボタン（`#contactsOpenBtn`）と「マイスキル」ボタン（`#mySkillsOpenBtn`）。

### 9.4 `runSkill(instruction)` の分岐ロジック

```
対象ファイル = selectedIds[0]（未選択ならトーストで促す）
res = wnRunSkill(instruction, fileId, await wnGetContacts())

res.action_type が null        → 「対応するスキルが見つかりません」（入力は残す）
res.blocked                    → 案内トースト＋confirm(runId,'canceled')
action==='email'               → runSkillEmail()（既存メールモーダル導線）
action==='share'               → confirm → wnCreateShare → クリップボードコピー → confirm(executed)
action==='approval'            → confirm → wnSubmitApproval → loadFiles → confirm(executed)
action==='ai_tags'             → 候補タグをconfirm表示 → wnApplyAiTags → loadFiles → confirm(executed)
```
- 共通の小さな実行前確認UI（`confirm` か軽量モーダル）で統一。
- 実行成功時は `wnConfirmSkillRun(runId,'executed')`、キャンセル時は `'canceled'` を記録。失敗時は記録せず drafted のまま残す。

### 9.5 メールスキル（既存導線の踏襲）

- `openEmailModal(fileId, fileName)` で共有リンクを先行発行。
- draft の `to_email` を `emailChips` に、`body_message` を `#emailMessage` に流し込む。
- 送信は `doSendEmailMailto()` / `doSendEmailGmail()`。送信方法は localStorage `wn_mailer_pref` に記憶し、2回目以降は自動起動。
- `to_email` 未解決時は手入力を促し、入力されたら `wnSaveContact` で連絡先に保存（次回から自動解決）。

---

## 10. ユーザー定義スキル（マイスキル）

### 10.1 方針: フォームを土台に、会話型ビルダーを上に乗せる

- **フォーム** が確定済みデータ構造（`wn_user_skills`）を直接編集する確認画面。
- **会話型ビルダー** はそのフォームをAIが自動入力する補助。AIの提案は必ずフォーム確認を経て保存（誤生成をフォームが吸収）。

### 10.2 CRUD（WnUserSkillController）

- `index/store/update/destroy` は `WnContactController` と同じ自社スコープ流儀。
- store/update validate: `name` required / `trigger_phrases` array / `base_tool` in:組み込みキー(allowlist) / `config` nullable array / `is_active` boolean。
- `base_tool` は必ず allowlist 検証（不正キーを保存させない）。

### 10.3 ディスパッチャ統合

- `SkillRegistry` が `wn_user_skills`(is_active) を読み、`UserDefinedSkillHandler` を追加。
- `UserDefinedSkillHandler::draft` は `base_tool` の組み込みハンドラに委譲しつつ、`config` の固定値・テンプレを args にマージ（**固定値をルーター抽出値より優先**。例: 宛先固定スキル）。
- `catalogForPrompt()` がマイスキルも候補に含めるので、ルーターが自然に選べる。

### 10.4 フロントUI

- 「マイスキル管理モーダル」を連絡先モーダルと同パターンで実装（一覧＋作成フォーム）。
- フォーム項目: 名前 / トリガー例文（複数）/ ベースツール選択 / ツール別パラメータ（宛先・件名・本文テンプレ・共有日数など）/ 有効フラグ。

---

## 11. 会話型スキルビルダー

ユーザーが「〇〇な時に△△して」と相談 → AIが**実現可否を判定** → 可能なら設定を提案 → フォームに自動入力 → ユーザー確認 → 保存。

### 11.1 `GeminiService::buildSkillFromChat(message, toolCatalog, history): array`

- `routeSkill` と同じ `generate()` ＋ `preg_match('/\{.*\}/s')` 抽出方式。
- プロンプトに**使えるツールのカタログ**（`SkillRegistry::catalogForPrompt()` を再利用）を渡す。
- 戻り値:
```json
{
  "feasible": true,
  "reason": "（不可の場合の理由）",
  "proposal": { "name": "A社へ見積依頼", "base_tool": "send_email", "config": {...}, "trigger_phrases": ["A社に送って"] },
  "followup": "（追加で聞きたいこと）"
}
```
- `feasible:false` → 「今のツールでは実現できない」理由を返す。
- `feasible:true` → サーバ側で `base_tool` を allowlist 検証してから返す（不正なら feasible:false に降格）。

### 11.2 `WnUserSkillController::chat`
- `POST /wn/skills/my/chat`。会話履歴はフロント保持し毎回渡す（Knowlの重いセッション基盤は使わず軽量に開始）。

### 11.3 フロント
- マイスキル管理モーダルに「AIに相談して作る」タブ。チャットでやり取りし、`proposal` が返ったら作成フォームに自動入力 → 最終確認 → `wnSaveMySkill` で保存。実現不可ならチャットに理由表示。

---

## 12. 実行ログ（活用）

- すべての `run` で記録（drafted / unmatched / failed）。`confirm` で executed / canceled に更新。
- 履歴UI（任意・後半）: スキルバーから履歴モーダルで「いつ・誰・どのスキル・status」を表示。`wnGetSkillRuns()` を使用。監査・スキル改善に活用。

---

## 13. 既存資産・規約（再利用前提）

| 領域 | 再利用するもの |
|------|--------------|
| LLM | `GeminiService::generate()`（fastModel=`gemini-2.5-flash-lite`）、JSON抽出 `preg_match('/\{.*\}/s')`、`suggestTags()` |
| メール | `openEmailModal`/`_buildEmailContent`/`doSendEmailMailto`/`doSendEmailGmail`、`wn_mailer_pref` |
| 共有 | `wnCreateShare`（ログイン不要リンク、有効期限指定） |
| 承認 | `wnSubmitApproval`（none/rejected のみ申請可） |
| タグ | `wnApplyAiTags` |
| 連絡先 | `wn_contacts` / `WnContactController` / `wnGetContacts`・`wnSaveContact` |
| DB規約 | 全テーブル `company_id` 自社スコープ、`firstOrFail` で他社遮断 |
| フロント規約 | `wnFetch`/`space_token`、`?v=` キャッシュバスター更新 |

---

## 14. 段階的構築順序

**フェーズ1 — 複数スキルのディスパッチャ＋実行ログ**
1. `wn_skill_runs` マイグレーション＋`WnSkillRun` モデル。
2. `SkillHandler` IF＋`SkillRegistry`＋組み込み4ハンドラ（send_email/create_share/submit_approval/ai_tags）。
3. `GeminiService::routeSkill()`。
4. `WnSkillController`（run/confirm/history）＋ルート。
5. フロント（`wn-api.js` ラッパー、`runSkill` の action_type 分岐、dashboard.html 文言・`?v=` 更新）。

**フェーズ2 — マイスキル**
6. `wn_user_skills` マイグレーション＋モデル＋CRUDコントローラ＋ルート。
7. `UserDefinedSkillHandler`＋Registry統合。
8. マイスキル管理フロントUI（フォーム＝土台）。
9. 会話型スキルビルダー（`buildSkillFromChat`＋`chat` API＋相談タブ→フォーム自動入力）。

**フェーズ3（任意）**
10. 実行履歴UI。

---

## 15. 検証（エンドツーエンド）

ローカル起動: API `php artisan serve --port=8000`（`GEMINI_API_KEY` 必須）。`php artisan migrate` でテーブル作成。

1. **ルーティング**: `POST /api/wn/skills/run` に各文を投げ `action_type` を確認 —
   「山田さんに見積依頼で送って」→email、「共有リンクを作って」→share、「AIタグを付けて」→ai_tags、「承認申請して」→approval、対応外→`skill:null`/unmatched。`wn_skill_runs` にレコードが残ること。
2. **確定API**: `confirm` で status が executed/canceled に更新されること。
3. **フロント結合**: ファイル1件選択→各指示→スキル別確認UI→既存APIで実行（メーラー起動／リンク発行／タグ付与／承認申請）。
4. **マイスキル フォーム**: base_tool=send_email・宛先固定で「A社へ見積依頼」を作成→「A社に送って」で宛先が固定値で埋まる。
5. **会話型ビルダー**: 「A社に図面を送るときは見積依頼メールにして」→`feasible:true`でproposalがフォームに自動入力。「ファイルを自動で印刷して」→`feasible:false`＋理由。
6. **UIのみ**（バックエンド無し）: mock-token＋`wnRunSkill`/`wnGetMySkills` をスタブ化し、action_type 分岐・確認UI・マイスキルモーダルを Playwright で確認。
7. デプロイは API→フロント。`?v=` 反映を確認（sheeteye.html は対象外）。
