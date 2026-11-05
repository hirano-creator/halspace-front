import { describe, expect, it } from 'vitest';
import { ACTIONS, can } from '../src';

describe('権限表', () => {
  it('一般は読み取り・閲覧だけ', () => {
    const g = { role: 'general' as const, operator: false };
    expect(ACTIONS.filter((a) => can(g, a))).toEqual(['scan', 'orders.view', 'master.view']);
  });

  it('管理者は企業管理以外すべて', () => {
    const a = { role: 'admin' as const, operator: false };
    expect(ACTIONS.filter((x) => !can(a, x))).toEqual(['companies.manage']);
  });

  it('企業管理は運営者だけ（ロールに関係なし）', () => {
    expect(can({ role: 'general', operator: true }, 'companies.manage')).toBe(true);
    expect(can({ role: 'admin', operator: false }, 'companies.manage')).toBe(false);
  });
});
