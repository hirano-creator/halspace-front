-- 読み取りのトリガーが伝票の「照合済みの数」を変えたとき、伝票の updated_at も更新する。
-- 理由: 差分バックアップは updated_at で「変わった行」を見分ける（api/src/lib/backup.ts）。
--   0001 のトリガーは matched_count だけを変えていたので、読み取りで照合済みの数だけが変わった伝票が差分バックアップに入らなかった。
-- 復元のときは、すべてのマイグレーションのうち最後の定義を使う（scripts/lib/backup-tables.mjs の triggerCreateSql）。

DROP TRIGGER trg_scan_count;
CREATE TRIGGER trg_scan_count AFTER INSERT ON scan_logs WHEN NEW.result = 'ok'
BEGIN
  UPDATE order_items
     SET scan_count       = scan_count + 1,
         status           = CASE WHEN scan_count + 1 >= required_scans THEN 'matched' ELSE status END,
         matched_at       = CASE WHEN scan_count + 1 >= required_scans THEN NEW.scanned_at ELSE matched_at END,
         matched_staff_id = CASE WHEN scan_count + 1 >= required_scans THEN NEW.staff_id ELSE matched_staff_id END,
         updated_at       = NEW.scanned_at
   WHERE company_id = NEW.company_id AND id = NEW.order_item_id;
  UPDATE orders
     SET matched_count = (SELECT COUNT(*) FROM order_items x WHERE x.company_id = orders.company_id AND x.order_id = orders.id AND x.status = 'matched'),
         updated_at = NEW.scanned_at
   WHERE company_id = NEW.company_id
     AND id = (SELECT order_id FROM order_items WHERE company_id = NEW.company_id AND id = NEW.order_item_id);
END;

DROP TRIGGER trg_correction_void;
CREATE TRIGGER trg_correction_void AFTER INSERT ON scan_corrections WHEN NEW.action = 'void'
BEGIN
  UPDATE order_items
     SET scan_count = scan_count - 1, status = 'pending', matched_at = NULL, matched_staff_id = NULL, updated_at = NEW.created_at
   WHERE company_id = NEW.company_id
     AND id = (SELECT order_item_id FROM scan_logs WHERE company_id = NEW.company_id AND id = NEW.scan_log_id AND result = 'ok')
     AND scan_count > 0;
  UPDATE orders
     SET matched_count = (SELECT COUNT(*) FROM order_items x WHERE x.company_id = orders.company_id AND x.order_id = orders.id AND x.status = 'matched'),
         updated_at = NEW.created_at
   WHERE company_id = NEW.company_id
     AND id = (SELECT oi.order_id FROM order_items oi JOIN scan_logs s ON s.order_item_id = oi.id
                WHERE s.company_id = NEW.company_id AND s.id = NEW.scan_log_id);
END;
