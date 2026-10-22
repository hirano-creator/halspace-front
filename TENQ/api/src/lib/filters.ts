import type { Context } from 'hono';
import { can } from '@tenq/shared';
import type { AppEnv } from '../types';
import { Validator } from './http';
import { scopeWhere } from './scope';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 点検記録の検索条件（検索画面・CSV・帳票で共通）。
 * 期間（点検日）、工場、設備、点検者、結果、状態、異常の有無、訂正の有無、設備分類。
 * 取消（voided）は status=voided / all を指定したときだけ含める。
 */
export function inspectionFilter(c: Context<AppEnv>): { where: string[]; params: unknown[] } {
  const auth = c.get('auth');
  const q = c.req.query();
  const v = new Validator(q);
  const from = v.str('from', { max: 10, label: '開始日' });
  const to = v.str('to', { max: 10, label: '終了日' });
  if (from && !DATE.test(from)) v.fail('from', '開始日の形式が正しくありません。');
  if (to && !DATE.test(to)) v.fail('to', '終了日の形式が正しくありません。');
  if (from && to && from > to) v.fail('to', '終了日は開始日より後にしてください。');
  v.done();

  const s = scopeWhere(auth, 'i');
  const where = [s.sql];
  const params: unknown[] = [...s.params];
  if (from) { where.push('i.inspection_date >= ?'); params.push(from); }
  if (to) { where.push('i.inspection_date <= ?'); params.push(to); }
  if (q.factory) { where.push('i.factory_id = ?'); params.push(q.factory); }
  if (q.equipment) { where.push('i.equipment_id = ?'); params.push(q.equipment); }
  if (q.inspector) { where.push('i.inspector_user_id = ?'); params.push(q.inspector); }
  if (q.category) { where.push('e.category = ?'); params.push(q.category); }
  if (q.result === 'ok' || q.result === 'ng') { where.push("i.status = 'completed' AND i.overall_result = ?"); params.push(q.result); }
  if (q.status === 'in_progress' || q.status === 'completed' || q.status === 'voided') { where.push('i.status = ?'); params.push(q.status); }
  else if (q.status !== 'all') where.push("i.status <> 'voided'");
  if (q.abnormal === '1') where.push('EXISTS (SELECT 1 FROM abnormalities a WHERE a.inspection_id = i.id)');
  if (q.abnormal === '0') where.push('NOT EXISTS (SELECT 1 FROM abnormalities a WHERE a.inspection_id = i.id)');
  if (q.corrected === '1') where.push('i.current_revision > 1');
  // 工場の記録を見られない人は自分の点検だけ（権限表上は全員見られるが、表が変わっても安全なように）
  if (q.mine === '1' || !can(auth.actor, 'inspection.viewFactory')) { where.push('i.inspector_user_id = ?'); params.push(auth.user.id); }
  return { where, params };
}
