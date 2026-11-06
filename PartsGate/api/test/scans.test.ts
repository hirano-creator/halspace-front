import { beforeAll, describe, expect, it } from 'vitest';
import type { RawItem } from '@partsgate/shared';
import { T, get, post, put, sql, upload } from './helpers';
import { jstDay, normalizeBarcode } from '../src/routes/scans';

/**
 * バーコード照合の API（docs/scan-matching.md）。値はすべて架空。
 * 明細は CSV 取込の API で入れる（実際と同じ経路）。メーカー出荷日は「今日」にしておく。
 */

const TODAY = jstDay();
const ymd = TODAY.replace(/-/g, '');
const row = (line: number, g: string, over: Partial<RawItem> = {}): RawItem => ({
  line_no: line, global_no: g, barcode_global_no: g, slip_no: 'SC0000000001', product_code: `P-${g}`, quantity: '1',
  customer_code: '100001', customer_name: 'テスト工業（株）', destination_code: 'S00001', location_code: '0055',
  ssd: ymd, vrd: ymd, data_kind: 'F', ...over,
});

let session = 0;
let n = 0;
const scan = (raw: string, over: Record<string, unknown> = {}, token: string = T.generalA) =>
  post('/scans', token, { work_session_id: session, client_scan_id: `test-scan-${++n}-xxxx`, raw_value: raw, input: 'scanner', ...over });

beforeAll(async () => {
  const b = await upload(T.adminA, 'x');
  await post(`/imports/${b.body.id}/rows`, T.adminA, { rows: [
    row(2, '5PSC00000001'), row(3, '5PSC00000002'), row(4, '5PSC00000003'),
    row(5, '5PSC00000004', { ssd: '20200101' }),             // 出荷日が今日でない
    row(6, '5PSC00000005', { location_code: '0053' }),
    ...Array.from({ length: 5 }, (_, i) => row(7 + i, `5PSC0000010${i}`)),
  ] });
  await post(`/imports/${b.body.id}/commit`, T.adminA, { expected_rows: 10 });
  const s = await post('/work-sessions', T.generalA, { staff_id: 1, device_id: 'test-device-0001', device_label: '出荷場PC1' });
  expect(s.status).toBe(201);
  session = s.body.id;
});

describe('作業セッション（担当者の選択）', () => {
  it('利用停止中・他社の担当者は選べない', async () => {
    expect((await post('/work-sessions', T.generalA, { staff_id: 4, device_id: 'test-device-0001' })).status).toBe(422);  // 退職 三郎（停止中）
    expect((await post('/work-sessions', T.generalA, { staff_id: 11, device_id: 'test-device-0001' })).status).toBe(422); // 他社の担当者
  });

  it('セッションなし・他人のセッション・終わったセッションでは読み取れない', async () => {
    expect((await post('/scans', T.generalA, { work_session_id: 999999, client_scan_id: 'test-nosession-1', raw_value: '5PSC00000001' })).status).toBe(409);
    expect((await scan('5PSC00000001', {}, T.adminA)).status).toBe(409); // 別の利用者のセッション
    const s2 = await post('/work-sessions', T.generalA, { staff_id: 2, device_id: 'test-device-0002' });
    await post(`/work-sessions/${s2.body.id}/end`, T.generalA, {});
    const r = await post('/scans', T.generalA, { work_session_id: s2.body.id, client_scan_id: 'test-ended-0001', raw_value: '5PSC00000001' });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('SESSION_ENDED');
  });
});

describe('照合', () => {
  it('正常 → 明細が照合済みになり、担当者と置場が返る', async () => {
    const r = await scan('5PSC00000001');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ result: 'ok', message: '注文データと一致しました', staff_name: '山田 太郎', replay: false });
    expect(r.body.item).toMatchObject({ global_no: '5PSC00000001', status: 'matched', location_code: '0055', location_name: '中日本', matched_staff_name: '山田 太郎', slip_no: 'SC0000000001' });
  });

  it('2 回目は「読み取り済み」で、最初の日時と担当者を返す', async () => {
    const r = await scan('5PSC00000001');
    expect(r.body.result).toBe('duplicate');
    expect(r.body.previous.staff_name).toBe('山田 太郎');
  });

  it('未登録の番号・形式が正しくない値も記録する', async () => {
    expect((await scan('5PZZ99999999')).body.result).toBe('not_found');
    const bad = await scan('あいう');
    expect(bad.body.result).toBe('error');
    expect(bad.body.message).toContain('形式');
  });

  it('前後の空白・小文字・設定した前置きの文字は取り除いて照合する', async () => {
    expect(normalizeBarcode(' ]C15psc00000002\r', ']C1', '')).toBe('5PSC00000002');
    const s = (await get('/settings', T.adminA)).body;
    await put('/settings', T.adminA, { ...s, barcode_strip_prefix: ']C1' });
    const r = await scan(' ]C15psc00000002 ');
    expect(r.body.result).toBe('ok');
    const s2 = (await get('/settings', T.adminA)).body;
    await put('/settings', T.adminA, { ...s2, barcode_strip_prefix: '' });
  });

  it('日本語入力がオンのまま読んで全角が混ざっても、半角にそろえて照合する', async () => {
    expect(normalizeBarcode('５K900000000008', '', '')).toBe('5K900000000008');
    expect(normalizeBarcode('ＭＶＳ－００１', '', '')).toBe('MVS-001');
    const r = await scan('５ＰＳＣ00000005');
    expect(r.body.result).toBe('ok');
    expect(r.body.barcode).toBe('5PSC00000005');
  });

  it('メーカー出荷日が今日でない明細は「要確認」で、照合済みにしない', async () => {
    const r = await scan('5PSC00000004');
    expect(r.body.result).toBe('review');
    expect(r.body.message).toContain('01/01');
    expect(r.body.item.status).toBe('pending');
  });

  it('同じ読み取りの再送は前回の結果を返す（記録 1 件）', async () => {
    const body = { work_session_id: session, client_scan_id: 'test-replay-0001', raw_value: '5PSC00000003' };
    const a = await post('/scans', T.generalA, body);
    const b = await post('/scans', T.generalA, body);
    expect(a.body.result).toBe('ok');
    expect(b.body).toMatchObject({ result: 'ok', replay: true, scan_id: a.body.scan_id });
    expect(await sql("SELECT id FROM scan_logs WHERE client_scan_id = 'test-replay-0001'")).toHaveLength(1);
  });

  it('同じラベルを 10 台で同時に読んでも、正常は 1 回だけ（API 経由）', async () => {
    const sessions = await Promise.all(Array.from({ length: 10 }, (_, i) =>
      post('/work-sessions', T.generalA, { staff_id: 1 + (i % 3), device_id: `test-pc-concurrent-${i}` })));
    const rs = await Promise.all(sessions.map((s, i) =>
      post('/scans', T.generalA, { work_session_id: s.body.id, client_scan_id: `test-concurrent-${i}-x`, raw_value: '5PSC00000100' })));
    const results = rs.map((r) => r.body.result).sort();
    expect(results.filter((x) => x === 'ok')).toHaveLength(1);
    expect(results.filter((x) => x === 'duplicate')).toHaveLength(9);
    const [it1] = await sql<{ scan_count: number }>("SELECT scan_count FROM order_items WHERE global_no = '5PSC00000100'");
    expect(it1?.scan_count).toBe(1);
  });

  it('今日の件数（集計表）', async () => {
    const r = await get('/scans/today', T.generalA);
    expect(r.body.day).toBe(TODAY);
    expect(r.body.ok).toBeGreaterThanOrEqual(4);
    expect(r.body.total).toBe(r.body.ok + r.body.duplicate + r.body.review + r.body.error);
  });
});

describe('置場別チェックの一覧', () => {
  it('置場ごとの件数と、選んだ置場の明細（チェック者つき）', async () => {
    const r = await get(`/scan-board?vrd=${TODAY}&location_id=3`, T.generalA);
    expect(r.status).toBe(200);
    const tab55 = r.body.tabs.find((t: { code: string }) => t.code === '0055');
    expect(tab55).toMatchObject({ total: 9 });
    expect(tab55.done).toBeGreaterThanOrEqual(4);
    expect(r.body.tabs.map((t: { code: string }) => t.code)).toEqual(['0052', '0053', '0055', '0056']);
    const first = r.body.items.find((x: { global_no: string }) => x.global_no === '5PSC00000001');
    expect(first).toMatchObject({ status: 'matched', matched_staff_name: '山田 太郎' });
    expect(r.body.items.every((x: { location_code: string }) => x.location_code === '0055')).toBe(true);
  });

  it('納期の一覧', async () => {
    const r = await get('/scan-board/dates', T.generalA);
    expect(r.body.items.map((x: { vrd: string }) => x.vrd)).toContain(TODAY);
  });
});

describe('照合のテナント分離', () => {
  it('他社の人は会社 A のラベルを読んでも「未登録」、会社 A のセッションは使えない', async () => {
    const sB = await post('/work-sessions', T.generalB, { staff_id: 11, device_id: 'test-device-b001' });
    const r = await post('/scans', T.generalB, { work_session_id: sB.body.id, client_scan_id: 'test-tenant-b-1', raw_value: '5PSC00000002' });
    expect(r.body.result).toBe('not_found');
    expect(r.body.item).toBeNull();
    expect((await post('/scans', T.generalB, { work_session_id: session, client_scan_id: 'test-tenant-b-2', raw_value: '5PSC00000002' })).status).toBe(409);
    expect((await post(`/work-sessions/${session}/end`, T.generalB, {})).body.ended).toBe(false);
    // 他社の client_scan_id を使っても、会社 A の記録は返らない
    const replay = await post('/scans', T.generalB, { work_session_id: sB.body.id, client_scan_id: 'test-replay-0001', raw_value: '5PZZ00000000' });
    expect(replay.body.replay).toBe(false);
  });

  it('他社の一覧には会社 A の明細が出ない', async () => {
    const r = await get(`/scan-board?vrd=${TODAY}&location_id=3`, T.generalB);
    expect(r.body.items).toEqual([]);
    expect(r.body.tabs.map((t: { code: string }) => t.code)).not.toContain('0055');
  });
});
