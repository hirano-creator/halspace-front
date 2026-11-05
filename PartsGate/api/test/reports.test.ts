import { beforeAll, describe, expect, it } from 'vitest';
import type { RawItem } from '@partsgate/shared';
import { T, auditCount, get, post, sql, upload } from './helpers';
import { jstDay } from '../src/routes/scans';

/** 履歴・注文データ・ダッシュボード・分析（STEP 7）。値はすべて架空 */

const TODAY = jstDay();
const ymd = TODAY.replace(/-/g, '');
const row = (line: number, g: string, over: Partial<RawItem> = {}): RawItem => ({
  line_no: line, global_no: g, barcode_global_no: g, slip_no: 'RP0000000001', product_code: `P-${g}`, quantity: '2',
  customer_code: '100001', customer_name: 'テスト工業（株）', destination_code: 'S00001', destination_name: 'テスト工業（株）第1工場',
  location_code: '0055', ssd: ymd, vrd: ymd, total_weight: '500', data_kind: 'F', ...over,
});

let session = 0;
let n = 0;
const scan = (raw: string) => post('/scans', T.generalA, { work_session_id: session, client_scan_id: `rp-scan-${++n}-xxxx`, raw_value: raw });
const range = `from=${TODAY}&to=${TODAY}`;

beforeAll(async () => {
  const b = await upload(T.adminA, 'x');
  await post(`/imports/${b.body.id}/rows`, T.adminA, { rows: [
    row(2, '5PRP00000001'), row(3, '5PRP00000002'), row(4, '5PRP00000003', { location_code: '0053' }),
    row(5, '5PRP00000004', { customer_code: '100002', customer_name: '見本電機（株）', slip_no: 'RP0000000002' }),
  ] });
  await post(`/imports/${b.body.id}/commit`, T.adminA, { expected_rows: 4 });
  session = (await post('/work-sessions', T.generalA, { staff_id: 1, device_id: 'rp-device-0001', device_label: '出荷場PC1' })).body.id;
  await scan('5PRP00000001');
  await scan('5PRP00000001'); // 読み取り済み
  await scan('5PRP99999999'); // 未登録
  await scan('5PRP00000003');
});

describe('読み取り履歴', () => {
  it('期間は必須・1 年まで', async () => {
    expect((await get('/scan-logs', T.generalA)).status).toBe(422);
    expect((await get('/scan-logs?from=2024-01-01&to=2026-01-01', T.generalA)).status).toBe(422);
  });

  it('新しい順に、明細・置場・端末つきで返す', async () => {
    const r = await get(`/scan-logs?${range}`, T.generalA);
    expect(r.status).toBe(200);
    expect(r.body.items.map((x: { result: string }) => x.result)).toEqual(['ok', 'not_found', 'duplicate', 'ok']);
    expect(r.body.items[0]).toMatchObject({ global_no: '5PRP00000003', location_code: '0053', staff_name: '山田 太郎', device_label: '出荷場PC1', user_name: '出荷場PC1' });
  });

  it('結果・バーコード・商品・得意先で絞り込める', async () => {
    expect((await get(`/scan-logs?${range}&result=problem`, T.generalA)).body.items.map((x: { result: string }) => x.result)).toEqual(['not_found', 'duplicate']);
    expect((await get(`/scan-logs?${range}&barcode=5prp00000001`, T.generalA)).body.items).toHaveLength(2);
    expect((await get(`/scan-logs?${range}&q=${encodeURIComponent('テスト工業')}`, T.generalA)).body.items).toHaveLength(3);
  });

  it('ページ送りで全件を重複なく読める', async () => {
    const seen: number[] = [];
    let cursor: string | null = null;
    do {
      const r: { body: { items: { id: number }[]; next_cursor: string | null } } = await get(`/scan-logs?${range}&limit=1${cursor ? `&cursor=${cursor}` : ''}`, T.generalA);
      seen.push(...r.body.items.map((x) => x.id));
      cursor = r.body.next_cursor;
    } while (cursor);
    expect(seen).toHaveLength(4);
    expect(new Set(seen).size).toBe(4);
  });

  it('取消は管理者だけ・理由必須。正常の取消で明細が照合待ちに戻り、記録は残る', async () => {
    const [ok] = await sql<{ id: number }>("SELECT id FROM scan_logs WHERE barcode = '5PRP00000003' AND result = 'ok'");
    expect((await post(`/scan-logs/${ok!.id}/corrections`, T.generalA, { action: 'void', reason: 'x' })).status).toBe(403);
    expect((await post(`/scan-logs/${ok!.id}/corrections`, T.adminA, { action: 'void' })).status).toBe(422);
    expect((await post(`/scan-logs/${ok!.id}/corrections`, T.adminA, { action: 'void', reason: '別の部品を読んだ' })).status).toBe(200);
    expect((await post(`/scan-logs/${ok!.id}/corrections`, T.adminA, { action: 'void', reason: '二重' })).status).toBe(409);
    const [it1] = await sql<{ status: string; scan_count: number }>("SELECT status, scan_count FROM order_items WHERE global_no = '5PRP00000003'");
    expect(it1).toEqual({ status: 'pending', scan_count: 0 });
    const list = await get(`/scan-logs?${range}&barcode=5PRP00000003`, T.generalA);
    expect(list.body.items[0]).toMatchObject({ result: 'ok', void_reason: '別の部品を読んだ' });
    expect(await auditCount('scan.void', ok!.id)).toBe(1);
  });
});

describe('注文データ', () => {
  it('期間・状態・置場・得意先・キーワードで絞り込める', async () => {
    const all = await get(`/orders/items?${range}`, T.generalA);
    expect(all.body.items.map((x: { global_no: string }) => x.global_no)).toEqual(['5PRP00000001', '5PRP00000002', '5PRP00000003', '5PRP00000004']);
    expect((await get(`/orders/items?${range}&status=matched`, T.generalA)).body.items).toHaveLength(1);
    expect((await get(`/orders/items?${range}&status=open`, T.generalA)).body.items).toHaveLength(3);
    expect((await get(`/orders/items?${range}&location_id=2`, T.generalA)).body.items).toHaveLength(1);
    expect((await get(`/orders/items?${range}&customer_code=100002`, T.generalA)).body.items).toHaveLength(1);
    expect((await get(`/orders/items?${range}&q=${encodeURIComponent('見本')}`, T.generalA)).body.items).toHaveLength(1);
  });

  it('詳細に読み取りの経緯と、同じ伝票の明細が出る', async () => {
    const [it1] = await sql<{ id: number }>("SELECT id FROM order_items WHERE company_id = 1 AND global_no = '5PRP00000001'");
    const r = await get(`/orders/items/${it1!.id}`, T.generalA);
    expect(r.body.item).toMatchObject({ global_no: '5PRP00000001', status: 'matched', slip_no: 'RP0000000001', matched_staff_name: '山田 太郎' });
    expect(r.body.scans.map((x: { result: string }) => x.result)).toEqual(['ok', 'duplicate']);
    expect(r.body.slip).toHaveLength(3);
  });

  it('要確認の解決（管理者・理由必須）', async () => {
    const [it2] = await sql<{ id: number }>("SELECT id FROM order_items WHERE company_id = 1 AND global_no = '5PRP00000002'");
    expect((await post(`/orders/items/${it2!.id}/resolve`, T.generalA, { action: 'cancel', reason: 'x' })).status).toBe(403);
    expect((await post(`/orders/items/${it2!.id}/resolve`, T.adminA, { action: 'cancel', reason: '客先の取消' })).body.status).toBe('cancelled');
    // 取消の明細を読むと「要確認」
    expect((await scan('5PRP00000002')).body.result).toBe('review');
    expect((await post(`/orders/items/${it2!.id}/resolve`, T.adminA, { action: 'reopen', reason: '取消の取り消し' })).body.status).toBe('pending');
    expect((await post(`/orders/items/${it2!.id}/resolve`, T.adminA, { action: 'reopen', reason: '二回目' })).status).toBe(409);
    expect(await auditCount('order_item.cancel', it2!.id)).toBe(1);
  });
});

describe('ダッシュボード・分析', () => {
  it('ダッシュボード: 今日の出荷・読み取り（集計表）・担当者別・置場別', async () => {
    const r = await get('/dashboard', T.generalA);
    expect(r.body.day).toBe(TODAY);
    expect(r.body.orders.total).toBeGreaterThanOrEqual(4);
    expect(r.body.scans.total).toBe(r.body.scans.ok + r.body.scans.duplicate + r.body.scans.review + r.body.scans.error);
    expect(r.body.by_staff[0]).toMatchObject({ name: '山田 太郎' });
    expect(r.body.by_location.map((x: { code: string }) => x.code)).toEqual(expect.arrayContaining(['0053', '0055']));
  });

  it('分析は管理者だけ', async () => {
    expect((await get(`/analytics/scans?${range}`, T.generalA)).status).toBe(403);
  });

  it('読み取りの集計（日別・担当者別）は集計表と一致', async () => {
    const r = await get(`/analytics/scans?${range}&group=staff`, T.adminA);
    const ok = r.body.rows.filter((x: { result: string }) => x.result === 'ok').reduce((s: number, x: { n: number }) => s + x.n, 0);
    const [logs] = await sql<{ n: number }>("SELECT COUNT(*) AS n FROM scan_logs WHERE company_id = 1 AND day = ? AND result = 'ok'", TODAY);
    expect(ok).toBe(logs!.n);
  });

  it('得意先別の注文（明細・伝票・数量・重量・照合済み・未確認）', async () => {
    const r = await get(`/analytics/orders?${range}&group=customer`, T.adminA);
    const t = r.body.rows.find((x: { k: string }) => x.k === '100001');
    expect(t).toMatchObject({ label: 'テスト工業（株）', items: 3, slips: 1, qty: 6, kg: 1.5, destinations: 1 });
    expect((await get(`/analytics/orders?${range}&group=nope`, T.adminA)).status).toBe(422);
  });

  it('得意先 1 社の内訳', async () => {
    const r = await get(`/analytics/customers/100001?${range}`, T.adminA);
    expect(r.body.by_location.map((x: { k: string }) => x.k).sort()).toEqual(['0053', '0055']);
    expect(r.body.by_destination[0]).toMatchObject({ k: 'S00001', items: 3 });
  });
});

describe('履歴・分析のテナント分離', () => {
  it('他社からは会社 A の履歴・明細・集計が見えず、変えられない', async () => {
    expect((await get(`/scan-logs?${range}`, T.generalB)).body.items).toEqual([]);
    expect((await get(`/orders/items?${range}`, T.generalB)).body.items).toEqual([]);
    const [it1] = await sql<{ id: number }>("SELECT id FROM order_items WHERE company_id = 1 AND global_no = '5PRP00000001'");
    expect((await get(`/orders/items/${it1!.id}`, T.generalB)).status).toBe(404);
    expect((await post(`/orders/items/${it1!.id}/resolve`, T.adminB, { action: 'cancel', reason: 'x' })).status).toBe(404);
    const [log] = await sql<{ id: number }>("SELECT id FROM scan_logs WHERE company_id = 1 AND result = 'ok' LIMIT 1");
    expect((await post(`/scan-logs/${log!.id}/corrections`, T.adminB, { action: 'void', reason: 'x' })).status).toBe(404);
    expect((await get(`/analytics/orders?${range}&group=customer`, T.adminB)).body.rows).toEqual([]);
    expect((await get(`/analytics/customers/100001?${range}`, T.adminB)).body.by_day).toEqual([]);
    expect((await get(`/analytics/scans?${range}&group=staff`, T.adminB)).body.rows).toEqual([]);
    const d = await get('/dashboard', T.generalB);
    expect(d.body.orders.total).toBe(0);
    expect(d.body.scans.total).toBe(0);
  });
});
