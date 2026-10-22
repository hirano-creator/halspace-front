import { Hono } from 'hono';
import { ROLE_LABELS, can } from '@tenq/shared';
import type { AppEnv } from '../types';
import { auditStatement } from '../lib/audit';
import { newDeviceToken, newId, nowIso, sha256Hex } from '../lib/crypto';
import { HttpError, Validator, readJson } from '../lib/http';
import { loadSettings } from '../lib/settings';

export const authRoutes = new Hono<AppEnv>();

/** ログイン中の利用者・所属工場・画面で使う設定 */
authRoutes.get('/me', async (c) => {
  const { user, actor, via } = c.get('auth');
  const settings = await loadSettings(c.env.DB, user.company_id);
  const ids = actor.factoryIds;
  const factories = ids.length
    ? (await c.env.DB.prepare(`SELECT id, code, name, timezone FROM factories WHERE company_id = ? AND id IN (${ids.map(() => '?').join(',')}) ORDER BY code`)
        .bind(user.company_id, ...ids).all()).results
    : [];
  return c.json({
    user: { id: user.id, name: user.name, email: user.email, role: user.role, roleLabel: user.role ? ROLE_LABELS[user.role] : null },
    factories,
    via,
    settings: {
      qr_base_url: settings.qr_base_url,
      device_login_days: settings.device_login_days,
      board_refresh_seconds: settings.board_refresh_seconds,
      reauth_hours: settings.reauth_hours,
      photo_max_count: settings.photo_max_count,
      high_severity_message: settings.high_severity_message,
    },
  });
});

/**
 * この端末にログインを記憶する（security.md §2-1）。
 * Space.app でログインした直後にだけ発行できる（端末記憶トークンから別のトークンを増やせない）。
 */
authRoutes.post('/auth/device', async (c) => {
  const auth = c.get('auth');
  if (auth.via === 'device') throw new HttpError(403, 'ログインし直してから設定してください。');
  const v = new Validator(await readJson(c.req.raw));
  const label = v.str('label', { max: 80, label: '端末名' });
  v.done();

  const settings = await loadSettings(c.env.DB, auth.companyId);
  const token = newDeviceToken();
  const id = newId();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + settings.device_login_days * 86_400_000).toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO device_sessions (id, user_id, company_id, token_hash, device_label, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(id, auth.user.id, auth.companyId, await sha256Hex(token), label ?? deviceLabel(c.req.header('User-Agent')), now.toISOString(), expiresAt),
    auditStatement(c, { action: 'device.remember', targetType: 'device_session', targetId: id, detail: { days: settings.device_login_days } }),
  ]);
  return c.json({ token, expiresAt }, 201);
});

/** ログアウト（端末記憶で入っている場合は、その記憶を取り消す） */
authRoutes.delete('/auth/device', async (c) => {
  const auth = c.get('auth');
  if (auth.via === 'device' && auth.deviceSessionId) {
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE device_sessions SET revoked_at = ?, revoked_by = ?, revoke_reason = 'logout' WHERE id = ? AND revoked_at IS NULL")
        .bind(nowIso(), auth.user.id, auth.deviceSessionId),
      auditStatement(c, { action: 'device.logout', targetType: 'device_session', targetId: auth.deviceSessionId }),
    ]);
  }
  return c.body(null, 204);
});

/** 自分の端末記憶の一覧 */
authRoutes.get('/auth/devices', async (c) => {
  const auth = c.get('auth');
  const { results } = await c.env.DB.prepare(
    'SELECT id, device_label, created_at, expires_at, last_used_at FROM device_sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY created_at DESC',
  ).bind(auth.user.id, nowIso()).all();
  return c.json({ items: results.map((r) => ({ ...r, current: r.id === auth.deviceSessionId })) });
});

/** 自分の端末記憶を取り消す（紛失時など） */
authRoutes.delete('/auth/devices/:id', async (c) => {
  const auth = c.get('auth');
  const id = c.req.param('id');
  const row = await c.env.DB.prepare('SELECT user_id FROM device_sessions WHERE id = ? AND company_id = ?').bind(id, auth.companyId).first<{ user_id: string }>();
  if (!row || !can(auth.actor, 'device.revoke', { deviceOwnerId: row.user_id })) throw new HttpError(404, '見つかりません。');
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE device_sessions SET revoked_at = ?, revoked_by = ?, revoke_reason = 'revoked_by_user' WHERE id = ? AND revoked_at IS NULL").bind(nowIso(), auth.user.id, id),
    auditStatement(c, { action: 'device.revoke', targetType: 'device_session', targetId: id }),
  ]);
  return c.body(null, 204);
});

function deviceLabel(ua = ''): string {
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'Mac' : '端末';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /Firefox\//.test(ua) ? 'Firefox' : 'ブラウザ';
  return `${os} / ${browser}`;
}
