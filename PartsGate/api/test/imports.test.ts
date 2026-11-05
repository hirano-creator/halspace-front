import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import type { RawItem } from '@partsgate/shared';
import { T, auditCount, get, post, sql, upload } from './helpers';

/**
 * CSV 取込の API（docs/csv-import.md）。画面が mapRow した結果（文字列のまま）を 200 行ずつ送る形を再現する。
 * 値はすべて架空。
 */

const row = (line: number, g: string, over: Partial<RawItem> = {}): RawItem => ({
  line_no: line, global_no: g, barcode_global_no: g, slip_no: 'AB9000000001', product_code: `MVSHM-${g}`, product_name: 'MEVIY SHEET METAL',
  quantity: '2', customer_code: '100001', customer_name: 'テスト工業（株）', destination_code: 'S00001', destination_name: 'テスト工業（株）第1工場',
  location_code: '0055', ssd: '20261105', vrd: '20261106', ship_method: 'センター納入', export_type: 'D', unit_weight: '10.00', total_weight: '20.00',
  data_kind: 'F', ...over,
});

async function runImport(token: string, rows: RawItem[]) {
  const b = await upload(token, 'dummy csv body\r\n');
  expect(b.status).toBe(201);
  const r = await post(`/imports/${b.body.id}/rows`, token, { rows });
  expect(r.status).toBe(200);
  const done = await post(`/imports/${b.body.id}/commit`, token, { expected_rows: rows.length });
  expect(done.status).toBe(200);
  return { id: b.body.id as number, rows: r.body, batch: done.body };
}

describe('CSV 取込', () => {
  it('一般は取り込めない', async () => {
    expect((await upload(T.generalA, 'x')).status).toBe(403);
    expect((await post('/imports/lookup', T.generalA, { global_nos: [] })).status).toBe(403);
  });

  it('新規登録 → 伝票・明細ができ、元のファイルが R2 に残り、監査ログが付く', async () => {
    const { id, batch } = await runImport(T.adminA, [row(2, '5P900000000001'), row(3, '5P900000000002'), row(4, '5P900000000003', { slip_no: 'AB9000000002', location_code: '0053' })]);
    expect(batch).toMatchObject({ status: 'committed', row_total: 3, row_new: 3, row_updated: 0, row_unchanged: 0, row_error: 0, row_review: 0, created_by_name: '管理 太郎' });
    const items = await sql<{ global_no: string; location_id: number; destination_id: number | null; required_scans: number; ssd: string; status: string }>(
      "SELECT global_no, location_id, destination_id, required_scans, ssd, status FROM order_items WHERE company_id = 1 AND global_no LIKE '5P90000000000%' ORDER BY global_no");
    expect(items).toEqual([
      { global_no: '5P900000000001', location_id: 3, destination_id: 1, required_scans: 1, ssd: '2026-11-05', status: 'pending' },
      { global_no: '5P900000000002', location_id: 3, destination_id: 1, required_scans: 1, ssd: '2026-11-05', status: 'pending' },
      { global_no: '5P900000000003', location_id: 2, destination_id: 1, required_scans: 1, ssd: '2026-11-05', status: 'pending' },
    ]);
    const [o] = await sql<{ item_count: number }>("SELECT item_count FROM orders WHERE company_id = 1 AND slip_no = 'AB9000000001'");
    expect(o?.item_count).toBe(2);
    expect(await auditCount('import.commit', id)).toBe(1);
    const file = await env.FILES.get((await sql<{ r2_key: string }>('SELECT r2_key FROM import_batches WHERE id = ?', id))[0]!.r2_key);
    expect(await file?.text()).toBe('dummy csv body\r\n');
  });

  it('同じ内容をもう一度取り込むと全部「変更なし」（二重登録しない）', async () => {
    const { batch } = await runImport(T.adminA, [row(2, '5P900000000001'), row(3, '5P900000000002')]);
    expect(batch).toMatchObject({ row_new: 0, row_unchanged: 2 });
    expect(await sql("SELECT id FROM order_items WHERE company_id = 1 AND global_no IN ('5P900000000001', '5P900000000002')")).toHaveLength(2);
  });

  it('照合前の明細は数量の変更で「更新」になり、変更前後が残る', async () => {
    const { id, batch } = await runImport(T.adminA, [row(2, '5P900000000001', { quantity: '4', total_weight: '40.00' })]);
    expect(batch.row_updated).toBe(1);
    const r = await get(`/imports/${id}/rows?kind=updated`, T.adminA);
    expect(JSON.parse(r.body.items[0].diff_json)).toEqual({ quantity: [2, 4], total_weight: [20, 40] });
    expect((await sql<{ quantity: number }>("SELECT quantity FROM order_items WHERE global_no = '5P900000000001'"))[0]?.quantity).toBe(4);
  });

  it('照合済みの明細は上書きせず「要確認」（読み取りの記録は変わらない）', async () => {
    await sql("UPDATE order_items SET status = 'matched', scan_count = 1 WHERE company_id = 1 AND global_no = '5P900000000002'");
    const { batch } = await runImport(T.adminA, [row(3, '5P900000000002', { quantity: '9' })]);
    expect(batch.row_review).toBe(1);
    const [it2] = await sql<{ quantity: number; status: string }>("SELECT quantity, status FROM order_items WHERE global_no = '5P900000000002'");
    expect(it2).toEqual({ quantity: 2, status: 'matched' });
  });

  it('未登録の置場・F 以外は要確認、壊れた行・重複はエラー。ほかの行は取り込む', async () => {
    const { id, rows, batch } = await runImport(T.adminA, [
      row(2, '5P900000000010', { location_code: '0057' }),
      row(3, '5P900000000011', { data_kind: 'C' }),
      row(4, '5P900000000012', { quantity: '0' }),
      row(5, '5P900000000013'),
      row(6, '5P900000000013'),                                       // 同じファイルで同じグローバル番号
      row(7, '5P900000000014', { barcode_global_no: '5P900000000001' }), // 別の明細のバーコード
    ]);
    expect(batch).toMatchObject({ row_total: 6, row_new: 1, row_review: 2, row_error: 3 });
    expect(rows.rows.map((r: { line_no: number; kind: string }) => [r.line_no, r.kind])).toEqual([[4, 'error'], [6, 'error'], [2, 'review'], [3, 'review'], [7, 'error']]);
    expect(rows.rows[0].message).toContain('数量');
    const errs = await get(`/imports/${id}/rows?kind=error`, T.adminA);
    expect(errs.body.items.map((x: { line_no: number }) => x.line_no)).toEqual([4, 6, 7]);
    expect(await sql("SELECT id FROM order_items WHERE global_no IN ('5P900000000010', '5P900000000011', '5P900000000012', '5P900000000014')")).toEqual([]);
  });

  it('同じ行の再送は二重に数えない（確定時の件数は記録から数え直す）', async () => {
    const b = await upload(T.adminA, 'x');
    const rows = [row(2, '5P900000000020'), row(3, '5P900000000021')];
    await post(`/imports/${b.body.id}/rows`, T.adminA, { rows });
    await post(`/imports/${b.body.id}/rows`, T.adminA, { rows }); // 通信が切れたと思って再送
    const done = await post(`/imports/${b.body.id}/commit`, T.adminA, { expected_rows: 2 });
    expect(done.body).toMatchObject({ row_total: 2, row_new: 2, row_unchanged: 0 });
  });

  it('届いていない行があれば確定できない', async () => {
    const b = await upload(T.adminA, 'x');
    await post(`/imports/${b.body.id}/rows`, T.adminA, { rows: [row(2, '5P900000000030')] });
    expect((await post(`/imports/${b.body.id}/commit`, T.adminA, { expected_rows: 5 })).status).toBe(409);
    expect((await post(`/imports/${b.body.id}/abort`, T.adminA, {})).status).toBe(200);
    // 中止した取込には送れない・確定できない
    expect((await post(`/imports/${b.body.id}/rows`, T.adminA, { rows: [row(2, '5P900000000031')] })).status).toBe(409);
  });

  it('取込中は同時にもう 1 つ始められない', async () => {
    const b = await upload(T.adminA, 'x');
    expect((await upload(T.admin2A, 'y')).status).toBe(409);
    await post(`/imports/${b.body.id}/abort`, T.adminA, {});
    expect((await upload(T.admin2A, 'y')).status).toBe(201);
    await sql("UPDATE import_batches SET status = 'aborted' WHERE status = 'uploading'");
  });

  it('ファイルの検証（拡張子・空・大きさ・確認用の値）', async () => {
    expect((await upload(T.adminA, 'x', { 'X-File-Name': 'a.xlsx' })).status).toBe(422);
    expect((await upload(T.adminA, 'x', { 'X-File-Sha256': 'zz' })).status).toBe(422);
    expect((await upload(T.adminA, 'x', { 'Content-Length': String(11 * 1024 * 1024) })).status).toBe(413);
  });

  it('数量分ラベルの会社は、必要な読み取り回数が数量になる', async () => {
    const s = (await get('/settings', T.adminB)).body;
    await (await import('./helpers')).put('/settings', T.adminB, { ...s, scans_per_item: 'quantity' });
    await runImport(T.adminB, [row(2, '5PB00000000001', { location_code: 'A1', customer_code: '200001', destination_code: 'X0001', quantity: '3' })]);
    const [it3] = await sql<{ required_scans: number; company_id: number }>("SELECT required_scans, company_id FROM order_items WHERE global_no = '5PB00000000001'");
    expect(it3).toEqual({ required_scans: 3, company_id: 2 });
  });
});

describe('照会（プレビュー用）', () => {
  it('登録済みの明細・バーコードの持ち主・納品先・置場を返す', async () => {
    const r = await post('/imports/lookup', T.adminA, {
      global_nos: ['5P900000000001', '5P999999999999'], barcodes: ['5P900000000001'],
      destinations: [['100001', 'S00001'], ['100099', 'S99999']],
    });
    expect(r.status).toBe(200);
    expect(r.body.items.map((x: { global_no: string }) => x.global_no)).toEqual(['5P900000000001']);
    expect(r.body.items[0]).toMatchObject({ slip_no: 'AB9000000001', quantity: 4, status: 'pending' });
    expect(r.body.barcode_owners).toEqual([{ barcode_global_no: '5P900000000001', global_no: '5P900000000001' }]);
    expect(r.body.destinations).toEqual([{ customer_code: '100001', code: 'S00001' }]);
    expect(r.body.locations.sort()).toEqual(['0052', '0053', '0055', '0056']);
  });

  it('納品先をあとでまとめて登録すると、取り込み済みの明細にも結び付く', async () => {
    await runImport(T.adminA, [row(2, '5P900000000040', { customer_code: '100077', destination_code: 'S07777' })]);
    expect((await sql<{ destination_id: number | null }>("SELECT destination_id FROM order_items WHERE global_no = '5P900000000040'"))[0]?.destination_id).toBeNull();
    await post('/destinations/bulk', T.adminA, { items: [{ customer_code: '100077', code: 'S07777', name: '後から登録した納品先' }] });
    expect((await sql<{ destination_id: number | null }>("SELECT destination_id FROM order_items WHERE global_no = '5P900000000040'"))[0]?.destination_id).not.toBeNull();
  });
});

describe('取込のテナント分離', () => {
  it('他社の取込回・行・ファイルは 404、他社の明細は照会に出ない', async () => {
    const [mine] = await sql<{ id: number }>('SELECT id FROM import_batches WHERE company_id = 1 ORDER BY id LIMIT 1');
    for (const path of [`/imports/${mine!.id}`, `/imports/${mine!.id}/rows`, `/imports/${mine!.id}/file`]) {
      expect((await get(path, T.adminB)).status).toBe(404);
    }
    expect((await post(`/imports/${mine!.id}/rows`, T.adminB, { rows: [row(2, '5P900000000099')] })).status).toBe(404);
    expect((await post(`/imports/${mine!.id}/commit`, T.adminB, { expected_rows: 1 })).status).toBe(404);
    expect((await post(`/imports/${mine!.id}/abort`, T.adminB, {})).status).toBe(404);
    const r = await post('/imports/lookup', T.adminB, { global_nos: ['5P900000000001'], barcodes: ['5P900000000001'] });
    expect(r.body.items).toEqual([]);
    expect(r.body.barcode_owners).toEqual([]);
    const list = await get('/imports', T.adminB);
    expect(list.body.items.every((x: { id: number }) => x.id !== mine!.id)).toBe(true);
  });

  it('他社と同じグローバル番号でも、自分の会社の明細として別に登録される', async () => {
    await runImport(T.adminB, [row(2, '5P900000000001', { location_code: 'A1', customer_code: '200001', destination_code: 'X0001' })]);
    const rows = await sql<{ company_id: number }>("SELECT company_id FROM order_items WHERE global_no = '5P900000000001' ORDER BY company_id");
    expect(rows.map((x) => x.company_id)).toEqual([1, 2]);
  });
});
