import { describe, expect, it } from 'vitest';
import { can, PERMISSIONS, ROLES, type Actor } from '../src/permissions';
import { isoWeek, isPastLocalTime, isWorkingDay, localDate, periodKey } from '../src/period';
import { boardStatus } from '../src/status';

const TZ = 'Asia/Tokyo';
const actor = (role: Actor['role'], id = 'u1', factoryIds = ['f1']): Actor => ({ id, role, factoryIds });

describe('権限表', () => {
  it('全操作に4ロール分の定義がある', () => {
    for (const rowDef of Object.values(PERMISSIONS)) {
      expect(Object.keys(rowDef).sort()).toEqual([...ROLES].sort());
    }
  });

  it('ロール未設定は何もできない', () => {
    expect(can(actor(null), 'inspection.perform')).toBe(false);
  });

  it('所属工場の外は不可、system_admin は全工場可', () => {
    expect(can(actor('factory_manager'), 'inspection.perform', { factoryId: 'f2' })).toBe(false);
    expect(can(actor('system_admin', 'u1', []), 'inspection.perform', { factoryId: 'f2' })).toBe(true);
  });

  it('承認は工場長だけ（要確認①）', () => {
    expect(can(actor('factory_manager'), 'abnormality.approve')).toBe(true);
    expect(can(actor('system_admin'), 'abnormality.approve')).toBe(false);
    expect(can(actor('equipment_staff'), 'abnormality.approve')).toBe(false);
  });

  it('訂正は設備担当者なら担当設備だけ、一般社員は不可（要確認③）', () => {
    expect(can(actor('equipment_staff'), 'inspection.correct', { equipmentManagerId: 'u1' })).toBe(true);
    expect(can(actor('equipment_staff'), 'inspection.correct', { equipmentManagerId: 'u9' })).toBe(false);
    expect(can(actor('worker'), 'inspection.correct', { equipmentManagerId: 'u1' })).toBe(false);
  });

  it('一般社員も同じ工場の記録とカード一覧を見られる（要確認②④）', () => {
    expect(can(actor('worker'), 'inspection.viewFactory', { factoryId: 'f1' })).toBe(true);
    expect(can(actor('worker'), 'board.view', { factoryId: 'f1' })).toBe(true);
  });

  it('再確認は直した本人は不可', () => {
    expect(can(actor('factory_manager'), 'abnormality.verify', { fixerIds: ['u1'] })).toBe(false);
    expect(can(actor('factory_manager'), 'abnormality.verify', { fixerIds: ['u2'] })).toBe(true);
    expect(can(actor('factory_manager'), 'abnormality.verify')).toBe(false);
  });

  it('一般社員の取り消しは自分の点検中だけ', () => {
    expect(can(actor('worker'), 'inspection.void', { inspectorId: 'u1', inspectionStatus: 'in_progress' })).toBe(true);
    expect(can(actor('worker'), 'inspection.void', { inspectorId: 'u1', inspectionStatus: 'completed' })).toBe(false);
    expect(can(actor('worker'), 'inspection.void', { inspectorId: 'u2', inspectionStatus: 'in_progress' })).toBe(false);
  });
});

describe('点検期間', () => {
  it('日本時間の0時で日付が切り替わる', () => {
    expect(localDate(new Date('2026-10-21T14:59:59Z'), TZ)).toBe('2026-10-21');
    expect(localDate(new Date('2026-10-21T15:00:00Z'), TZ)).toBe('2026-10-22');
  });

  it('期間キー', () => {
    const at = new Date('2026-10-22T01:00:00Z');
    expect(periodKey('daily', at, TZ)).toBe('2026-10-22');
    expect(periodKey('weekly', at, TZ)).toBe('2026-W43');
    expect(periodKey('monthly', at, TZ)).toBe('2026-10');
  });

  it('ISO週は年またぎを正しく扱う', () => {
    expect(isoWeek(2027, 1, 1)).toEqual({ year: 2026, week: 53 });
    expect(isoWeek(2024, 12, 30)).toEqual({ year: 2025, week: 1 });
  });

  it('稼働曜日と期限時刻', () => {
    const wed = new Date('2026-10-22T01:00:00Z'); // 水曜 10:00 JST
    const sat = new Date('2026-10-24T01:00:00Z');
    expect(isWorkingDay(wed, TZ, '1,2,3,4,5')).toBe(true);
    expect(isWorkingDay(sat, TZ, '1,2,3,4,5')).toBe(false);
    expect(isPastLocalTime(wed, TZ, '09:00')).toBe(true);
    expect(isPastLocalTime(wed, TZ, '10:01')).toBe(false);
  });
});

describe('カードの状態', () => {
  const base = { equipmentStatus: 'active' as const, inspection: null, isDue: true, isPastDeadline: false };
  it('6つの状態', () => {
    expect(boardStatus({ ...base, equipmentStatus: 'stopped' })).toBe('stop');
    expect(boardStatus({ ...base, inspection: { status: 'completed', overallResult: 'ng' } })).toBe('ng');
    expect(boardStatus({ ...base, inspection: { status: 'completed', overallResult: 'ok' } })).toBe('ok');
    expect(boardStatus({ ...base, inspection: { status: 'in_progress', overallResult: null } })).toBe('doing');
    expect(boardStatus(base)).toBe('todo');
    expect(boardStatus({ ...base, isPastDeadline: true })).toBe('late');
  });
  it('点検日でない日は未点検に数えない', () => {
    expect(boardStatus({ ...base, isDue: false, isPastDeadline: true })).toBe('stop');
  });
});
