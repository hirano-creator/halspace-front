import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { authorize, idParam } from '../lib/guard';
import { HttpError, Validator, conflict, notFound, readJson } from '../lib/http';
import { auditStatement, diff } from '../lib/audit';
import { nowIso } from '../lib/crypto';

/**
 * 企業管理（HaLSpace の運営者だけ。docs/security.md §3）。
 * ここだけは会社をまたいで一覧するので scoped() を使わない。入口の authorize('companies.manage') が必須。
 * 会社そのものは Space.app で作る。PARTS GATE の会社は、その会社の人が初めて開いたときに自動でできる。
 */
export const companyRoutes = new Hono<AppEnv>();

const COLS = 'c.id, c.name, c.code, c.address, c.phone, c.admin_note, c.status, c.created_at, c.updated_at, c.version';

companyRoutes.get('/admin/companies', async (c) => {
  authorize(c, 'companies.manage');
  const { results } = await c.env.DB.prepare(
    `SELECT ${COLS},
            (SELECT COUNT(*) FROM users u WHERE u.company_id = c.id AND u.status = 'active') AS user_count,
            (SELECT MAX(u.last_seen_at) FROM users u WHERE u.company_id = c.id) AS last_seen_at
       FROM companies c ORDER BY c.id LIMIT 500`,
  ).all();
  return c.json({ items: results });
});

companyRoutes.put('/admin/companies/:id', async (c) => {
  authorize(c, 'companies.manage');
  const id = idParam(c);
  const v = new Validator(await readJson(c.req.raw));
  const name = v.str('name', { max: 100, label: '企業名' });
  const code = v.str('code', { max: 50, label: '企業コード' });
  const address = v.nullableStr('address', { max: 200, label: '住所' });
  const phone = v.nullableStr('phone', { max: 20, label: '電話番号' });
  const admin_note = v.nullableStr('admin_note', { max: 500, label: '管理者情報' });
  const status = v.oneOf('status', ['active', 'suspended'] as const, { label: '利用状態' });
  const version = v.version();
  v.done();

  const before = await c.env.DB.prepare('SELECT * FROM companies WHERE id = ?').bind(id).first<Record<string, unknown>>();
  if (!before) throw notFound();
  if (status === 'suspended' && id === c.get('auth').companyId) {
    throw new HttpError(422, '自分の会社は停止できません。');
  }
  const after = {
    name: name ?? before.name, code: code ?? before.code,
    address: address === undefined ? before.address : address, phone: phone === undefined ? before.phone : phone,
    admin_note: admin_note === undefined ? before.admin_note : admin_note, status: status ?? before.status,
  };
  const now = nowIso();
  try {
    const [res] = await c.env.DB.batch([
      c.env.DB.prepare('UPDATE companies SET name = ?, code = ?, address = ?, phone = ?, admin_note = ?, status = ?, updated_at = ?, version = version + 1 WHERE id = ? AND version = ?')
        .bind(after.name, after.code, after.address, after.phone, after.admin_note, after.status, now, id, version),
      // 監査ログは操作した運営者の会社に残る。どの会社を変えたかは target_id と detail.company_id で分かる
      auditStatement(c, { action: 'company.update', targetType: 'company', targetId: id, detail: { ...diff(before, after), company_id: id } },
        { sql: 'SELECT 1 FROM companies WHERE id = ? AND version = ? AND updated_at = ?', params: [id, version + 1, now] }),
    ]);
    if (!res?.meta.changes) throw conflict();
  } catch (e) {
    if (e instanceof Error && /UNIQUE constraint failed/i.test(e.message)) {
      throw new HttpError(422, '入力内容を確認してください。', { errors: { code: '同じ企業コードがすでに登録されています。' } });
    }
    throw e;
  }
  return c.json(await c.env.DB.prepare(`SELECT ${COLS} FROM companies c WHERE c.id = ?`).bind(id).first());
});
