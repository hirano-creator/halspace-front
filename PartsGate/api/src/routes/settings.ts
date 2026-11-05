import { Hono } from 'hono';
import { MATCH_FIELDS, SCANS_PER_ITEM, type CompanySettings } from '@partsgate/shared';
import type { AppEnv } from '../types';
import { scoped, type Scoped } from '../lib/db';
import { authorize } from '../lib/guard';
import { Validator, conflict, readJson } from '../lib/http';
import { auditStatement, diff } from '../lib/audit';
import { nowIso } from '../lib/crypto';

/** 会社ごとのシステム設定（照合ルールなど。docs/database.md company_settings） */
export const settingsRoutes = new Hono<AppEnv>();

interface Row { match_field: CompanySettings['match_field']; barcode_strip_prefix: string; barcode_strip_suffix: string; scans_per_item: CompanySettings['scans_per_item']; warn_ship_date_mismatch: number; reauth_hours: number; version: number }

export async function readSettings(db: Scoped): Promise<CompanySettings> {
  const r = await db.first<Row>(
    'SELECT match_field, barcode_strip_prefix, barcode_strip_suffix, scans_per_item, warn_ship_date_mismatch, reauth_hours, version FROM company_settings WHERE company_id = ?1',
  );
  if (!r) {
    // 会社を作るときに必ず作るが、念のため既定値を返す
    return { match_field: 'barcode_global_no', barcode_strip_prefix: '', barcode_strip_suffix: '', scans_per_item: 'one', warn_ship_date_mismatch: true, reauth_hours: 12, version: 0 };
  }
  return { ...r, warn_ship_date_mismatch: r.warn_ship_date_mismatch === 1 };
}

settingsRoutes.get('/settings', async (c) => {
  authorize(c, 'settings.manage');
  return c.json(await readSettings(scoped(c)));
});

settingsRoutes.put('/settings', async (c) => {
  authorize(c, 'settings.manage');
  const db = scoped(c);
  const v = new Validator(await readJson(c.req.raw));
  const match_field = v.oneOf('match_field', MATCH_FIELDS, { required: true, label: '照合に使う列' });
  const prefix = v.str('barcode_strip_prefix', { max: 10, label: '読み取り値から外す先頭の文字' }) ?? '';
  const suffix = v.str('barcode_strip_suffix', { max: 10, label: '読み取り値から外す末尾の文字' }) ?? '';
  const scans = v.oneOf('scans_per_item', SCANS_PER_ITEM, { required: true, label: 'ラベルの枚数' });
  const warn = v.bool('warn_ship_date_mismatch', { required: true, label: '出荷日が今日でない明細を要確認にするか' });
  const reauth = v.int('reauth_hours', { required: true, min: 1, max: 72, label: '再ログインまでの時間' });
  const version = v.version();
  v.done();

  const before = await readSettings(db);
  const now = nowIso();
  const after = { match_field: match_field!, barcode_strip_prefix: prefix, barcode_strip_suffix: suffix, scans_per_item: scans!, warn_ship_date_mismatch: warn!, reauth_hours: reauth! };
  const [res] = await db.batch([
    db.stmt(
      `UPDATE company_settings SET match_field = ?2, barcode_strip_prefix = ?3, barcode_strip_suffix = ?4, scans_per_item = ?5,
         warn_ship_date_mismatch = ?6, reauth_hours = ?7, updated_at = ?8, version = version + 1
       WHERE company_id = ?1 AND version = ?9`,
      after.match_field, after.barcode_strip_prefix, after.barcode_strip_suffix, after.scans_per_item, after.warn_ship_date_mismatch ? 1 : 0, after.reauth_hours, now, version,
    ),
    auditStatement(c, { action: 'settings.update', targetType: 'settings', detail: diff(before, after) },
      { sql: 'SELECT 1 FROM company_settings WHERE company_id = ? AND version = ? AND updated_at = ?', params: [db.companyId, version + 1, now] }),
  ]);
  if (!res?.meta.changes) throw conflict();
  return c.json(await readSettings(db));
});
