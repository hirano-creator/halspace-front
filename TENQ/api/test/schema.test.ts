import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import app from '../src/index';

const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();
const db = () => env.DB;

/** 例外になること（制約・トリガーで拒否されること）を確かめる */
async function rejects(sql: string, ...params: unknown[]) {
  await expect(db().prepare(sql).bind(...params).run()).rejects.toThrow();
}

describe('API の起動', () => {
  it('/api/health がローカル D1 を読める', async () => {
    const res = await app.request('/api/health', {}, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, env: 'dev', factories: 3 });
  });

  it('セキュリティヘッダーが付く', async () => {
    const res = await app.request('/api/health', {}, env);
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('許可していないオリジンには CORS を返さない', async () => {
    const ok = await app.request('/api/health', { headers: { Origin: 'http://localhost:5173' } }, env);
    expect(ok.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
    const ng = await app.request('/api/health', { headers: { Origin: 'https://evil.example' } }, env);
    expect(ng.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('存在しないパスは、未ログインなら 401（存在を知らせない）、ログイン済みなら JSON の 404', async () => {
    expect((await app.request('/api/nothing', {}, env)).status).toBe(401);
    const res = await app.request('/api/nothing', { headers: { Authorization: 'Bearer dev-900001' } }, env);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ message: '見つかりません。' });
  });
});

describe('ダミーデータ', () => {
  it('件数が想定どおり', async () => {
    const count = async (t: string) => (await db().prepare(`SELECT COUNT(*) AS n FROM ${t}`).first<{ n: number }>())?.n;
    expect(await count('equipment')).toBe(18);
    expect(await count('areas')).toBe(4);
    expect(await count('abnormalities')).toBe(3);
  });

  it('今日の点検は日本時間の日付で入っている', async () => {
    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date());
    const row = await db().prepare("SELECT inspection_date FROM inspections WHERE id = 'ins-p01'").first<{ inspection_date: string }>();
    expect(row?.inspection_date).toBe(today);
  });
});

describe('データベースの整合性（T-14）', () => {
  it('外部キー違反は拒否される', async () => {
    await rejects(
      `INSERT INTO equipment (id, company_id, factory_id, equipment_code, name, created_at, updated_at) VALUES (?, 1, 'no-such-factory', 'Z-1', 'x', ?, ?)`,
      id(), now(), now());
  });

  it('列挙値以外は拒否される', async () => {
    await rejects(`UPDATE equipment SET status = 'broken' WHERE id = 'eq-p01'`);
  });

  it('QR トークンは 16 文字で、設備ごとに有効なものは1つ', async () => {
    await rejects(`INSERT INTO equipment_qr_tokens (token, equipment_id, company_id, issued_at) VALUES ('SHORT', 'eq-p01', 1, ?)`, now());
    await rejects(`INSERT INTO equipment_qr_tokens (token, equipment_id, company_id, issued_at) VALUES ('TENQTESTDUPLICAT', 'eq-p01', 1, ?)`, now());
  });

  it('完了には完了日時と総合判定が必要', async () => {
    await rejects(`UPDATE inspections SET status = 'completed' WHERE id = 'ins-p03'`);
  });
});

describe('二重登録の防止（T-07）', () => {
  const insert = (inspId: string, status: string, equipmentId = 'eq-w02') =>
    db().prepare(`INSERT INTO inspections (id, company_id, factory_id, equipment_id, template_version_id, period_key, inspection_date, status, inspector_user_id, started_at, voided_reason, created_at, updated_at)
      VALUES (?, 1, 'fac-1a', ?, 'tv-weld-1', '2099-01-01', '2099-01-01', ?, 'usr-yamamoto', ?, ?, ?, ?)`)
      .bind(inspId, equipmentId, status, now(), status === 'voided' ? 'テスト' : null, now(), now()).run();

  it('同じ設備・同じ期間の有効な点検は1件だけ', async () => {
    await insert(id(), 'in_progress');
    await expect(insert(id(), 'in_progress')).rejects.toThrow();
  });

  it('取り消し（voided）は何件あってもよい', async () => {
    await insert(id(), 'voided', 'eq-w03');
    await insert(id(), 'voided', 'eq-w03');
    await insert(id(), 'in_progress', 'eq-w03');
  });

  it('完了の冪等キーは重複できない', async () => {
    await db().prepare(`UPDATE inspections SET completion_key = 'key-1' WHERE id = 'ins-p01'`).run();
    await rejects(`UPDATE inspections SET completion_key = 'key-1' WHERE id = 'ins-p02'`);
  });
});

describe('記録を書き換えさせない（T-10）', () => {
  it('監査ログは更新・削除できない', async () => {
    await rejects(`UPDATE audit_logs SET action = 'x'`);
    await rejects(`DELETE FROM audit_logs`);
  });

  it('点検結果は更新・削除できない（訂正は版を追加）', async () => {
    await rejects(`UPDATE inspection_results SET judgment = 'ok' WHERE id = 'res-ins-l07-ng'`);
    await rejects(`DELETE FROM inspection_results WHERE id = 'res-ins-l07-ng'`);
    await db().prepare(`INSERT INTO inspection_results (id, inspection_id, revision, item_id, judgment, created_at, created_by)
      VALUES (?, 'ins-l07', 2, 'it-cut2-2', 'ok', ?, 'usr-nakamura')`).bind(id(), now()).run();
  });

  it('訂正履歴は理由が必須で、書き換えできない', async () => {
    await rejects(`INSERT INTO inspection_corrections (id, inspection_id, from_revision, to_revision, reason, diff_json, corrected_by, corrected_at)
      VALUES (?, 'ins-l07', 1, 2, '  ', '{}', 'usr-nakamura', ?)`, id(), now());
    const cid = id();
    await db().prepare(`INSERT INTO inspection_corrections (id, inspection_id, from_revision, to_revision, reason, diff_json, corrected_by, corrected_at)
      VALUES (?, 'ins-l07', 1, 2, '押し間違い', '{"it-cut2-2":["ng","ok"]}', 'usr-nakamura', ?)`).bind(cid, now()).run();
    await rejects(`UPDATE inspection_corrections SET reason = 'x' WHERE id = ?`, cid);
  });

  it('異常の状態遷移履歴は書き換えできない', async () => {
    await rejects(`UPDATE abnormality_events SET comment = 'x' WHERE id = 'ev-1'`);
    await rejects(`DELETE FROM abnormality_events WHERE id = 'ev-1'`);
  });

  it('点検は削除できず、完了を点検中に戻せない', async () => {
    await rejects(`DELETE FROM inspections WHERE id = 'ins-p01'`);
    await rejects(`UPDATE inspections SET status = 'in_progress' WHERE id = 'ins-p01'`);
  });

  it('公開済みの版の点検項目は変えられない（下書きの版なら変えられる）', async () => {
    await rejects(`UPDATE inspection_items SET label = 'x' WHERE id = 'it-press-1'`);
    await rejects(`DELETE FROM inspection_items WHERE id = 'it-press-1'`);
    await rejects(`INSERT INTO inspection_items (id, template_version_id, sort_order, label) VALUES (?, 'tv-press-1', 9, 'x')`, id());
    const vid = id();
    await db().prepare(`INSERT INTO inspection_template_versions (id, template_id, version_no, status, change_reason, created_at) VALUES (?, 'tpl-press', 2, 'draft', '項目追加', ?)`).bind(vid, now()).run();
    await db().prepare(`INSERT INTO inspection_items (id, template_version_id, sort_order, label) VALUES (?, ?, 1, '追加項目')`).bind(id(), vid).run();
  });
});
