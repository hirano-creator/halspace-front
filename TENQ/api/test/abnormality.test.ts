import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import app from '../src/index';
import { T, auditCount, del, get, post, version } from './helpers';

const year = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date()).slice(0, 4);
const tomorrow = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date(Date.now() + 86_400_000));

const report = (token: string, body: Record<string, unknown>) =>
  post('/abnormalities', token, { title: 'テストの異常', severity: 'medium', ...body });
const act = async (id: string, token: string, body: Record<string, unknown>) =>
  post(`/abnormalities/${id}/transition`, token, { version: await version('abnormalities', id), ...body });

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);
async function upload(token: string, ownerId: string, bytes: Uint8Array, type = 'image/jpeg', length = bytes.byteLength) {
  const res = await app.request(`/api/attachments?owner_type=abnormality&owner_id=${ownerId}`, {
    method: 'POST', body: bytes,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': type, 'Content-Length': String(length), 'X-File-Name': encodeURIComponent('写真.jpg') },
  }, env);
  return { status: res.status, body: await res.json() as any };
}

describe('異常の報告', () => {
  it('一般社員も報告でき、報告番号は「工場コード-年-連番」', async () => {
    const r = await report(T.worker, { equipment_id: 'eq-w01', severity: 'high', equipment_stopped: true, emergency_action: '電源を切った' });
    expect(r.status).toBe(201);
    expect(r.body.report_no).toMatch(new RegExp(`^F01-${year}-\\d{4}$`));
    // 一般社員には設備の停止の権限がないので、設備の状態は変えない（「止めた」という記録だけ残す）
    expect(r.body.equipmentStatusChanged).toBe(false);
    const second = await report(T.worker, { equipment_id: 'eq-w01' });
    expect(Number(second.body.report_no.slice(-4))).toBe(Number(r.body.report_no.slice(-4)) + 1);
    expect(await auditCount('abnormality.report', r.body.id)).toBe(1);
  });

  it('設備担当者が「止めた」と報告すると、担当設備は停止中になる', async () => {
    const r = await report(T.staff, { equipment_id: 'eq-p01', severity: 'high', equipment_stopped: true });
    expect(r.body.equipmentStatusChanged).toBe(true);
    const eq = await get('/equipment/eq-p01', T.staff);
    expect(eq.body.item.status).toBe('stopped');
    expect(eq.body.item.status_reason).toContain(r.body.report_no);
  });

  it('入力の不足・範囲外の設備・点検との不一致は拒否', async () => {
    expect((await post('/abnormalities', T.worker, { equipment_id: 'eq-w01', title: 'x' })).status).toBe(422);
    expect((await report(T.worker, { equipment_id: 'eq-x01' })).status).toBe(404);
    expect((await report(T.worker, { equipment_id: 'eq-w01', inspection_id: 'ins-p02' })).status).toBe(422);
    const ok = await report(T.worker, { equipment_id: 'eq-l07', inspection_id: 'ins-l07', inspection_item_id: 'it-cut2-2' });
    expect(ok.status).toBe(201);
  });
});

describe('「直した」（2026-10-31 簡単化。requirements §10 Q-5）', () => {
  it('一般社員は押せない。設備担当者・工場長は一言を書いて押すと完了になり、是正処置と履歴が残る', async () => {
    const { body: { id } } = await report(T.worker, { equipment_id: 'eq-w01', title: 'トーチの先が曲がっている' });
    expect((await act(id, T.worker, { action: 'resolve', description: '交換した' })).status).toBe(403);
    expect((await act(id, T.staff2, { action: 'resolve' })).status).toBe(422);
    const r = await act(id, T.staff2, { action: 'resolve', description: 'トーチを交換した' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: 'closed' });
    const d = await get(`/abnormalities/${id}`, T.manager);
    expect(d.body.abnormality.status).toBe('closed');
    expect(d.body.actions[0]).toMatchObject({ description: 'トーチを交換した', performed_by_name: '鈴木 大地' });
    expect(d.body.events.map((e: { to_status: string }) => e.to_status)).toEqual(['reported', 'closed']);
    expect(await auditCount('abnormality.resolve', id)).toBe(1);
    // 完了したものはもう押せない
    expect((await act(id, T.manager, { action: 'resolve', description: 'x' })).status).toBe(409);
  });

  it('直した本人は、その是正処置に完了の直後でも写真を付けられる（ほかの人・異常の本体には付けられない）', async () => {
    const { body: { id } } = await report(T.worker, { equipment_id: 'eq-w01', title: 'カバーの割れ' });
    const r = await act(id, T.manager, { action: 'resolve', description: 'カバーを交換' });
    const send = (token: string, type: string, owner: string) => app.request(`/api/attachments?owner_type=${type}&owner_id=${owner}`, {
      method: 'POST', body: JPEG, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'image/jpeg', 'Content-Length': String(JPEG.byteLength) },
    }, env);
    expect((await send(T.manager, 'corrective_action', r.body.correctiveActionId)).status).toBe(201);
    expect((await send(T.admin, 'corrective_action', r.body.correctiveActionId)).status).toBe(409);
    expect((await send(T.manager, 'abnormality', id)).status).toBe(409);
  });

  it('止めていた設備は、直したときに動かせる', async () => {
    const { body } = await report(T.staff, { equipment_id: 'eq-p02', title: '異音', severity: 'high', equipment_stopped: true });
    expect(body.equipmentStatusChanged).toBe(true);
    await act(body.id, T.staff, { action: 'resolve', description: 'ベアリング交換', resume_equipment: true });
    expect((await get('/equipment/eq-p02', T.staff)).body.item.status).toBe('active');
  });
});

describe('是正処置の流れ（T-09）', () => {
  it('発生 → 担当・期限 → 対応中 → 是正完了 → 再確認 → 承認。すべて履歴に残る', async () => {
    const { body: { id } } = await report(T.worker, { equipment_id: 'eq-p02', title: '油圧ホースのにじみ' });

    // 担当・期限: 一般社員は不可、担当設備の設備担当者は可。担当にできるのは工場の設備担当・工場長だけ
    expect((await act(id, T.worker, { action: 'assign', assignee_user_id: 'usr-suzuki', due_date: tomorrow })).status).toBe(403);
    expect((await act(id, T.staff, { action: 'assign', assignee_user_id: 'usr-yamamoto', due_date: tomorrow })).status).toBe(422);
    expect((await act(id, T.staff, { action: 'assign', assignee_user_id: 'usr-suzuki', due_date: tomorrow })).status).toBe(200);

    // 着手は担当者（または工場長）。担当でない設備担当者は不可
    expect((await act(id, T.staff, { action: 'start' })).status).toBe(403);
    expect((await act(id, T.staff2, { action: 'start' })).status).toBe(200);

    // 飛ばした遷移は 409
    expect((await act(id, T.manager, { action: 'approve' })).status).toBe(409);

    expect((await act(id, T.staff2, { action: 'correct', corrected_date: tomorrow })).status).toBe(422);
    expect((await act(id, T.staff2, { action: 'correct', description: 'ホースを交換', cause: '経年劣化', corrected_date: tomorrow })).status).toBe(200);

    // 自分で直したものは自分で再確認できない
    const self = await act(id, T.staff2, { action: 'verify' });
    expect(self.status).toBe(403);
    expect(self.body.message).toContain('別の人');
    expect((await act(id, T.manager, { action: 'verify', comment: '漏れなし' })).status).toBe(200);

    // 承認は工場長だけ（システム管理者も不可）
    expect((await act(id, T.staff, { action: 'approve' })).status).toBe(403);
    expect((await act(id, T.admin, { action: 'approve' })).status).toBe(403);
    expect((await act(id, T.manager, { action: 'approve' })).status).toBe(200);

    const d = await get(`/abnormalities/${id}`, T.manager);
    expect(d.body.abnormality).toMatchObject({ status: 'closed', assignee_name: '鈴木 大地', verified_by_name: '中村 誠', approved_by_name: '中村 誠' });
    expect(d.body.events.map((e: { to_status: string }) => e.to_status)).toEqual(['reported', 'assigned', 'in_progress', 'corrected', 'verified', 'closed']);
    expect(d.body.actions[0]).toMatchObject({ description: 'ホースを交換', cause: '経年劣化', performed_by_name: '鈴木 大地' });
    expect(Object.values(d.body.permissions).filter((x) => x === true)).toEqual([]);
  });

  it('再確認で直っていなければ、理由をつけて対応中に差し戻せる', async () => {
    const { body: { id } } = await report(T.worker, { equipment_id: 'eq-p02', title: '差し戻しテスト' });
    await act(id, T.manager, { action: 'assign', assignee_user_id: 'usr-sato', due_date: tomorrow });
    await act(id, T.staff, { action: 'start' });
    await act(id, T.staff, { action: 'correct', description: '締め直した', corrected_date: tomorrow });
    expect((await act(id, T.manager, { action: 'reject' })).status).toBe(422);
    const r = await act(id, T.manager, { action: 'reject', comment: 'まだにじんでいる' });
    expect(r.body.status).toBe('in_progress');
  });

  it('承認と同時に、異常で止めていた設備を稼働に戻せる', async () => {
    const { body: { id } } = await report(T.staff, { equipment_id: 'eq-cr1', severity: 'high', equipment_stopped: true, title: 'ワイヤーの素線切れ' });
    expect((await get('/equipment/eq-cr1', T.staff)).body.item.status).toBe('stopped');
    await act(id, T.manager, { action: 'assign', assignee_user_id: 'usr-sato', due_date: tomorrow });
    await act(id, T.staff, { action: 'start' });
    await act(id, T.staff, { action: 'correct', description: 'ワイヤーを交換', corrected_date: tomorrow });
    await act(id, T.manager, { action: 'verify' });
    expect((await act(id, T.manager, { action: 'approve', resume_equipment: true })).status).toBe(200);
    expect((await get('/equipment/eq-cr1', T.staff)).body.item.status).toBe('active');
  });

  it('古い画面からの操作は 409', async () => {
    const { body: { id } } = await report(T.worker, { equipment_id: 'eq-p02', title: '同時操作' });
    const v = await version('abnormalities', id);
    expect((await post(`/abnormalities/${id}/transition`, T.manager, { version: v, action: 'assign', assignee_user_id: 'usr-sato', due_date: tomorrow })).status).toBe(200);
    expect((await post(`/abnormalities/${id}/transition`, T.manager, { version: v, action: 'assign', assignee_user_id: 'usr-suzuki', due_date: tomorrow })).status).toBe(409);
  });
});

describe('一覧と件数', () => {
  it('期限超過・未対応で絞り込める。他社からは見えない', async () => {
    const overdue = await get('/abnormalities?view=overdue', T.manager);
    expect(overdue.body.items.some((a: { report_no: string; overdue: boolean }) => a.report_no === 'F01-0002' && a.overdue)).toBe(true);
    const unhandled = await get('/abnormalities?view=unhandled', T.manager);
    expect(unhandled.body.items.every((a: { status: string }) => ['reported', 'assigned'].includes(a.status))).toBe(true);
    expect((await get('/abnormalities?view=all', T.other)).body.items.length).toBe(0);
    const sum = await get('/abnormalities/summary', T.staff2);
    expect(sum.body.overdue).toBeGreaterThanOrEqual(1);
    expect(sum.body.mine).toBeGreaterThanOrEqual(1);
  });
});

describe('写真（T-12）', () => {
  it('JPEG を追加でき、権限のある人だけが取得できる', async () => {
    const { body: { id } } = await report(T.worker, { equipment_id: 'eq-w01', title: '写真テスト' });
    const up = await upload(T.worker, id, JPEG);
    expect(up.status).toBe(201);
    const res = await app.request(`/api/attachments/${up.body.id}`, { headers: { Authorization: `Bearer ${T.manager}` } }, env);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/jpeg');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(JPEG);
    expect((await app.request(`/api/attachments/${up.body.id}`, { headers: { Authorization: `Bearer ${T.other}` } }, env)).status).toBe(404);
    const row = await env.DB.prepare('SELECT original_name, sha256 FROM attachments WHERE id = ?').bind(up.body.id).first<{ original_name: string; sha256: string }>();
    expect(row?.original_name).toBe('写真.jpg');
    expect(row?.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('中身が画像でないもの・SVG・大きすぎるものは拒否', async () => {
    const { body: { id } } = await report(T.worker, { equipment_id: 'eq-w01', title: '拒否テスト' });
    expect((await upload(T.worker, id, new TextEncoder().encode('<script>alert(1)</script>'))).status).toBe(415);
    expect((await upload(T.worker, id, new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'image/svg+xml')).status).toBe(415);
    expect((await upload(T.worker, id, JPEG, 'image/jpeg', 11 * 1024 * 1024)).status).toBe(413);
  });

  it('枚数の上限を超えると 409。削除は追加した本人だけ', async () => {
    const { body: { id } } = await report(T.worker, { equipment_id: 'eq-w01', title: '枚数テスト' });
    let last = '';
    for (let i = 0; i < 10; i++) last = (await upload(T.worker, id, JPEG)).body.id;
    expect((await upload(T.worker, id, JPEG)).status).toBe(409);
    expect((await del(`/attachments/${last}`, T.manager)).status).toBe(403);
    expect((await del(`/attachments/${last}`, T.worker)).status).toBe(204);
    expect((await upload(T.worker, id, JPEG)).status).toBe(201);
  });
});
