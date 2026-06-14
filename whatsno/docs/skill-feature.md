# What'sNo スキル機能 — 開発記録と学び（2026-06-13）

自然言語の指示からメールの下書きを生成し、ユーザーのメールアプリで送信する「スキル機能」（PoC）を
実装し、本番（Cloudflare Pages / Railway）までデプロイした記録。実際に
`h.hirano@hirano50.com` 宛のメール送信まで動作確認済み。

---

## 1. 何を作ったか

ホーム画面（`dashboard.html`）に「スキルバー」を追加。ファイルを1件選択して
「このファイルを○○さんに見積依頼で送って。メールアドレス xxx@example.com」のように自然言語で指示すると、
AIが宛先・件名・本文の下書きを作り、既存のメール送信モーダルを開いてmailtoで送信できる。

**重要な設計**: 全自動送信ではなく「AIが下書き → ユーザーのメールアプリが起動 → 最後は本人が送信」。
誤送信防止のため、あえて人の確認を挟む（既存のmailto方式を踏襲）。

### 動作フロー
1. ファイルを1件選択（`selectedIds[0]` に入る）
2. スキルバーに指示を入力 → ✈ボタン / Enter
3. `wnRunSkill()` → `POST /wn/skills/run` → Geminiが下書きJSONを生成
4. `openEmailModal()` でメールモーダルを開き、宛先(`to_email`)を `emailChips`、本文を `#emailMessage` に流し込む
5. ユーザーが内容確認 → 「メールアプリで送信」→ mailtoでメーラー起動 → 送信

---

## 2. 実装ファイル

**バックエンド（solid-api / halspace-api）**
- `app/Http/Controllers/WhatsNo/WnSkillController.php`（新規）— `run()`、`POST /wn/skills/run`
- `app/Services/GeminiService.php` — `draftEmailFromInstruction()` を追加（`suggestTags` と同じJSON抽出方式）
- `routes/api.php` — ルート登録

**フロント（whatsno / halspace-frontend）**
- `app/dashboard.html` — スキルバーのHTML（`#skillInput` / `#skillSendBtn`）
- `assets/js/pages/wn-dashboard.js` — `runSkill()` / `initSkillBar()` / 連絡先(`wn_contacts`)
- `assets/js/wn-api.js` — `wnRunSkill()`

---

## 3. つまずいたバグと修正

| 症状 | 原因 | 修正 |
|------|------|------|
| 「選択ファイルが見つかりません」 | `selectedIds` は既存 `toggleMergeSelect` が**文字列**でID保持。`runSkill` は `f.id === fileId`（数値===文字列）で**型不一致** | `String(f.id) === String(fileId)` に変更 |
| 指示文のメールアドレスを拾わない | プロンプトが「連絡先リスト一致」しか見ていなかった | プロンプトに「指示文中のメールアドレスを最優先で `to_email` に使う」を追加 |
| 本番で修正が反映されない | `dashboard.html` のJS参照が `?v=20260610` のキャッシュバスター固定。JSを変えても**ブラウザが古いキャッシュを読む** | `?v=20260613` に更新して再デプロイ |

---

## 4. デプロイ構成（重要）

| 対象 | リポジトリ | デプロイ先 | トリガー |
|------|-----------|-----------|---------|
| フロント | `github.com/hirano-creator/halspace-frontend`（モノレポ、ルート=`my-programming`） | Cloudflare Pages | `git push` で自動 |
| API | `github.com/hirano-creator/halspace-api`（=`c:\laragon\www\solid-api`） | Railway | `git push` で自動 |

- デプロイ順は **API → フロント**（フロントが叩く `/wn/skills/run` を先に用意するため）。
- モノレポには無関係な変更も混ざるので、**対象ファイルだけを選択的に `add`** してコミットする。
- **JS/CSSを変えたら、参照HTMLの `?v=` を必ず上げる**（上げないと本番がキャッシュのままで反映されない）。

---

## 5. 環境の落とし穴（今回最も時間を食った点）

**OneDrive上の日本語パス＋セッション中に追加/移動したフォルダは、ファイルツールで読めない。**

- `Read` / `Edit` / `Grep` / `Glob` が「File does not exist」を返すのに `Glob` ではファイル名だけ見える、という矛盾が出る。
- OneDriveの「ファイルオンデマンド」でプレースホルダ（☁）だと読めない。**緑チェック（●＝実体化）**にしても、
  セッション中に追加したフォルダは依然読めないことがある（`/add-dir` も効かなかった）。
- `Bash` は別レイヤーで、`cd` でファイルは見えるが **出力が破損し、書いたファイルを `Read`/`Edit` が見られない**（別空間）。
- 日本語パスの直接読み書きは **.NET 経由のPowerShell**（`[System.IO.File]::ReadAllText/WriteAllText`）が比較的安定。
  画像は `[System.IO.File]::Copy` でASCIIパスに退避してから読むと通った。

**回避策（最初からこれを選ぶ）**
1. 小修正（CSS等）は **完成コードを貼ってもらう**のが最速・確実。
2. ツールで編集したいなら **対象を非OneDrive・ASCIIパス**（例 `c:\laragon\www` 配下）に置く、または **セッション再起動**。
3. 別プロジェクト `space-demo`（OneDrive上の `…\spaceデモ\` 配下）の bottom-nav 修正でも同じ問題が起き、
   最終的に手貼りで解決した。

---

## 6. 今後の発展（PoC → 本格化）

- **レベル2**: ユーザーがノーコードで「マイスキル」（宛先・文面テンプレ・使うツール）を保存。
- **レベル3**: 自然言語でスキルを定義 → `gemini-2.5-flash-lite` の **function calling** で
  複数ツール（メール / 承認申請 / タグ付け / 通知）から自動選択。
- 連絡先のサーバーDB化（現状は localStorage `wn_contacts`）。
- 入口の増設（ファイル詳細画面・左メニュー）。

詳細計画: `C:\Users\wsk66\.claude\plans\what-sno-claudecode-dynamic-dongarra.md`
