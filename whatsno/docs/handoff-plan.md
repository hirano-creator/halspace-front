# What'sNo「手渡し」機能 企画書（個人間の資料受け渡し）

## Context（なぜ作るか）
- 今の What'sNo で人に資料を渡す方法は「社内共有（＝全員に公開）」か「外部共有リンク（メール・LINE・QR）」の2択しかない。
- 「特定の1人に渡したいが、全社には出したくない／出すまでもない」資料（作業途中の図面、見積の下書き、現場写真、個人宛ての指示書など）の置き場がなく、結局 LINE やメール添付に流れている。
- 個人保管モード（2026-08 本番）で「自分だけ」のファイルは持てるようになったが、それを特定の人に渡す手段がない。
- 共有リンクは「相手が見たか」がわからない（ダウンロード数を数えていない）。アプリ内通知に「ファイルが届いた」種類もない。

**狙い:** ログインしている相手（社内・HaLSpace の他社）に、宛名と一言を付けて期限付きでファイルを渡せるようにする。受け手は「受け取り箱」で開き、要るものだけ「保存」して自分のファイルにする。

決定済み（ユーザー回答）:
- 相手の範囲: **社内＋HaLSpace にアカウントがある他社**（社外のログインなし相手は既存の共有リンクで対応）
- 受け手の扱い: **期限付きで届き、「保存」を押すとコピーされて受け手の個人ファイルになる**

## 調査で分かった土台（再利用するもの）
| 既存資産 | 場所 | 使い道 |
|---|---|---|
| 保存モード・`visibility`/`owner_user_id`、`WnFile::scopeVisibleTo/EditableBy` | solid-api `app/Models/WhatsNo/WnFile.php` | 渡せるファイル＝自分が編集できるファイル（共有リンク発行と同じ条件） |
| 共有リンクの判定 `authorizeShareToken` / grant | `WnFileController.php:759-796` | 手渡し専用の判定 `authorizeHandoff` を同じ形で作る |
| アプリ内通知 `WnNotificationService` / `wn_notifications` | `app/Services/WnNotificationService.php` | 種類 `handoff` / `handoff_returned` を追加。file_id 必須でも手渡しは必ずファイルがあるので変更不要 |
| 通知ベル `initNotifications` / `notifItemHtml` | `assets/js/pages/wn-dashboard.js:4093,4156` | 種類追加＋クリックで該当画面へ移動（今は既読にするだけ） |
| メール送信（lolipop_relay） | `config/mail.php`, `WnFileShared` Mailable | 受け手がアプリを開かない場合の「届きました」メール（本文にファイルは付けない） |
| 宛先チェック `wnFindUnknownEmails` | `assets/js/wn-api.js:1828` | 連絡先と HaLSpace ユーザーの照合に流用 |
| QR 受け取り画面 `qr.html` / `wnIssueQr` | `app/qr.html`, `wn-api.js:821` | Phase 2 の「対面で渡す」に流用 |
| 注釈 `annotate.html`（ファイル詳細内 embed） | `app/annotate.html` | Phase 2 の「見て返して」に流用 |
| Web Push 送信 `AaPushService::sendToUser` | `app/Services/AaPushService.php` | Phase 3（What'sNo 側の購読処理が未実装なので後回し） |

## 機能の形（Phase 1 = MVP）

### 送る側
- ファイル詳細のメニュー「社内で使う」に **「人に渡す」** を追加。ダッシュボードの複数選択にも追加。
- 宛先の指定
  - 社内: 同じ会社のユーザー一覧から選ぶ（名前で絞り込み）
  - 他社: **メールアドレスを完全一致で入力** → 名前と会社名を確認表示してから送る。名簿は見せない。What'sNo を使えない相手（`User::effectiveApps()` に whatsno なし）は「この方は What'sNo を使っていません。共有リンクで送りますか？」と既存のメール送信へ案内
  - 連絡先から選んだメールが HaLSpace ユーザーと一致すれば、そのまま手渡しに使える
- 一言メッセージ（任意・500字まで）、期限（既定7日、1/3/7/30日から）
- 「渡したもの」一覧: 相手ごとに **未開封／開いた（日時）／保存した** を表示。取り消しできる

### 受ける側
- サイドバーに **「受け取り箱」**（未開封数のバッジ）。スマホ下部ナビは「いいね」の位置を受け取り箱に入れ替える案（要確認）
- カード: 送り主の名前（他社なら会社名も）、一言、残り日数、サムネ
- 操作: **開く**（プレビュー。ここで開封記録）／**保存**（自分の個人ファイルにコピー）／**いらない**（受け取り箱から消す）
- 通知ベルに「○○さんからファイルが届きました」。クリックで受け取り箱へ
- 届いたことをメールでも知らせる（本人が設定でオフにできる）。リンクはアプリの受け取り箱を開くだけでファイルは付けない

### 保管と容量
- 渡した時点では **コピーしない**（送り主のファイルを手渡し経由で見せるだけ）。保存しなければ期限で見えなくなるだけで、R2 の掃除も容量計算も要らない
- 「保存」で初めて R2 上でコピー → 受け手の会社の `whatsno/{company_id}/` に置き、`owner_user_id`＝受け手、`visibility=private`。容量は受け手の会社に計上（上限超過なら保存できない旨を表示）
- 送り主が元ファイルを削除・個人に戻した等で見えなくなった場合は、受け取り箱に「送り主が取り消しました」と表示
- 渡すのは **その時点のバージョン（file_id 固定）**。後で送り主が新版を上げても届いた物は変わらない

## バックエンド設計（solid-api）
- 新テーブル `wn_handoffs`
  - `id`, `batch_id`（同時に送った複数件をまとめる）, `file_id`, `from_user_id`, `from_company_id`, `to_user_id`, `to_company_id`, `message`, `expires_at`, `opened_at`, `saved_file_id`, `saved_at`, `dismissed_at`, `revoked_at`, `reply_to_id`（Phase 2 用）, timestamps
  - index: `(to_user_id, expires_at)`, `(from_user_id, created_at)`
- `wn_files` に `source_handoff_id`（nullable）を追加 → 保存した物の「誰からもらったか」が残る
- 新 `app/Http/Controllers/WhatsNo/WnHandoffController.php`（**routes/api.php に `use` を必ず追加**）
  - `POST /wn/handoffs` 送る（ファイルは `editableBy` で確認、宛先は1回最大10人、`throttle`）
  - `GET /wn/handoffs/inbox` / `GET /wn/handoffs/sent`
  - `GET /wn/handoffs/{id}/view` / `download`（`authorizeHandoff`: 宛先本人・期限内・未取消・元ファイル生存。R2 署名URLは既存 download と同じ）
  - `POST /wn/handoffs/{id}/save` / `dismiss` / `DELETE /wn/handoffs/{id}`（送り主の取り消し）
  - `POST /wn/handoffs/resolve-recipient`（メール完全一致→名前・会社名のみ返す。`throttle:auth` 相当で総当たり防止）
  - `GET /wn/company-users`（社内の id/name だけ。既存に一般向けがないため新設）
- **会社をまたぐ参照は `WnFile` のスコープに混ぜない。** 手渡しの閲覧は専用エンドポイントだけで許可する。こうすると一覧・検索・Knowl（RAG）に他人や他社のファイルが紛れ込む経路ができない（保存モードの「漏洩はKnowl経由」の教訓）
- 期限切れの行は残す（取引記録）。古いものの削除は Phase 3 で cron パターン（Railway の CRON_COMMAND 常駐ループ方式）に乗せるか検討
- LLM は一切呼ばない（Gemini 無料枠を消費しない）

## フロント設計（whatsno）
- `assets/js/wn-api.js`: `wnHandoffSend / wnHandoffInbox / wnHandoffSent / wnHandoffSave / wnHandoffDismiss / wnHandoffRevoke / wnResolveRecipient / wnGetCompanyUsers`（すべて `wnFetch`）
- `assets/js/pages/wn-dashboard.js`: `navView='inbox' | 'sent'` を追加（`initNav` 3408 付近）、受け取り箱の描画、複数選択の「人に渡す」、通知の種類追加とクリック遷移
- `assets/js/pages/wn-file-detail.js` / `app/file-detail.html`: メニュー項目「人に渡す」と送信モーダル。受け取り箱から開いたときは `?handoff={id}` でプレビューのみ（編集・共有系メニューは隠す）
- `assets/css/wn-app.css`: 受け取り箱カード（入力欄は16px以上を守る）
- `?v=` の更新、`sw.js` の `CACHE_NAME` 更新

## 相乗効果のアイデア（優先順）

### Phase 2（手渡しの上に乗る、効果が大きいもの）
1. **「見て返して」— 赤ペン返却**
   送るときに「確認して返してほしい」を付けられる。受け手は注釈画面で書き込み「返す」を押すと、注釈済みPDFが送り主の受け取り箱に戻る。送り主は「元ファイルの新しいバージョンとして取り込む」を選べる。
   → 今は承認の相手が「管理者」固定（`renderApproval` L351）なので、**相手を指定したチェック依頼**として承認の弱点を補える。紙の図面に赤ペンを入れて返す現場の流れをそのまま置き換えられる。
2. **対面QR手渡し**
   相手のメールも名前もわからない現場（協力会社の人、初対面）で、自分のスマホに QR を出し、相手が What'sNo で読むと受け取り箱に入る。QR は5分で切れて1回だけ使える。`qr.html` の仕組みを流用。
3. **連絡先に「アプリで渡せます」表示**
   メール送信モーダルで、宛先が HaLSpace ユーザーなら「手渡しにすると既読がわかります・容量制限なし（メール添付は20MBまで）」と提案。既存メール機能から手渡しへ自然に移せる。

### Phase 3（運用が回ってから）
4. **社内共有の提案**: 同じファイルを3人以上に手渡ししたら「社内共有にしますか？」と出す（ルールのみ、AI不使用）。手渡しが社内共有の質を上げる入口になる。
5. **異動・退職時のまとめて手渡し**: 管理者が「Aさんの個人ファイルをBさんへ」を手渡しで実行（受け手が中身を見て保存を選べる）。既存の `owner_user_id` 引き継ぎより受け手に優しい。
6. **他社間の受け渡し記録をSOLIDと連携**: 発注者⇄HaLSpace の図面受け渡しを手渡しで行い、物件に紐づけて残す（SOLID チャットに「ファイルが届きました」を流す）。
7. **Web Push**: What'sNo 側に購読処理を作り `AaPushService` を共通化して「届きました」を端末に通知（VAPID 鍵の本番設定が前提）。

## 実装順と検証
1. solid-api: migration → `WnHandoffController` → routes（`use` 追加）→ 通知種類。Feature テストで「宛先以外は 403」「期限切れ 410」「他社ファイルが一覧・検索・Knowl に出ない」「保存で受け手の会社にコピー・容量計上」「取り消し後は見られない」を確認
2. whatsno: API 関数 → 送信モーダル → 受け取り箱 → 渡したもの一覧 → 通知遷移
3. E2E（`../_wn_e2e/`、mock-token、`serviceWorkers:'block'`）: 送る→受け取り箱表示→開く→保存→送り主側で「保存した」表示、スマホ幅で入力欄が16px以上
4. 本番反映: solid-api を Railway に push（起動時 migrate）→ whatsno は worktree で main へ cherry-pick → `curl -sL "...?cb=$RANDOM" | grep -c "受け取り箱"` で確認

## この企画書の扱い
2026-11-01 企画確定。Phase 1 から実装する。
