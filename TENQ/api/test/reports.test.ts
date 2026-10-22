import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import app from '../src/index';
import { INSPECTION_CSV_HEADER, inspectionCsvRows, toCsv, type InspectionExportPage } from '@tenq/shared';
import { T, call, get, post } from './helpers';

const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date());
const month = today.slice(0, 7);

async function csv(path: string, token: string) {
  const res = await app.request(`/api${path}`, { headers: { Authorization: `Bearer ${token}` } }, env);
  const buf = new Uint8Array(await res.arrayBuffer());
  return { status: res.status, type: res.headers.get('Content-Type'), disposition: res.headers.get('Content-Disposition'), bytes: buf, text: new TextDecoder().decode(buf) };
}
const auditCountOf = async (action: string) =>
  (await env.DB.prepare('SELECT COUNT(*) AS n FROM audit_logs WHERE action = ?').bind(action).first<{ n: number }>())?.n ?? 0;

describe('点検記録の検索（F-8）', () => {
  it('期間・結果・異常の有無・状態で絞り込める', async () => {
    const all = await get(`/inspections?from=${today}&to=${today}&limit=100`, T.manager);
    expect(all.status).toBe(200);
    expect(all.body.items.every((i: { inspection_date: string; status: string }) => i.inspection_date === today && i.status !== 'voided')).toBe(true);
    const ng = await get('/inspections?result=ng&limit=100', T.manager);
    expect(ng.body.items.length).toBeGreaterThan(0);
    expect(ng.body.items.every((i: { overall_result: string }) => i.overall_result === 'ng')).toBe(true);
    const withAbn = await get('/inspections?abnormal=1&limit=100', T.manager);
    expect(withAbn.body.items.map((i: { id: string }) => i.id)).toContain('ins-l07');
    const voided = await get('/inspections?status=voided', T.manager);
    expect(voided.body.items.map((i: { id: string }) => i.id)).toContain('ins-w01-void');
  });

  it('ページ送りで重複も抜けもない。日付の形式違いは 422。他社は 0 件', async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const r: { body: { items: { id: string }[]; nextCursor: string | null } } = await get(`/inspections?limit=3${cursor ? `&cursor=${cursor}` : ''}`, T.admin);
      seen.push(...r.body.items.map((i) => i.id));
      cursor = r.body.nextCursor;
    } while (cursor);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.length).toBeGreaterThanOrEqual(9);
    expect((await get('/inspections?from=2026/10/01', T.manager)).status).toBe(422);
    expect((await get('/inspections', T.other)).body.items.length).toBe(0);
  });
});

describe('CSV 出力（T-11）', () => {
  it('出力の権限は設備担当者以上', async () => {
    expect((await get('/exports/inspections', T.worker)).status).toBe(403);
    expect((await csv('/exports/equipment.csv', T.worker)).status).toBe(403);
  });

  it('点検記録はページに分けた JSON で返し、画面で CSV にできる。出力は最初のページで1回だけ監査ログに残る', async () => {
    const before = await auditCountOf('export.csv');
    const pages: InspectionExportPage[] = [];
    let cursor: string | null = null;
    do {
      const r: { status: number; body: InspectionExportPage } = await get(`/exports/inspections?from=${today}&to=${today}${cursor ? `&cursor=${cursor}` : ''}`, T.staff);
      expect(r.status).toBe(200);
      pages.push(r.body);
      cursor = r.body.nextCursor;
    } while (cursor);
    const rows = inspectionCsvRows(pages);
    expect(rows.length).toBe(pages[0]?.total);
    const text = toCsv(INSPECTION_CSV_HEADER, rows);
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text.split('\r\n')[0]).toContain('点検日,工場,設備番号');
    expect(text).toContain('主軸から異音');
    expect(await auditCountOf('export.csv')).toBe(before + 1);
  });

  it('点検記録の出力は他社の記録を含まない', async () => {
    const r = await get('/exports/inspections', T.other);
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(0);
    expect(r.body.inspections).toHaveLength(0);
    expect(r.body.results).toHaveLength(0);
  });

  it('設備台帳 CSV は UTF-8 の BOM・CRLF・日本語のファイル名', async () => {
    const r = await csv('/exports/equipment.csv', T.manager);
    expect(r.type).toBe('text/csv; charset=utf-8');
    expect([...r.bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(r.text).toContain('\r\n');
    expect(r.disposition).toContain(encodeURIComponent('設備台帳'));
  });

  it('数式として実行される値には先頭に \' を付ける', async () => {
    await post('/equipment', T.manager, { factory_id: 'fac-1a', equipment_code: 'CSV-1', name: '=HYPERLINK("http://evil")', notes: '+cmd|calc' });
    const r = await csv('/exports/equipment.csv', T.manager);
    expect(r.text).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(r.text).toContain(`'+cmd|calc`);
    expect(r.text).not.toMatch(/,=HYPERLINK/);
  });

  it('異常・是正処置の CSV に期限超過が出る', async () => {
    const r = await csv('/exports/abnormalities.csv', T.manager);
    const line = r.text.split('\r\n').find((l) => l.startsWith('F01-0002'));
    expect(line).toContain('超過');
    expect(line).toContain('ブレーキの効きが弱い');
  });
});

describe('帳票（T-11）', () => {
  it('月間点検表は 項目 × 日 で返る。他工場の設備は 404', async () => {
    const r = await get(`/reports/monthly-sheet?equipment=eq-l07&month=${month}`, T.worker);
    expect(r.status).toBe(200);
    const row = r.body.rows.find((x: { label: string }) => x.label === '異音・振動');
    expect(row.cells[today].judgment).toBe('ng');
    expect(r.body.abnormalities.length).toBeGreaterThan(0);
    expect((await get(`/reports/monthly-sheet?equipment=eq-l07&month=${month}`, T.other)).status).toBe(404);
    expect((await get('/reports/monthly-sheet?equipment=eq-l07&month=2026-1', T.worker)).status).toBe(400);
  });

  it('ISO 監査向けの一覧は 実施状況・訂正・版・異常・取消 を含む', async () => {
    expect((await get(`/reports/audit-pack?factory=fac-1a&from=${today}&to=${today}`, T.worker)).status).toBe(403);
    const r = await get(`/reports/audit-pack?factory=fac-1a&from=${month}-01&to=${today}`, T.manager);
    expect(r.status).toBe(200);
    expect(r.body.summary.completed).toBeGreaterThan(0);
    expect(r.body.versions.map((v: { template: string }) => v.template)).toContain('切削機 日常点検');
    expect(r.body.voided.map((v: { equipment_code: string }) => v.equipment_code)).toContain('W-01');
    expect(r.body.abnormalities.some((a: { report_no: string }) => a.report_no === 'F01-0001')).toBe(true);
    expect((await get('/reports/audit-pack?factory=fac-1a', T.manager)).status).toBe(400);
    expect((await get(`/reports/audit-pack?factory=fac-1b&from=${today}&to=${today}`, T.manager)).status).toBe(403);
  });
});

describe('集計', () => {
  it('点検者別・設備分類別・日別', async () => {
    const r = await get('/stats?factory=fac-1a', T.manager);
    expect(r.body.byInspector.map((x: { name: string }) => x.name)).toContain('山本 健');
    expect(r.body.byCategory.map((x: { category: string }) => x.category)).toContain('プレス');
    expect(r.body.byDate.find((x: { date: string }) => x.date === today).completed).toBeGreaterThan(0);
  });
});

describe('監査ログ', () => {
  it('工場長とシステム管理者だけ。工場長は所属工場の分だけ', async () => {
    expect((await get('/audit-logs', T.staff)).status).toBe(403);
    const mgr = await get('/audit-logs?limit=200', T.manager);
    expect(mgr.status).toBe(200);
    expect(mgr.body.items.every((l: { factory_name: string | null }) => l.factory_name === '第1工場')).toBe(true);
    const adm = await get('/audit-logs?action=export', T.admin);
    expect(adm.body.items.length).toBeGreaterThan(0);
    expect(adm.body.items.every((l: { action: string }) => l.action.startsWith('export'))).toBe(true);
  });
});

describe('システム設定', () => {
  it('システム管理者だけが変更でき、範囲外・未知の項目は 422。変更は監査ログに残る', async () => {
    expect((await get('/settings', T.manager)).status).toBe(403);
    expect((await call('PUT', '/settings', T.admin, { late_threshold: '25:00' })).status).toBe(422);
    expect((await call('PUT', '/settings', T.admin, { retention_years: 0 })).status).toBe(422);
    expect((await call('PUT', '/settings', T.admin, { qr_base_url: 'https://evil.example/' })).status).toBe(422);
    const before = await auditCountOf('settings.update');
    expect((await call('PUT', '/settings', T.admin, { retention_years: 7, late_threshold: '08:30' })).status).toBe(200);
    const s = await get('/settings', T.admin);
    expect(s.body.settings).toMatchObject({ retention_years: 7, late_threshold: '08:30' });
    expect(await auditCountOf('settings.update')).toBe(before + 1);
  });
});

describe('カード一覧の配置', () => {
  it('工場長は設備を別のエリアへ移せる。他工場のエリア・はみ出しは 422、一般社員は 403', async () => {
    const body = { factory_id: 'fac-1a', areas: [{ id: 'area-b', grid_row: 0, grid_col: 5, col_span: 4, sort_order: 2 }], equipment: [{ id: 'eq-new', area_id: 'area-b', board_order: 9 }] };
    expect((await call('PUT', '/areas/layout', T.worker, body)).status).toBe(403);
    expect((await call('PUT', '/areas/layout', T.manager, { ...body, areas: [{ ...body.areas[0], grid_col: 10, col_span: 4 }] })).status).toBe(422);
    expect((await call('PUT', '/areas/layout', T.manager, { ...body, equipment: [{ id: 'eq-b01', area_id: 'area-b', board_order: 1 }] })).status).toBe(422);
    expect((await call('PUT', '/areas/layout', T.manager, body)).status).toBe(200);
    const board = await get('/board?factory=fac-1a', T.manager);
    expect(board.body.items.find((i: { id: string }) => i.id === 'eq-new').area_id).toBe('area-b');
  });
});
