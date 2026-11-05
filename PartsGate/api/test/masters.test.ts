import { describe, expect, it } from 'vitest';
import { T, auditCount, get, post, put, sql, versionOf } from './helpers';

describe('担当者・置場・納品先', () => {
  it('一般は一覧だけ見られ、登録・編集はできない', async () => {
    expect((await get('/staff', T.generalA)).status).toBe(200);
    expect((await post('/staff', T.generalA, { code: 'X1', name: 'x' })).status).toBe(403);
    expect((await put('/staff/1', T.generalA, { name: 'x', version: 1 })).status).toBe(403);
  });

  it('登録すると監査ログが残る', async () => {
    const r = await post('/staff', T.adminA, { code: 'S010', name: '新人 四郎', department: '出荷課' });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ code: 'S010', name: '新人 四郎', status: 'active', version: 1 });
    expect(await auditCount('staff.create', r.body.id)).toBe(1);
  });

  it('必須項目・コードの形式は 422 で項目ごとに返す', async () => {
    const r = await post('/locations', T.adminA, { code: '00 53', name: '' });
    expect(r.status).toBe(422);
    expect(Object.keys(r.body.errors).sort()).toEqual(['code', 'name']);
  });

  it('編集で必須項目を空にすると 422（黙って元の値のままにしない）', async () => {
    const r = await put('/staff/3', T.adminA, { name: '', version: await versionOf('staff', 3) });
    expect(r.status).toBe(422);
    expect(r.body.errors.name).toBeTruthy();
  });

  it('同じ会社で同じ置場コードは登録できない', async () => {
    const r = await post('/locations', T.adminA, { code: '0053', name: '重複' });
    expect(r.status).toBe(422);
    expect(r.body.errors.code).toContain('すでに登録');
  });

  it('納品先は得意先コード＋直送先コードで見分ける（同じ直送先コードでも得意先が違えば別）', async () => {
    expect((await post('/destinations', T.adminA, { customer_code: '100009', code: 'S00001', name: '別の得意先' })).status).toBe(201);
    expect((await post('/destinations', T.adminA, { customer_code: '100001', code: 'S00001', name: '重複' })).status).toBe(422);
  });

  it('編集は version が違えば 409（ほかの人が先に変えた）', async () => {
    const v = await versionOf('staff', 2);
    expect((await put('/staff/2', T.adminA, { name: '佐藤 花子', version: v })).status).toBe(200);
    expect((await put('/staff/2', T.adminA, { name: '古い画面から', version: v })).status).toBe(409);
  });

  it('利用停止はできるが削除はできない', async () => {
    const v = await versionOf('locations', 1);
    const r = await put('/locations/1', T.adminA, { status: 'inactive', version: v });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('inactive');
    await expect(sql('DELETE FROM locations WHERE id = 1')).rejects.toThrow();
    await put('/locations/1', T.adminA, { status: 'active', version: v + 1 });
  });

  it('状態で絞り込める', async () => {
    const r = await get('/staff?status=inactive', T.adminA);
    expect(r.body.items.map((x: { code: string }) => x.code)).toEqual(['S099']);
  });

  it('キーセットのページ送りで全件を重複なく読める', async () => {
    const seen: number[] = [];
    let cursor: string | null = null;
    do {
      const r: { body: { items: { id: number }[]; next_cursor: string | null } } = await get(`/staff?limit=2${cursor ? `&cursor=${cursor}` : ''}`, T.adminA);
      seen.push(...r.body.items.map((x) => x.id));
      cursor = r.body.next_cursor;
    } while (cursor);
    const all = await sql<{ id: number }>('SELECT id FROM staff WHERE company_id = 1');
    expect(seen.sort()).toEqual(all.map((x) => x.id).sort());
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('LIKE の記号は文字として検索する', async () => {
    const r = await get(`/staff?q=${encodeURIComponent('%')}`, T.adminA);
    expect(r.body.items).toEqual([]);
  });

  it('納品先のまとめて登録は、あるものを飛ばして件数を返す', async () => {
    const r = await post('/destinations/bulk', T.adminA, { items: [
      { customer_code: '100001', code: 'S00001', name: 'すでにある' },
      { customer_code: '100004', code: 'S00009', name: '新しい納品先' },
    ] });
    expect(r.body).toEqual({ created: 1, skipped: 1 });
    expect((await post('/destinations/bulk', T.adminA, { items: [{ customer_code: 'x x', code: 'S', name: 'n' }] })).status).toBe(422);
  });
});

describe('注文で使われている置場', () => {
  it('コードは変えられないが、名前は変えられる', async () => {
    const now = '2026-11-05T00:00:00.000Z';
    await sql("INSERT INTO import_batches (id, company_id, file_name, file_sha256, r2_key, encoding, status, created_by, created_at) VALUES (900, 1, 't.csv', 'x', 'k', 'utf-8', 'uploading', 1, ?)", now);
    await sql("INSERT INTO orders (id, company_id, slip_no, created_at, updated_at) VALUES (900, 1, 'SLIP-T', ?, ?)", now, now);
    await sql(`INSERT INTO order_items (company_id, order_id, global_no, barcode_global_no, product_code, quantity, location_id, location_code, row_hash, last_import_id, created_at, updated_at)
               VALUES (1, 900, 'G-LOCTEST', 'G-LOCTEST', 'P', 1, 3, '0055', 'h', 900, ?, ?)`, now, now);
    const v = await versionOf('locations', 3);
    expect((await put('/locations/3', T.adminA, { code: '0059', version: v })).status).toBe(422);
    expect((await put('/locations/3', T.adminA, { name: '中日本（稲沢）', version: v })).status).toBe(200);
  });
});

describe('利用者のロール', () => {
  it('自分のロールは変えられない', async () => {
    expect((await put('/users/1', T.adminA, { role: 'general', version: await versionOf('users', 1) })).status).toBe(422);
  });

  it('管理者が 1 人もいなくなる変更はできない', async () => {
    // 会社 B の管理者は 1 人だけ
    const r = await put('/users/11', T.adminB, { role: 'general', version: await versionOf('users', 11) });
    expect(r.status).toBe(422);
  });

  it('ほかの管理者がいれば、管理者を一般にできる（監査ログが残る）', async () => {
    const r = await put('/users/4', T.adminA, { role: 'general', version: await versionOf('users', 4) });
    expect(r.status).toBe(200);
    expect(await auditCount('user.update', 4)).toBe(1);
    await put('/users/4', T.adminA, { role: 'admin', version: await versionOf('users', 4) });
  });
});
