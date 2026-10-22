import { describe, expect, it } from 'vitest';
import { can, PERMISSIONS, ROLES, type Actor } from '../src/permissions';
import { isoWeek, isPastLocalTime, isWorkingDay, localDate, periodKey } from '../src/period';
import { boardStatus } from '../src/status';
import { INSPECTION_CSV_HEADER, inspectionCsvRows, toCsv } from '../src/csv';

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

describe('QR の読み取り結果', () => {
  it('TENQ の QR だけトークンを取り出す', async () => {
    const { tokenFromQr } = await import('../src/qr');
    expect(tokenFromQr('https://space-apps.pages.dev/TENQ/q/#TENQDEVSEEDQRZAA')).toBe('TENQDEVSEEDQRZAA');
    expect(tokenFromQr('https://space-apps.pages.dev/TENQ/q/#tenqdevseedqrzaa')).toBe('TENQDEVSEEDQRZAA');
    expect(tokenFromQr('https://example.com/?q=TENQDEVSEEDQRZAA')).toBeNull();
    expect(tokenFromQr('https://space-apps.pages.dev/TENQ/q/#SHORT')).toBeNull();
    expect(tokenFromQr('https://space-apps.pages.dev/TENQ/q/#TENQDEVSEEDQRZA1')).toBeNull();
  });
});

describe('異常の状態遷移', () => {
  it('決められた遷移だけ通る', async () => {
    const { nextStatus, isOverdue } = await import('../src/abnormality');
    expect(nextStatus('assign', 'reported')).toBe('assigned');
    expect(nextStatus('start', 'assigned')).toBe('in_progress');
    expect(nextStatus('correct', 'in_progress')).toBe('corrected');
    expect(nextStatus('verify', 'corrected')).toBe('verified');
    expect(nextStatus('reject', 'corrected')).toBe('in_progress');
    expect(nextStatus('approve', 'verified')).toBe('closed');
    // 飛ばし・逆戻りはできない
    expect(nextStatus('approve', 'corrected')).toBeNull();
    expect(nextStatus('correct', 'reported')).toBeNull();
    expect(nextStatus('assign', 'closed')).toBeNull();
    // 対応中に担当を付け直しても、対応中のまま
    expect(nextStatus('assign', 'in_progress')).toBe('in_progress');
    expect(isOverdue('assigned', '2026-10-21', '2026-10-22')).toBe(true);
    expect(isOverdue('assigned', '2026-10-22', '2026-10-22')).toBe(false);
    expect(isOverdue('corrected', '2026-10-01', '2026-10-22')).toBe(false);
  });
});

describe('点検記録の CSV（画面で組み立てる）', () => {
  const ins = (id: string, date: string, code: string, started: string) => ({
    id, inspection_date: date, factory: '第1工場', equipment_code: code, equipment: '=SUM(A1)', template: '日常', version_no: 1, template_version_id: 'v1',
    inspector: '点検 太郎', status: 'completed', overall_result: 'ok' as const, started_at: started, completed_at: started, current_revision: 1, comment: null,
  });
  it('点検日・設備番号の順に、項目ごとに1行。数式は無害化、BOM と CRLF', () => {
    const rows = inspectionCsvRows([
      { total: 4, inspections: [ins('b', '2026-10-02', 'P-01', '2026-10-01T23:00:00Z')], items: [{ id: 'i2', template_version_id: 'v1', sort_order: 2, label: '油量', criteria: null }], results: [['b', 'i2', 'ng', '少ない']], nextCursor: 'x' },
      { inspections: [ins('a', '2026-10-01', 'P-02', '2026-10-01T00:00:00Z')], items: [{ id: 'i1', template_version_id: 'v1', sort_order: 1, label: '異音', criteria: 'なし' }, { id: 'i2', template_version_id: 'v1', sort_order: 2, label: '油量', criteria: null }], results: [['a', 'i1', 'ok', null]], nextCursor: null },
    ]);
    expect(rows.map((r) => `${r[0]}-${r[13]}`)).toEqual(['a-1', 'a-2', 'b-1', 'b-2']);
    expect(rows[0]?.[10]).toBe('2026-10-01 09:00');
    expect(rows[2]?.[16]).toBe('');
    expect(rows[3]?.[16]).toBe('異常');
    const text = toCsv(INSPECTION_CSV_HEADER, rows);
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text).toContain("'=SUM(A1)");
    expect(text.endsWith('\r\n')).toBe(true);
  });
});
