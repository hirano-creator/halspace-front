import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearSpaceCache } from '../src/middleware/auth';
import { T, del, get, post } from './helpers';

afterEach(() => { vi.unstubAllGlobals(); clearSpaceCache(); });

/** halspace-api /auth/me の応答を差し替える */
function stubSpace(user: Record<string, unknown> | null, status = 200) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(user ? { user } : { message: 'x' }), { status, headers: { 'Content-Type': 'application/json' } })));
}

describe('ログイン（T-01）', () => {
  it('トークンなしは 401', async () => {
    expect((await get('/me')).status).toBe(401);
  });

  it('開発用の簡易ログインは dev 環境の設定でだけ有効', async () => {
    expect((await get('/me', T.worker)).status).toBe(200);
    const prod = await import('./helpers').then((h) => h.call('GET', '/me', T.worker, undefined, { APP_ENV: 'production' }));
    expect(prod.status).toBe(401);
    const off = await import('./helpers').then((h) => h.call('GET', '/me', T.worker, undefined, { DEV_AUTH_STUB: undefined }));
    expect(off.status).toBe(401);
  });

  it('利用停止中は 403', async () => {
    expect((await get('/me', T.suspended)).status).toBe(403);
  });

  it('ロール未設定はログインできるが、設備は見られない', async () => {
    const me = await get('/me', T.norole);
    expect(me.status).toBe(200);
    expect(me.body.user.role).toBeNull();
    expect((await get('/equipment', T.norole)).status).toBe(403);
  });

  it('/me は所属工場と設定を返す', async () => {
    const me = await get('/me', T.worker);
    expect(me.body.user).toMatchObject({ name: '山本 健', role: 'worker', roleLabel: '一般社員' });
    expect(me.body.factories.map((f: { code: string }) => f.code)).toEqual(['F01']);
    expect(me.body.settings.qr_base_url).toBe('https://space-apps.pages.dev/TENQ/q/');
    const admin = await get('/me', T.admin);
    expect(admin.body.factories.map((f: { code: string }) => f.code)).toEqual(['F01', 'F02']);
  });
});

describe('Space.app のトークン', () => {
  it('TENQ が有効なら初回アクセスで利用者が作られ、会社の最初の管理者は system_admin になる', async () => {
    stubSpace({ id: 700001, name: '新会社 管理者', email: 'a@new.test', role: 'admin', company_id: 77, apps_enabled: ['tenq'] });
    const me = await get('/me', 'space-token-a');
    expect(me.status).toBe(200);
    expect(me.body.user.role).toBe('system_admin');
    expect(me.body.via).toBe('space');

    clearSpaceCache();
    stubSpace({ id: 700002, name: '新会社 二人目', email: 'b@new.test', role: 'admin', company_id: 77, apps_enabled: ['tenq'] });
    const second = await get('/me', 'space-token-b');
    expect(second.body.user.role).toBeNull();
  });

  it('TENQ が有効でないアカウントは 403', async () => {
    stubSpace({ id: 700003, name: 'x', email: null, role: 'general', company_id: 77, apps_enabled: ['solid'] });
    expect((await get('/me', 'space-token-c')).status).toBe(403);
  });

  it('Space.app が 401 なら 401、つながらなければ 502', async () => {
    stubSpace(null, 401);
    expect((await get('/me', 'space-token-d')).status).toBe(401);
    clearSpaceCache();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network'); }));
    expect((await get('/me', 'space-token-e')).status).toBe(502);
  });

  it('同じトークンは 60 秒キャッシュし、Space.app に何度も問い合わせない', async () => {
    stubSpace({ id: 700001, name: '新会社 管理者', email: 'a@new.test', role: 'admin', company_id: 77, apps_enabled: ['tenq'] });
    await get('/me', 'space-token-f');
    await get('/me', 'space-token-f');
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });
});

describe('端末のログイン記憶（T-18）', () => {
  it('発行 → そのトークンで利用 → ログアウトで無効', async () => {
    const issued = await post('/auth/device', T.staff2, {});
    expect(issued.status).toBe(201);
    const token: string = issued.body.token;
    expect(token.startsWith('tq_')).toBe(true);

    // D1 にはトークン本体ではなくハッシュだけが残る
    const plain = await env.DB.prepare('SELECT COUNT(*) AS n FROM device_sessions WHERE token_hash = ?').bind(token).first<{ n: number }>();
    expect(plain?.n).toBe(0);

    const me = await get('/me', token);
    expect(me.status).toBe(200);
    expect(me.body.via).toBe('device');

    // 端末記憶のトークンから、さらに記憶トークンを増やすことはできない
    expect((await post('/auth/device', token, {})).status).toBe(403);

    expect((await del('/auth/device', token)).status).toBe(204);
    expect((await get('/me', token)).status).toBe(401);
  });

  it('期限切れは 401', async () => {
    const issued = await post('/auth/device', T.staff2, {});
    await env.DB.prepare("UPDATE device_sessions SET expires_at = '2000-01-01T00:00:00.000Z' WHERE user_id = 'usr-suzuki' AND revoked_at IS NULL").run();
    expect((await get('/me', issued.body.token)).status).toBe(401);
  });

  it('自分の端末一覧と取り消し。他人の端末は取り消せない', async () => {
    const issued = await post('/auth/device', T.worker, { label: '山本のiPhone' });
    const list = await get('/auth/devices', T.worker);
    const mine = list.body.items.find((d: { device_label: string }) => d.device_label === '山本のiPhone');
    expect(mine).toBeTruthy();
    expect((await del(`/auth/devices/${mine.id}`, T.staff)).status).toBe(404);
    expect((await del(`/auth/devices/${mine.id}`, T.worker)).status).toBe(204);
    expect((await get('/me', issued.body.token)).status).toBe(401);
  });
});
