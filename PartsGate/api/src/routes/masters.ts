import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { masterRoutes } from '../lib/master';
import { scoped } from '../lib/db';
import { authorize } from '../lib/guard';
import { CODE_PATTERN } from '@partsgate/shared';
import { HttpError, readJson } from '../lib/http';
import { auditStatement } from '../lib/audit';
import { nowIso } from '../lib/crypto';

/** 作業担当者（ログインアカウントとは別。docs/requirements.md §4） */
export const staffRoutes = masterRoutes({
  table: 'staff', path: '/staff', label: '担当者',
  fields: [
    { key: 'code', label: '担当者コード', kind: 'code', required: true, max: 32 },
    { key: 'name', label: '氏名', kind: 'text', required: true, max: 50 },
    { key: 'department', label: '所属部署', kind: 'text', max: 50 },
    { key: 'factory', label: '所属工場', kind: 'text', max: 50 },
    { key: 'sort_order', label: '並び順', kind: 'int' },
  ],
  unique: ['code'],
  orderBy: 'sort_order, code',
  searchColumns: ['code', 'name'],
});

/** 置場マスター。コードは CSV と同じ書き方（ヒラノは 4 桁） */
export const locationRoutes = masterRoutes({
  table: 'locations', path: '/locations', label: '置場',
  fields: [
    { key: 'code', label: '置場コード', kind: 'code', required: true, max: 32 },
    { key: 'name', label: '置場名', kind: 'text', required: true, max: 50 },
    { key: 'description', label: '説明', kind: 'text', max: 200 },
  ],
  unique: ['code'],
  orderBy: 'code',
  searchColumns: ['code', 'name'],
  // 注文で使われている置場のコードは変えられない（CSV の置場との対応が崩れるため）。名前の変更・利用停止はできる
  beforeUpdate: async (db, id, before, after, v) => {
    if (after.code === undefined || after.code === before.code) return;
    const used = await db.first('SELECT 1 FROM order_items WHERE company_id = ?1 AND location_id = ?2 LIMIT 1', id);
    if (used) v.fail('code', 'この置場は注文で使われているため、コードは変えられません。新しい置場を登録し、こちらは利用停止にしてください。');
  },
});

/** 納品先マスター。得意先コード＋直送先コードで見分ける（直送先コードは得意先をまたいで重複するため） */
const destinationBase = masterRoutes({
  table: 'destinations', path: '/destinations', label: '納品先',
  fields: [
    { key: 'customer_code', label: '得意先コード', kind: 'code', required: true, max: 32 },
    { key: 'code', label: '直送先コード', kind: 'code', required: true, max: 32 },
    { key: 'name', label: '納品先名', kind: 'text', required: true, max: 100 },
    { key: 'postal_code', label: '郵便番号', kind: 'text', max: 10 },
    { key: 'address', label: '住所', kind: 'text', max: 200 },
    { key: 'phone', label: '電話番号', kind: 'text', max: 20 },
    { key: 'note', label: '備考', kind: 'text', max: 500 },
  ],
  unique: ['customer_code', 'code'],
  orderBy: 'customer_code, code',
  searchColumns: ['customer_code', 'code', 'name'],
});

/**
 * 納品先のまとめて登録（CSV 取込画面の「まとめて登録」。docs/csv-import.md §4、requirements Q-7）。
 * 自動登録ではなく、管理者がボタンを押したときだけ。すでにあるものは何もしない。
 */
const BULK_MAX = 200;
destinationBase.post('/destinations/bulk', async (c) => {
  authorize(c, 'master.edit');
  const db = scoped(c);
  const body = await readJson(c.req.raw);
  const items = body.items;
  if (!Array.isArray(items) || items.length === 0 || items.length > BULK_MAX) {
    throw new HttpError(422, `登録する納品先を 1〜${BULK_MAX} 件で送ってください。`);
  }
  const rows: { customer_code: string; code: string; name: string }[] = [];
  for (const [i, it] of items.entries()) {
    const o = (it ?? {}) as Record<string, unknown>;
    const cc = typeof o.customer_code === 'string' ? o.customer_code.trim() : '';
    const cd = typeof o.code === 'string' ? o.code.trim() : '';
    const nm = typeof o.name === 'string' ? o.name.trim() : '';
    if (!CODE_PATTERN.test(cc) || !CODE_PATTERN.test(cd) || !nm || nm.length > 100) {
      throw new HttpError(422, `${i + 1} 件目の得意先コード・直送先コード・納品先名を確認してください。`);
    }
    rows.push({ customer_code: cc, code: cd, name: nm });
  }
  const now = nowIso();
  const results = await db.batch([
    ...rows.map((r) => db.stmt(
      `INSERT INTO destinations (company_id, customer_code, code, name, status, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, 'active', ?5, ?5) ON CONFLICT (company_id, customer_code, code) DO NOTHING`,
      r.customer_code, r.code, r.name, now,
    )),
  ]);
  const created = results.reduce((n, r) => n + (r.meta.changes ?? 0), 0);
  await auditStatement(c, { action: 'destinations.bulk_create', targetType: 'destinations', detail: { requested: rows.length, created } }).run();
  return c.json({ created, skipped: rows.length - created });
});

export const destinationRoutes: Hono<AppEnv> = destinationBase;
