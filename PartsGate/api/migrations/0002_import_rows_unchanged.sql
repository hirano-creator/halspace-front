-- 取込の行ごとの記録に「変更なし」も残す（docs/csv-import.md §1・§4）。
-- 理由: 取込の件数を、最後（確定のとき）に import_rows から数え直すため。
--   200 行ずつ送る途中で通信が切れて同じ行を再送しても、(batch_id, line_no) が同じ行は 1 件のままなので件数が二重に増えない。
-- SQLite は CHECK を変更できないので作り直す。この表はまだ本番・開発のどこにもデータがない（STEP 5 で使い始める）。

DROP TABLE import_rows;

CREATE TABLE import_rows (
  id          INTEGER PRIMARY KEY,
  company_id  INTEGER NOT NULL,
  batch_id    INTEGER NOT NULL,
  line_no     INTEGER NOT NULL,
  global_no   TEXT,
  kind        TEXT NOT NULL CHECK (kind IN ('new', 'updated', 'unchanged', 'error', 'review')),
  message     TEXT,
  diff_json   TEXT,
  FOREIGN KEY (company_id, batch_id) REFERENCES import_batches(company_id, id)
);
CREATE UNIQUE INDEX ux_import_rows_line ON import_rows(batch_id, line_no);
CREATE INDEX ix_import_rows_kind ON import_rows(batch_id, kind, line_no);
