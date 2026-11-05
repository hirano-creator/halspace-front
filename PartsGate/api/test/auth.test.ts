import { describe, expect, it } from 'vitest';
import { T, get } from './helpers';
import { assertScoped } from '../src/lib/db';

describe('ログイン確認', () => {
  it('トークンがなければ 401', async () => {
    expect((await get('/me')).status).toBe(401);
  });

  it('存在しない簡易ログインは 401', async () => {
    expect((await get('/me', 'dev-123456')).status).toBe(401);
  });

  it('/me は自分の会社と設定を返す（会社はログイン情報から決まる）', async () => {
    const r = await get('/me', T.generalA);
    expect(r.status).toBe(200);
    expect(r.body.company).toMatchObject({ id: 1, code: 'dev-a' });
    expect(r.body.user).toMatchObject({ name: '出荷場PC1', role: 'general', roleLabel: '一般' });
    expect(r.body.operator).toBe(false);
    expect(r.body.settings).toMatchObject({ match_field: 'barcode_global_no', scans_per_item: 'one' });
  });

  it('URL や本文で会社を指定しても無視する', async () => {
    const r = await get('/me?company_id=2', T.generalA);
    expect(r.body.company.id).toBe(1);
  });

  it('利用停止中の利用者は 403', async () => {
    expect((await get('/me', T.suspendedA)).status).toBe(403);
  });

  it('停止中の会社の利用者は 403', async () => {
    const r = await get('/me', T.adminC);
    expect(r.status).toBe(403);
    expect(r.body.message).toContain('停止');
  });

  it('CORS: 画面のオリジンには、取込で使うヘッダーも許可する', async () => {
    const { env } = await import('cloudflare:workers');
    const { app } = await import('../src/index');
    const res = await app.request('/api/imports', {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:5174', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type,x-file-name,x-file-sha256,x-encoding' },
    }, env);
    const allowed = (res.headers.get('Access-Control-Allow-Headers') ?? '').toLowerCase();
    for (const h of ['authorization', 'x-file-name', 'x-file-sha256', 'x-encoding']) expect(allowed).toContain(h);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5174');
    // 許可していないオリジンには返さない
    const other = await app.request('/api/me', { method: 'OPTIONS', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'GET' } }, env);
    expect(other.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('health はログインなしで DB の状態を返す', async () => {
    const r = await get('/health');
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
  });
});

describe('会社で絞った SQL の検査（lib/db.ts）', () => {
  it('?1 と company_id がない SQL は実行前に止める', () => {
    expect(() => assertScoped('SELECT * FROM staff WHERE id = ?1')).toThrow();
    expect(() => assertScoped('SELECT * FROM staff WHERE company_id = ?')).toThrow();
    expect(() => assertScoped('SELECT * FROM staff WHERE company_id = ?10')).toThrow();
    expect(() => assertScoped('SELECT * FROM staff WHERE company_id = ?1 AND id = ?2')).not.toThrow();
  });
});
