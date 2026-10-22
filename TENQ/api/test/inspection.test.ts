import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { T, auditCount, call, get, post } from './helpers';

async function completeWithKey(id: string, token: string, body: unknown, key: string) {
  const { default: app } = await import('../src/index');
  const res = await app.request(`/api/inspections/${id}/complete`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Idempotency-Key': key },
    body: JSON.stringify(body),
  }, env);
  return { status: res.status, body: await res.json() as any };
}

/** その設備の点検表の項目を全部「正常」（対象外を許可した項目は対象外）で埋める */
async function allOk(equipmentId: string, token: string) {
  const today = await get(`/equipment/${equipmentId}/today`, token);
  return today.body.items.map((i: { id: string; allow_na: number }) => ({ item_id: i.id, judgment: i.allow_na ? 'na' : 'ok' }));
}

describe('点検の開始と二重登録の防止（T-07）', () => {
  it('開始 → 同じ人はもう一度開いても続きから。別の人には「点検中」と知らせ、引き継げる', async () => {
    const first = await post('/equipment/eq-p04/inspections', T.worker, {});
    expect(first.status).toBe(201);
    const again = await post('/equipment/eq-p04/inspections', T.worker, {});
    expect(again.body).toMatchObject({ inspectionId: first.body.inspectionId, resumed: true });

    const other = await post('/equipment/eq-p04/inspections', T.staff, {});
    expect(other.status).toBe(409);
    expect(other.body).toMatchObject({ code: 'in_progress_by_other', inspectorName: '山本 健' });

    const take = await post('/equipment/eq-p04/inspections', T.staff, { takeover: true });
    expect(take.body).toMatchObject({ inspectionId: first.body.inspectionId, takenOver: true });
    expect(await auditCount('inspection.takeover', first.body.inspectionId)).toBe(1);

    // 引き継がれた元の人は完了できない
    const rows = await allOk('eq-p04', T.worker);
    const byOld = await completeWithKey(first.body.inspectionId, T.worker, { results: rows }, crypto.randomUUID());
    expect(byOld.status).toBe(409);
    expect(byOld.body.code).toBe('taken_over');
  });

  it('停止中の設備・点検基準のない設備は開始できない', async () => {
    expect((await post('/equipment/eq-k02/inspections', T.staff2, {})).status).toBe(409);
    const created = await post('/equipment', T.manager, { factory_id: 'fac-1a', equipment_code: 'T-NOTPL', name: '基準なし' });
    const r = await post(`/equipment/${created.body.id}/inspections`, T.manager, {});
    expect(r.status).toBe(409);
    expect(r.body.message).toContain('点検基準');
  });

  it('所属外の工場の設備は点検できない', async () => {
    expect((await post('/equipment/eq-p04/inspections', T.worker2, {})).status).toBe(404);
  });
});

describe('点検の完了（T-05 / T-06）', () => {
  it('必須項目が足りないと 422、対象外を許可していない項目の対象外も 422', async () => {
    const s = await post('/equipment/eq-m04/inspections', T.staff2, {});
    const rows = await allOk('eq-m04', T.staff2);
    const missing = await completeWithKey(s.body.inspectionId, T.staff2, { results: rows.slice(1) }, crypto.randomUUID());
    expect(missing.status).toBe(422);
    expect(Object.keys(missing.body.errors)).toContain(`item.${rows[0].item_id}`);
    const badNa = await completeWithKey(s.body.inspectionId, T.staff2, { results: [{ ...rows[0], judgment: 'na' }, ...rows.slice(1)] }, crypto.randomUUID());
    expect(badNa.status).toBe(422);
  });

  it('完了すると結果と点検基準の版が残り、同じキーの再送は1件にまとまる', async () => {
    const s = await post('/equipment/eq-m04/inspections', T.staff2, {});
    const rows = await allOk('eq-m04', T.staff2);
    rows[1] = { ...rows[1], judgment: 'ng', note: '主軸の振動が大きい' };
    const key = crypto.randomUUID();
    const done = await completeWithKey(s.body.inspectionId, T.staff2, { results: rows, comment: '異常あり' }, key);
    expect(done.status).toBe(200);
    expect(done.body.overall_result).toBe('ng');
    expect(done.body.ngItems).toEqual([rows[1].item_id]);

    const again = await completeWithKey(s.body.inspectionId, T.staff2, { results: rows }, key);
    expect(again.body.repeated).toBe(true);
    const otherKey = await completeWithKey(s.body.inspectionId, T.staff2, { results: rows }, crypto.randomUUID());
    expect(otherKey.status).toBe(409);

    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM inspection_results WHERE inspection_id = ?').bind(s.body.inspectionId).first<{ n: number }>();
    expect(n?.n).toBe(rows.length);
    expect(await auditCount('inspection.complete', s.body.inspectionId)).toBe(1);

    const detail = await get(`/inspections/${s.body.inspectionId}`, T.staff2);
    expect(detail.body.inspection).toMatchObject({ status: 'completed', overall_result: 'ng', version_no: 2, inspector_name: '鈴木 大地' });
    expect(detail.body.results.find((r: { judgment: string }) => r.judgment === 'ng').note).toBe('主軸の振動が大きい');

    // 完了した後はもう開始できない（今日の点検は1件）
    const restart = await post('/equipment/eq-m04/inspections', T.worker, {});
    expect(restart.status).toBe(409);
    expect(restart.body.code).toBe('completed');
  });

  it('Idempotency-Key がないと 400', async () => {
    const s = await post('/equipment/eq-c11/inspections', T.worker, {});
    expect((await call('POST', `/inspections/${s.body.inspectionId}/complete`, T.worker, { results: [] })).status).toBe(400);
  });
});

describe('取消', () => {
  it('一般社員は自分の点検中だけ取り消せ、取り消した後は新しく開始できる', async () => {
    const s = await post('/equipment/eq-w02/inspections', T.worker, {});
    expect((await post(`/inspections/${s.body.inspectionId}/void`, T.worker, {})).status).toBe(422);
    expect((await post(`/inspections/${s.body.inspectionId}/void`, T.worker, { reason: '別の設備を開いていた' })).status).toBe(200);
    const again = await post('/equipment/eq-w02/inspections', T.worker, {});
    expect(again.status).toBe(201);
    expect(again.body.inspectionId).not.toBe(s.body.inspectionId);
  });

  it('完了した点検は一般社員には取り消せない', async () => {
    expect((await post('/inspections/ins-p02/void', T.worker, { reason: 'x' })).status).toBe(403);
  });
});

describe('訂正（T-10）', () => {
  it('元の記録は残り、新しい版として追加される。理由は必須', async () => {
    const before = await get('/inspections/ins-l05', T.staff);
    const item = before.body.results[0];
    expect((await post('/inspections/ins-l05/corrections', T.worker, { version: before.body.inspection.version, reason: 'x', changes: [] })).status).toBe(403);
    expect((await post('/inspections/ins-l05/corrections', T.staff, { version: before.body.inspection.version, changes: [{ item_id: item.item_id, judgment: 'ng' }] })).status).toBe(422);

    const r = await post('/inspections/ins-l05/corrections', T.staff, {
      version: before.body.inspection.version, reason: '押し間違い（異常だった）', changes: [{ item_id: item.item_id, judgment: 'ng', note: '外装に亀裂' }],
    });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ revision: 2, overall_result: 'ng' });

    const rev1 = await env.DB.prepare("SELECT COUNT(*) AS n FROM inspection_results WHERE inspection_id = 'ins-l05' AND revision = 1").first<{ n: number }>();
    const rev2 = await env.DB.prepare("SELECT COUNT(*) AS n FROM inspection_results WHERE inspection_id = 'ins-l05' AND revision = 2").first<{ n: number }>();
    expect(rev1?.n).toBe(rev2?.n);
    const after = await get('/inspections/ins-l05', T.staff);
    expect(after.body.corrections[0]).toMatchObject({ from_revision: 1, to_revision: 2, reason: '押し間違い（異常だった）', corrected_by_name: '佐藤 美咲' });

    // 古い画面からの訂正は 409、同じ内容は「変更なし」
    expect((await post('/inspections/ins-l05/corrections', T.staff, { version: before.body.inspection.version, reason: 'x', changes: [{ item_id: item.item_id, judgment: 'ok' }] })).status).toBe(409);
    expect((await post('/inspections/ins-l05/corrections', T.staff, { version: after.body.inspection.version, reason: 'x', changes: [{ item_id: item.item_id, judgment: 'ng', note: '外装に亀裂' }] })).status).toBe(422);
  });

  it('設備担当者は担当外の設備の記録を訂正できない（工場長はできる）', async () => {
    const d = await get('/inspections/ins-w01', T.staff);
    const change = { version: d.body.inspection.version, reason: '確認', changes: [{ item_id: d.body.results[0].item_id, judgment: 'ng' }] };
    expect((await post('/inspections/ins-w01/corrections', T.staff, change)).status).toBe(403);
    expect((await post('/inspections/ins-w01/corrections', T.manager, change)).status).toBe(200);
  });
});

describe('点検基準の版（F-9）', () => {
  it('作成 → 下書き → 理由つきで公開。点検中の点検は開始したときの版のまま', async () => {
    expect((await post('/templates', T.staff, { name: 'x', items: [{ label: 'a' }] })).status).toBe(403);
    const created = await post('/templates', T.manager, { name: 'ボール盤 日常点検', items: [{ label: '外観', criteria: '破損がないこと' }, { label: '清掃', required: false, allow_na: true }] });
    expect(created.status).toBe(201);
    const tid = created.body.id;

    // 設備に割り当てて点検を開始しておく
    const eq = await post('/equipment', T.manager, { factory_id: 'fac-1a', equipment_code: 'T-TPL', name: '版テスト', template_id: tid });
    const ins = await post(`/equipment/${eq.body.id}/inspections`, T.worker, {});

    expect((await call('PUT', `/templates/${tid}/draft`, T.manager, { items: [] })).status).toBe(422);
    expect((await call('PUT', `/templates/${tid}/draft`, T.manager, { items: [{ label: '外観' }, { label: '清掃' }, { label: 'ベルトの張り', criteria: '指で押して10mm程度' }] })).status).toBe(201);
    expect((await post(`/templates/${tid}/publish`, T.manager, {})).status).toBe(422);
    const pub = await post(`/templates/${tid}/publish`, T.manager, { change_reason: 'ベルトの確認を追加' });
    expect(pub.body.version_no).toBe(2);

    const detail = await get(`/templates/${tid}`, T.manager);
    expect(detail.body.versions.map((v: { version_no: number; status: string }) => `${v.version_no}:${v.status}`)).toEqual(['2:published', '1:superseded']);
    expect(detail.body.current.length).toBe(3);

    // 開始済みの点検は第1版（2項目）のまま。新しく開始する点検は第2版
    const today = await get(`/equipment/${eq.body.id}/today`, T.worker);
    expect(today.body.inspection.id).toBe(ins.body.inspectionId);
    expect(today.body.items.length).toBe(2);
  });
});

describe('今日の点検状況（board）', () => {
  it('状態が判定され、他工場・他社からは見えない', async () => {
    const r = await get('/board?factory=fac-1a', T.worker);
    expect(r.status).toBe(200);
    const by = (code: string) => r.body.items.find((i: { equipment_code: string }) => i.equipment_code === code);
    expect(by('CR-2').board_status).toBe('ng');
    expect(by('K-02').board_status).toBe('stop');
    expect(by('P-01').board_status).toBe('ok');
    expect(by('L-07').open_abnormalities).toBe(1);
    expect(['todo', 'late', 'stop']).toContain(by('W-03').board_status);
    expect(r.body.areas.length).toBeGreaterThanOrEqual(4);
    expect((await get('/board?factory=fac-1a', T.other)).status).toBe(403);
    expect((await get('/board?factory=fac-2a', T.worker)).status).toBe(403);
  });
});
