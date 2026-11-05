// バックアップと復元で使う表の一覧と、復元用の SQL を作る関数。
// Worker（api/src/lib/backup.ts）・復元スクリプト（scripts/restore.mjs）・テスト（api/test/backup.test.ts）で同じものを使う。
// Node の機能は使わない（Worker の中でも動かすため）。

/**
 * @typedef {{ name: string, key: string[], since: string, appendOnly?: boolean, updateWhere?: string }} TableSpec
 * since: 差分バックアップで「前回以降」を見分ける列。'id'（追記だけの表）・'day'・更新日時の列（| で複数）
 * 並びは復元の順（外部キーの親が先）
 */
/** @type {TableSpec[]} */
export const TABLES = [
  { name: 'companies', key: ['id'], since: 'updated_at' },
  { name: 'company_settings', key: ['company_id'], since: 'updated_at' },
  { name: 'users', key: ['id'], since: 'updated_at|last_seen_at' },
  { name: 'staff', key: ['id'], since: 'updated_at' },
  { name: 'locations', key: ['id'], since: 'updated_at' },
  { name: 'destinations', key: ['id'], since: 'updated_at' },
  // 確定した取込回は書き換えられない（トリガー）ので、確定済みには上書きしない。
  // 「中止」は時刻を持たないため差分に入らないことがある（復元後に「登録中」で残っても、次の取込で 30 分を過ぎたものは自動で中止になる）
  { name: 'import_batches', key: ['id'], since: 'created_at|committed_at', updateWhere: "import_batches.status <> 'committed'" },
  { name: 'import_rows', key: ['id'], since: 'id', appendOnly: true },
  { name: 'orders', key: ['id'], since: 'updated_at' },
  { name: 'order_items', key: ['id'], since: 'updated_at' },
  { name: 'work_sessions', key: ['id'], since: 'started_at|ended_at' },
  { name: 'scan_logs', key: ['id'], since: 'id', appendOnly: true },
  { name: 'scan_corrections', key: ['id'], since: 'id', appendOnly: true },
  { name: 'daily_scan_stats', key: ['company_id', 'day', 'staff_id', 'location_id', 'result'], since: 'day' },
  { name: 'audit_logs', key: ['id'], since: 'id', appendOnly: true },
];

/** 復元の間だけ外すトリガー（読み取りの数え上げ。バックアップには数え終わった値が入っているので、二重に数えないため） */
export const COUNT_TRIGGERS = ['trg_scan_count', 'trg_scan_stats', 'trg_correction_void'];

/** SQL の値（文字列は ' を重ねる） */
export function sqlValue(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (typeof v === 'boolean') return v ? '1' : '0';
  return `'${String(v).replace(/'/g, "''")}'`;
}

/** 1 行を「あれば更新・なければ追加」する SQL。追記だけの表は「あれば何もしない」 */
export function upsertSql(spec, row) {
  const cols = Object.keys(row);
  const values = cols.map((c) => sqlValue(row[c])).join(', ');
  const head = `INSERT INTO ${spec.name} (${cols.join(', ')}) VALUES (${values}) ON CONFLICT (${spec.key.join(', ')})`;
  if (spec.appendOnly) return `${head} DO NOTHING;`;
  const sets = cols.filter((c) => !spec.key.includes(c)).map((c) => `${c} = excluded.${c}`);
  if (!sets.length) return `${head} DO NOTHING;`;
  return `${head} DO UPDATE SET ${sets.join(', ')}${spec.updateWhere ? ` WHERE ${spec.updateWhere}` : ''};`;
}

/**
 * マイグレーションの SQL（すべてのファイルを順につなげたもの）から、数え上げのトリガーを作り直す文を取り出す。
 * あとのマイグレーションで作り直したトリガーがあるので、それぞれ**最後の定義**を使う。
 */
export function triggerCreateSql(migrationSql) {
  const out = [];
  for (const name of COUNT_TRIGGERS) {
    const all = [...migrationSql.matchAll(new RegExp(`CREATE TRIGGER ${name}\\b[\\s\\S]*?\\nEND;`, 'g'))];
    const last = all[all.length - 1];
    if (!last) throw new Error(`マイグレーションに ${name} が見つかりません`);
    out.push(last[0]);
  }
  return out;
}

/**
 * 復元の SQL 文の一覧。backups は古い順（全体 → 差分 → 差分 …）。各要素は { 表の名前: 行の配列 }
 * 手順: 数え上げのトリガーを外す → 表ごとに親から順に upsert → トリガーを作り直す
 */
export function restoreStatements(backups, migrationSql) {
  const stmts = COUNT_TRIGGERS.map((t) => `DROP TRIGGER IF EXISTS ${t};`);
  for (const b of backups) {
    for (const spec of TABLES) for (const row of b[spec.name] ?? []) stmts.push(upsertSql(spec, row));
  }
  stmts.push(...triggerCreateSql(migrationSql));
  return stmts;
}
