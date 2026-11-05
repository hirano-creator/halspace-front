# PARTS GATE バーコード照合仕様

- 版: 0.1（STEP 3 設計・ドラフト）／作成日: 2026-11-05
- 未確定: Q-1（リーダーが送る文字）、Q-3（輸出区分 E）、Q-6（出荷日が今日でない明細）

## 1. リーダーからの入力

- USB バーコードリーダーはキーボードとして文字を送り、最後に Enter を送る（HID 方式）
- 読み取り画面の入力欄に常にフォーカスを置く。読み取りのたび、エラー表示のあと、画面の別の場所を押したあとも入力欄に戻す
- **人の手入力と区別する**: 文字の間隔が平均 30ms 未満で届いた入力をリーダーとみなす。手入力も許可するが、履歴に `input = manual` を残す（設定で手入力を禁止できる）
- Enter で確定。空の入力・改行だけの入力は無視する

## 2. 読み取りの前提（担当者）

1. ログイン後、担当者選択画面で作業担当者を選ぶ → `POST /api/work-sessions` で作業セッションを作る
2. 作業セッション ID は**画面のメモリにだけ**持つ（sessionStorage にも保存しない）。画面の再読み込み・再ログインのあとは必ず選び直す
3. 担当者名を読み取り画面の上部に常に大きく表示する
4. 「担当者を変える」を押すと入力欄を無効にし、セッションを終了（`ended_at`）してから選択画面へ。変更中は読み取らない
5. API は読み取りのたびに確認する: 作業セッションがこの利用者のもの・同じ会社・終了していない・担当者が利用中。どれかが違えば 409「担当者を選び直してください」

## 3. 読み取り値の整形

会社の設定（`company_settings`）に従って次の順で整える。設定は Q-1 の確認後に決める。

1. 前後の空白・制御文字を除く
2. 設定した前後の文字（例: `]C1`）を外す
3. 英字を大文字にそろえる
4. 形式チェック: 英数字と `-` だけ、4〜40 文字。外れたら照合せず「エラー（読み取り値が不正）」で記録

## 4. 判定（API で最終判定する）

照合に使う列は `company_settings.match_field`（既定: バーコード用グローバル番号）。

| 順 | 条件 | 結果 |
| --- | --- | --- |
| 1 | 同じ `client_scan_id` の記録がもうある（通信の再送） | **前回の結果をそのまま返す**（新しく記録しない） |
| 2 | 番号の明細がない | 未登録 |
| 3 | 明細が `cancelled`（取消）・データ区分が F 以外・置場が未登録 | 要確認（理由付き） |
| 4 | 出荷日（SSD）が今日でない（設定 ON のとき。Q-6） | 要確認「出荷日が 11/06 の明細です」 |
| 5 | `scan_count < required_scans` | 正常（`scan_count` を 1 増やす。必要回数に達したら照合済み） |
| 6 | すでに照合済みで、1 行 1 枚の会社 | 重複「11/05 10:23 に 山田 さんが読み取り済み」 |
| 7 | すでに照合済みで、数量分ラベルの会社 | 数量超過 |

要確認・重複・数量超過・未登録も、すべて scan_logs に記録する（後で分析するため）。

## 5. 同時読み取りの扱い（複数 PC）

D1 は 1 つの DB への書き込みを順番に処理し、`batch` の中の文は 1 つのトランザクションとして実行される。これを使い、**明細の状態の確認・記録・数え上げを 1 つの INSERT 文（とそのトリガー）で行う**。

```sql
-- ① 記録（1 文）: 結果を「この瞬間の明細の状態」から同じ文の中で決める
INSERT INTO scan_logs (company_id, client_scan_id, order_item_id, result, ...)
SELECT :company, :client_scan_id, oi.id,
       CASE WHEN oi.status IN ('review', 'cancelled') THEN 'review'      -- §4 の 3（出荷日の確認 4 も同様に CASE で）
            WHEN oi.status = 'pending' AND oi.scan_count < oi.required_scans THEN 'ok'
            WHEN :one_label_per_item THEN 'duplicate'
            ELSE 'over_quantity' END, ...
  FROM order_items oi
 WHERE oi.company_id = :company AND oi.id = :item
ON CONFLICT (company_id, client_scan_id) DO NOTHING;

-- ② 数える（トリガー）: scan_logs に「新しく」行が入ったときだけ動く
CREATE TRIGGER trg_scan_count AFTER INSERT ON scan_logs WHEN NEW.result = 'ok'
BEGIN
  UPDATE order_items
     SET scan_count = scan_count + 1,
         status = CASE WHEN scan_count + 1 >= required_scans THEN 'matched' ELSE status END,
         matched_at = CASE WHEN scan_count + 1 >= required_scans THEN NEW.scanned_at ELSE matched_at END,
         matched_staff_id = CASE WHEN scan_count + 1 >= required_scans THEN NEW.staff_id ELSE matched_staff_id END,
         updated_at = NEW.scanned_at
   WHERE company_id = NEW.company_id AND id = NEW.order_item_id;
  UPDATE orders
     SET matched_count = (SELECT COUNT(*) FROM order_items x
                           WHERE x.company_id = orders.company_id AND x.order_id = orders.id AND x.status = 'matched')
   WHERE company_id = NEW.company_id
     AND id = (SELECT order_id FROM order_items WHERE id = NEW.order_item_id);
END;

-- ③ 集計表（トリガー）: 結果にかかわらず、新しく入った読み取りを 1 件数える
CREATE TRIGGER trg_scan_stats AFTER INSERT ON scan_logs
BEGIN
  INSERT INTO daily_scan_stats (company_id, day, staff_id, location_id, result, count)
  VALUES (NEW.company_id, NEW.day, NEW.staff_id, COALESCE(NEW.location_id, 0), NEW.result, 1)
  ON CONFLICT (company_id, day, staff_id, location_id, result) DO UPDATE SET count = count + 1;
END;
```

- 判定・記録・数え上げ・集計が **① の 1 文の中で完結する**（トリガーは同じ文の一部として実行される）。D1 は書き込みを順番に処理するので、2 台が同時に同じラベルを読んでも「正常」は 1 台だけ。もう 1 台は ① の時点で `scan_count` が増えているので重複になる
- 通信の再送で同じ `client_scan_id` が 2 回届いても、2 回目は `DO NOTHING` で行が入らないため、トリガーも動かない（二重に数えない）。同時に 2 つ届いても同じ
- ① のあと、`scan_logs` を `client_scan_id` で読み直して、確定した結果を画面に返す（手順 1 の「前回の結果を返す」もこの読み直しで実現できる）
- 未登録（明細がない）の場合は `order_item_id = NULL`・`result = 'not_found'` で記録する。トリガー ② は動かず、③ だけが動く
- 照合の取消（`scan_corrections`）も同じ考え方で、訂正行の INSERT に付けたトリガーで `scan_count` を戻す

保証すること（テストで確かめる。[development-plan.md](development-plan.md) §3）:

- 同じラベルを 2 台の PC でほぼ同時に読んでも、正常は 1 件だけ、もう 1 件は重複
- `scan_count` は `required_scans` を超えない（DB の CHECK 制約でも防ぐ）
- 通信が切れて同じ読み取りを再送しても、記録は 1 件

## 6. 画面の動き

| 状態 | 画面 |
| --- | --- |
| 送信中 | 入力欄の横に「確認中…」。**次の読み取りは受け付けて順番待ちにする**（最大 20 件。読み取りを止めない） |
| 正常 | 画面上部の帯が緑、✔「正常」、短い高い音 1 回。商品コード・数量・得意先・納品先・置場を大きく表示 |
| 重複・要確認 | 黄、⚠、低い音 2 回。理由を 1 行で表示（例: 「読み取り済み（10:23 山田）」） |
| 未登録・数量超過・エラー | 赤、✖、長い低い音。**次の読み取りまで表示を残す** |
| 通信エラー | 赤「通信できません。この読み取りは保存されていない可能性があります。もう一度読み取ってください」。送れなかった読み取りは同じ `client_scan_id` で 3 回まで自動で再送する（2 秒・5 秒・10 秒後） |
| ログイン切れ | 読み取りを止めて「ログインし直してください」。順番待ちの読み取りは、ログイン後に同じ ID で送り直す |

- 色だけに頼らず、必ず文字とアイコンも出す
- 同じ値を 1 秒以内に 2 回読んだ場合（リーダーの二度読み）も API に送り、重複として記録する（画面で捨てない。現場の操作を後から追えるようにする）
- 画面の下に、今日の自分の読み取り件数・正常件数・エラー件数と、直近 10 件の結果を表示する
- 置場の取り違え防止（任意設定）: 作業中の置場を選んでおくと、別の置場の明細を読んだときに「要確認（置場が違います）」にする

## 7. 照合済みにしないもの

- 要確認・重複・未登録の読み取りでは、明細を照合済みにしない
- 要確認の明細は、管理者が明細詳細で理由を確認し、必要なら「照合済みにする（理由入力）」を押す。これは監査ログに残す
