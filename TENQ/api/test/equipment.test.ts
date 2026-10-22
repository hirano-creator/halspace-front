import { describe, expect, it } from 'vitest';
import { T, auditCount, get, patch, post, version } from './helpers';

const ACTIVE_TOKEN_P04 = 'TENQDEVSEEDQRZAD';

describe('設備の一覧と範囲（T-02 / T-03）', () => {
  it('一般社員は所属工場（第1工場）の設備だけ見える', async () => {
    const r = await get('/equipment?limit=200', T.worker);
    expect(r.status).toBe(200);
    expect(r.body.items.every((e: { factory_name: string }) => e.factory_name === '第1工場')).toBe(true);
    expect(r.body.items.length).toBe(16);
  });

  it('システム管理者は自社の全工場、他社の設備は誰からも見えない', async () => {
    const admin = await get('/equipment?limit=200', T.admin);
    expect(admin.body.items.length).toBe(17);
    const other = await get('/equipment?limit=200', T.other);
    expect(other.body.items.map((e: { equipment_code: string }) => e.equipment_code)).toEqual(['X-01']);
  });

  it('範囲外の設備の詳細は 404（存在を知らせない）', async () => {
    expect((await get('/equipment/eq-p01', T.worker2)).status).toBe(404);
    expect((await get('/equipment/eq-p01', T.other)).status).toBe(404);
    expect((await get('/equipment/eq-p01', T.worker)).status).toBe(200);
  });

  it('キーセットのページ送りで、重複も抜けもなく全件たどれる', async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const r: { body: { items: { id: string }[]; nextCursor: string | null } } = await get(`/equipment?limit=5${cursor ? `&cursor=${cursor}` : ''}`, T.admin);
      seen.push(...r.body.items.map((e) => e.id));
      cursor = r.body.nextCursor;
    } while (cursor);
    expect(seen.length).toBe(17);
    expect(new Set(seen).size).toBe(17);
  });

  it('キーワード検索（% や _ はそのままの文字として扱う）', async () => {
    const r = await get(`/equipment?q=${encodeURIComponent('プレス')}`, T.worker);
    expect(r.body.items.length).toBe(4);
    expect((await get(`/equipment?q=${encodeURIComponent('%')}`, T.worker)).body.items.length).toBe(0);
  });

  it('詳細は有効な QR トークンと、ボタン表示用の権限を返す', async () => {
    const r = await get('/equipment/eq-p01', T.staff);
    expect(r.body.item.qr_token).toBe('TENQDEVSEEDQRZAA');
    expect(r.body.permissions).toMatchObject({ edit: true, editAll: false, stop: true, retire: false, qr: true });
  });
});

describe('設備の登録', () => {
  const body = { factory_id: 'fac-1a', equipment_code: 'T-100', name: 'テスト設備', area_id: 'area-a', frequency: 'daily', template_id: 'tpl-press' };

  it('一般社員・設備担当者は登録できない', async () => {
    expect((await post('/equipment', T.worker, body)).status).toBe(403);
    expect((await post('/equipment', T.staff, body)).status).toBe(403);
  });

  it('工場長は登録でき、QR トークンが同時に発行され、監査ログが残る', async () => {
    const r = await post('/equipment', T.manager, body);
    expect(r.status).toBe(201);
    const detail = await get(`/equipment/${r.body.id}`, T.manager);
    expect(detail.body.item.qr_token).toMatch(/^[A-Z2-7]{16}$/);
    expect(await auditCount('equipment.create', r.body.id)).toBe(1);
  });

  it('同じ工場で設備番号が重なると 422、他工場のエリアは 422、必須抜けは 422', async () => {
    const dup = await post('/equipment', T.manager, { ...body, name: '重複' });
    expect(dup.status).toBe(422);
    expect(dup.body.errors.equipment_code).toBeTruthy();
    const area = await post('/equipment', T.admin, { ...body, factory_id: 'fac-1b', equipment_code: 'T-101' });
    expect(area.status).toBe(422);
    expect(area.body.errors.area_id).toBeTruthy();
    const missing = await post('/equipment', T.manager, { factory_id: 'fac-1a' });
    expect(Object.keys(missing.body.errors).sort()).toEqual(['equipment_code', 'name']);
  });

  it('所属していない工場には登録できない', async () => {
    expect((await post('/equipment', T.manager, { ...body, factory_id: 'fac-1b', area_id: null, equipment_code: 'T-102' })).status).toBe(403);
  });
});

describe('設備の編集（権限表の条件付き）', () => {
  it('設備担当者は担当設備の一部の項目だけ変えられる', async () => {
    const v = await version('equipment', 'eq-p02');
    const ok = await patch('/equipment/eq-p02', T.staff, { version: v, location: 'A棟 2列目', notes: '油圧ホース交換済み' });
    expect(ok.status).toBe(200);
    const name = await patch('/equipment/eq-p02', T.staff, { version: v + 1, name: '名前変更' });
    expect(name.status).toBe(403);
  });

  it('設備担当者は担当外の設備を変えられない', async () => {
    const v = await version('equipment', 'eq-m04');
    expect((await patch('/equipment/eq-m04', T.staff, { version: v, notes: 'x' })).status).toBe(403);
  });

  it('同時編集は 409 になり、そのときは監査ログを書かない', async () => {
    const v = await version('equipment', 'eq-l05');
    const first = await patch('/equipment/eq-l05', T.manager, { version: v, name: 'NC旋盤 5号（改）' });
    expect(first.status).toBe(200);
    const before = await auditCount('equipment.update', 'eq-l05');
    const stale = await patch('/equipment/eq-l05', T.manager, { version: v, name: '古い画面からの更新' });
    expect(stale.status).toBe(409);
    expect(await auditCount('equipment.update', 'eq-l05')).toBe(before);
  });

  it('工場は変えられない', async () => {
    const v = await version('equipment', 'eq-w01');
    expect((await patch('/equipment/eq-w01', T.admin, { version: v, factory_id: 'fac-1b' })).status).toBe(422);
  });
});

describe('停止・廃止', () => {
  it('設備担当者は担当設備を停止・再開できるが、廃止はできない', async () => {
    let v = await version('equipment', 'eq-cr1');
    expect((await post('/equipment/eq-cr1/status', T.staff, { version: v, status: 'stopped' })).status).toBe(422);
    expect((await post('/equipment/eq-cr1/status', T.staff, { version: v, status: 'stopped', reason: 'ワイヤー点検のため' })).status).toBe(200);
    v = await version('equipment', 'eq-cr1');
    expect((await post('/equipment/eq-cr1/status', T.staff, { version: v, status: 'active' })).status).toBe(200);
    v = await version('equipment', 'eq-cr1');
    expect((await post('/equipment/eq-cr1/status', T.staff, { version: v, status: 'retired', reason: '更新' })).status).toBe(403);
  });

  it('廃止した設備は編集も状態変更もできない', async () => {
    const created = await post('/equipment', T.manager, { factory_id: 'fac-1a', equipment_code: 'T-200', name: '廃止テスト' });
    let v = await version('equipment', created.body.id);
    expect((await post(`/equipment/${created.body.id}/status`, T.manager, { version: v, status: 'retired', reason: '撤去' })).status).toBe(200);
    v = await version('equipment', created.body.id);
    expect((await patch(`/equipment/${created.body.id}`, T.manager, { version: v, name: 'x' })).status).toBe(409);
    expect((await post(`/equipment/${created.body.id}/status`, T.manager, { version: v, status: 'active' })).status).toBe(409);
  });
});

describe('QR コード（T-04）', () => {
  it('ログインしていなければ何も分からない', async () => {
    expect((await get(`/qr/${ACTIVE_TOKEN_P04}`)).status).toBe(401);
  });

  it('正しいトークンで正しい設備（小文字でも可）', async () => {
    const r = await get(`/qr/${ACTIVE_TOKEN_P04.toLowerCase()}`, T.worker);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ equipmentId: 'eq-p04', equipment_code: 'P-04' });
  });

  it('他社のトークンは 404、所属外の工場は 403、形式違いは 404', async () => {
    expect((await get('/qr/TENQDEVSEEDQRZXA', T.worker)).status).toBe(404);
    expect((await get(`/qr/${ACTIVE_TOKEN_P04}`, T.worker2)).status).toBe(403);
    expect((await get('/qr/abc', T.worker)).status).toBe(404);
  });

  it('再発行すると旧トークンは 410（再発行済み）、新トークンで開ける。設備IDは変わらない', async () => {
    expect((await post('/equipment/eq-w03/qr', T.worker, { reason: '汚損' })).status).toBe(403);
    expect((await post('/equipment/eq-w03/qr', T.staff2, {})).status).toBe(422);
    const re = await post('/equipment/eq-w03/qr', T.staff2, { reason: '汚損' });
    expect(re.status).toBe(201);
    const old = await get('/qr/TENQDEVSEEDQRZAL', T.worker);
    expect(old.status).toBe(410);
    expect(old.body.message).toContain('再発行済み');
    const fresh = await get(`/qr/${re.body.token}`, T.worker);
    expect(fresh.body.equipmentId).toBe('eq-w03');
    expect((await get('/qr/TENQDEVSEEDQROLD', T.worker)).status).toBe(410);
  });

  it('ラベル印刷用の一覧は QR を発行できる人だけ', async () => {
    expect((await get('/qr-labels?factory=fac-1a', T.worker)).status).toBe(403);
    const r = await get('/qr-labels?factory=fac-1a&ids=eq-p01,eq-p02', T.staff);
    expect(r.body.items.map((x: { equipment_code: string }) => x.equipment_code)).toEqual(['P-01', 'P-02']);
  });
});
