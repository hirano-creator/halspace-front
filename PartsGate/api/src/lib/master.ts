import { Hono } from 'hono';
import { CODE_PATTERN, CODE_RULE_TEXT, MASTER_STATUSES } from '@partsgate/shared';
import type { AppEnv } from '../types';
import { scoped, type Scoped } from './db';
import { authorize, idParam } from './guard';
import { HttpError, Validator, conflict, notFound, readJson } from './http';
import { auditStatement, diff, updated } from './audit';
import { decodeCursor, encodeCursor } from './cursor';
import { nowIso } from './crypto';

/**
 * マスター（担当者・置場・納品先）の一覧・登録・編集をまとめて作る。
 * どのマスターも会社ごと（company_id）に分け、物理削除はしない（status = inactive で利用停止）。
 */

export interface FieldDef {
  key: string;
  label: string;
  kind: 'code' | 'text' | 'int';
  required?: boolean;
  max?: number;
}

export interface MasterDef {
  table: 'staff' | 'locations' | 'destinations';
  path: string;          // '/staff' など
  label: string;         // 監査ログ・メッセージ用（「担当者」など）
  fields: FieldDef[];
  /** 会社の中で重複してはいけない項目の組（UNIQUE 制約と同じ） */
  unique: string[];
  /** 一覧の並び順（キーセットのページ送りにも使う。最後に id を足す） */
  orderBy: string;
  /** 検索（q）の対象列 */
  searchColumns: string[];
  /** 更新前の追加チェック（例: 使用中の置場のコード変更を禁止） */
  beforeUpdate?: (db: Scoped, id: number, before: Record<string, unknown>, after: Record<string, unknown>, v: Validator) => Promise<void>;
}

const PAGE_MAX = 200;

/** LIKE の % _ \ を文字として扱う */
export const likeEscape = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

function readFields(def: MasterDef, v: Validator, partial: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of def.fields) {
    // 部分更新（PUT）では、送られてきた項目だけを確かめる。送られた必須項目が空ならエラー
    const required = f.required && (!partial || v.has(f.key));
    if (f.kind === 'int') {
      const n = v.int(f.key, { required, min: 0, max: 99999, label: f.label });
      if (n !== undefined) out[f.key] = n;
    } else if (f.required) {
      const s = v.str(f.key, { required, max: f.max ?? 100, label: f.label });
      if (s !== undefined) out[f.key] = s;
    } else {
      const s = v.nullableStr(f.key, { max: f.max ?? 200, label: f.label });
      if (s !== undefined) out[f.key] = s;
      else if (!partial) out[f.key] = null;
    }
    if (f.kind === 'code' && typeof out[f.key] === 'string' && !CODE_PATTERN.test(out[f.key] as string)) {
      v.fail(f.key, `${f.label}は${CODE_RULE_TEXT}で入力してください。`);
    }
  }
  return out;
}

function isUniqueError(e: unknown): boolean {
  return e instanceof Error && /UNIQUE constraint failed/i.test(e.message);
}

function duplicateError(def: MasterDef): HttpError {
  const labels = def.unique.map((k) => def.fields.find((f) => f.key === k)?.label ?? k).join('と');
  return new HttpError(422, '入力内容を確認してください。', { errors: { [def.unique[def.unique.length - 1]!]: `同じ${labels}がすでに登録されています。` } });
}

export function masterRoutes(def: MasterDef): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const cols = ['id', ...def.fields.map((f) => f.key), 'status', 'version', 'created_at', 'updated_at'].join(', ');
  const orderCols = def.orderBy.split(',').map((s) => s.trim());

  // 一覧（検索・状態・キーセットのページ送り）
  r.get(def.path, async (c) => {
    authorize(c, 'master.view');
    const db = scoped(c);
    const q = (c.req.query('q') ?? '').trim().slice(0, 50);
    const status = c.req.query('status');
    const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 100) || 100, 1), PAGE_MAX);
    const where: string[] = ['company_id = ?1'];
    const params: unknown[] = [];
    // 値を足して、その値の番号（?2, ?3, ...）を返す。?1 は会社
    const bind = (val: unknown) => { params.push(val); return `?${params.length + 1}`; };
    if (status === 'active' || status === 'inactive') where.push(`status = ${bind(status)}`);
    if (q) {
      const like = `%${likeEscape(q)}%`;
      where.push(`(${def.searchColumns.map((col) => `${col} LIKE ${bind(like)} ESCAPE '\\'`).join(' OR ')})`);
    }
    const cursor = c.req.query('cursor');
    if (cursor) {
      const vals = decodeCursor(cursor, orderCols.length + 1);
      // (a, b, id) > (x, y, z) の行値比較で「続き」から読む
      const marks = vals.map((val, i) => bind(i === vals.length - 1 ? Number(val) : val));
      where.push(`(${[...orderCols, 'id'].join(', ')}) > (${marks.join(', ')})`);
    }
    const rows = await db.all<Record<string, unknown>>(
      `SELECT ${cols} FROM ${def.table} WHERE ${where.join(' AND ')} ORDER BY ${[...orderCols, 'id'].join(', ')} LIMIT ${bind(limit + 1)}`,
      ...params,
    );
    const more = rows.length > limit;
    const items = more ? rows.slice(0, limit) : rows;
    const last = items[items.length - 1];
    return c.json({ items, next_cursor: more && last ? encodeCursor([...orderCols.map((k) => String(last[k] ?? '')), String(last.id)]) : null });
  });

  // 登録
  r.post(def.path, async (c) => {
    authorize(c, 'master.edit');
    const db = scoped(c);
    const v = new Validator(await readJson(c.req.raw));
    const values = readFields(def, v, false);
    v.done();
    const now = nowIso();
    const keys = Object.keys(values);
    try {
      const [ins] = await db.batch([
        db.stmt(
          `INSERT INTO ${def.table} (company_id, ${keys.join(', ')}, status, created_at, updated_at) VALUES (?1, ${keys.map((_, i) => `?${i + 2}`).join(', ')}, 'active', ?${keys.length + 2}, ?${keys.length + 2}) RETURNING id`,
          ...keys.map((k) => values[k]), now,
        ),
      ]);
      const id = (ins?.results?.[0] as { id: number } | undefined)?.id;
      if (!id) throw new Error('insert failed');
      await auditStatement(c, { action: `${def.table}.create`, targetType: def.table, targetId: id, detail: values }).run();
      return c.json(await db.first(`SELECT ${cols} FROM ${def.table} WHERE company_id = ?1 AND id = ?2`, id), 201);
    } catch (e) {
      if (isUniqueError(e)) throw duplicateError(def);
      throw e;
    }
  });

  // 編集（利用停止・再開もここ。status を送る）
  r.put(`${def.path}/:id`, async (c) => {
    authorize(c, 'master.edit');
    const db = scoped(c);
    const id = idParam(c);
    const v = new Validator(await readJson(c.req.raw));
    const values = readFields(def, v, true);
    const status = v.oneOf('status', MASTER_STATUSES, { label: '状態' });
    if (status) values.status = status;
    const version = v.version();
    v.done();
    const before = await db.first<Record<string, unknown>>(`SELECT ${cols} FROM ${def.table} WHERE company_id = ?1 AND id = ?2`, id);
    if (!before) throw notFound();
    if (def.beforeUpdate) { await def.beforeUpdate(db, id, before, values, v); v.done(); }
    const keys = Object.keys(values);
    if (!keys.length) return c.json(before);
    const now = nowIso();
    try {
      const [res] = await db.batch([
        db.stmt(
          `UPDATE ${def.table} SET ${keys.map((k, i) => `${k} = ?${i + 4}`).join(', ')}, updated_at = ?3, version = version + 1
           WHERE company_id = ?1 AND id = ?2 AND version = ?${keys.length + 4}`,
          id, now, ...keys.map((k) => values[k]), version,
        ),
        auditStatement(c, { action: `${def.table}.update`, targetType: def.table, targetId: id, detail: diff(before, values) },
          updated(def.table, db.companyId, id, version + 1, now)),
      ]);
      if (!res?.meta.changes) throw conflict();
    } catch (e) {
      if (isUniqueError(e)) throw duplicateError(def);
      throw e;
    }
    return c.json(await db.first(`SELECT ${cols} FROM ${def.table} WHERE company_id = ?1 AND id = ?2`, id));
  });

  return r;
}
