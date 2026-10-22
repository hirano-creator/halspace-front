import { Hono, type Context } from 'hono';
import type { AppEnv } from '../types';
import { auditStatement } from '../lib/audit';
import { newId, nowIso } from '../lib/crypto';
import { authorize } from '../lib/guard';
import { HttpError, notFound } from '../lib/http';
import { scopeWhere } from '../lib/scope';
import { loadSettings } from '../lib/settings';

/**
 * 写真（docs/security.md §5）。実体は非公開の R2、配信は権限を確かめてからこの API で返す。
 *  - JPEG / PNG / WebP だけ。Content-Type とファイル先頭のマジックナンバーの両方を見る（SVG・HEIC・PDF は拒否）
 *  - 1 枚 10 MB まで（画面で長辺 2048px に縮めてから送るので、ふつうは 1 MB 以下）
 *  - 1 件あたりの枚数は system_settings.photo_max_count まで
 */
export const attachmentRoutes = new Hono<AppEnv>();

const MAX_BYTES = 10 * 1024 * 1024;
const TYPES: Record<string, { ext: string; magic: (b: Uint8Array) => boolean }> = {
  'image/jpeg': { ext: 'jpg', magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/png': { ext: 'png', magic: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  'image/webp': { ext: 'webp', magic: (b) => String.fromCharCode(...b.slice(0, 4)) === 'RIFF' && String.fromCharCode(...b.slice(8, 12)) === 'WEBP' },
};

/** 写真を付ける先（異常、またはその是正処置）が範囲内か。返すのは異常の情報 */
async function ownerAbnormality(c: Context<AppEnv>, ownerType: string, ownerId: string) {
  const s = scopeWhere(c.get('auth'), 'a');
  const sql = ownerType === 'abnormality'
    ? `SELECT a.id, a.factory_id, a.status, a.report_no FROM abnormalities a WHERE a.id = ? AND ${s.sql}`
    : `SELECT a.id, a.factory_id, a.status, a.report_no FROM corrective_actions ca JOIN abnormalities a ON a.id = ca.abnormality_id WHERE ca.id = ? AND ${s.sql}`;
  const row = await c.env.DB.prepare(sql).bind(ownerId, ...s.params).first<{ id: string; factory_id: string; status: string; report_no: string }>();
  if (!row) throw notFound();
  return row;
}

/** 写真の追加。本体は画像そのもの（multipart ではない）。?owner_type=abnormality|corrective_action&owner_id=… */
attachmentRoutes.post('/attachments', async (c) => {
  const auth = c.get('auth');
  const ownerType = c.req.query('owner_type') ?? '';
  const ownerId = c.req.query('owner_id') ?? '';
  if (!['abnormality', 'corrective_action'].includes(ownerType) || !ownerId) throw new HttpError(400, '写真を付ける先を指定してください。');
  const owner = await ownerAbnormality(c, ownerType, ownerId);
  authorize(c, 'abnormality.report', { factoryId: owner.factory_id });
  if (owner.status === 'closed') throw new HttpError(409, '完了した異常には写真を追加できません。');

  const type = (c.req.header('Content-Type') ?? '').split(';')[0]!.trim().toLowerCase();
  const spec = TYPES[type];
  if (!spec) throw new HttpError(415, '写真は JPEG・PNG・WebP にしてください。');
  // 本体を読む前に大きさを確かめる（大きすぎるものはメモリに載せない）
  const declared = Number(c.req.header('Content-Length') ?? NaN);
  if (!Number.isFinite(declared)) throw new HttpError(400, 'Content-Length を指定してください。');
  if (declared > MAX_BYTES) throw new HttpError(413, '写真が大きすぎます（10MB まで）。');
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) throw new HttpError(413, '写真が大きすぎるか、空です（10MB まで）。');
  if (!spec.magic(bytes)) throw new HttpError(415, '写真の中身が形式と一致しません。JPEG・PNG・WebP の写真を選んでください。');

  const settings = await loadSettings(c.env.DB, auth.companyId);
  const count = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM attachments WHERE deleted_at IS NULL AND
      ((owner_type = 'abnormality' AND owner_id = ?) OR (owner_type = 'corrective_action' AND owner_id IN (SELECT id FROM corrective_actions WHERE abnormality_id = ?)))`)
    .bind(owner.id, owner.id).first<{ n: number }>();
  if ((count?.n ?? 0) >= settings.photo_max_count) throw new HttpError(409, `写真は1件あたり ${settings.photo_max_count} 枚までです。`);

  const id = newId();
  const now = nowIso();
  const key = `company/${auth.companyId}/${now.slice(0, 4)}/${id}.${spec.ext}`;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const sha256 = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  const name = (c.req.header('X-File-Name') ?? '').slice(0, 120) || null;

  await c.env.FILES.put(key, bytes, { httpMetadata: { contentType: type }, customMetadata: { attachmentId: id } });
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(`INSERT INTO attachments (id, company_id, owner_type, owner_id, r2_key, content_type, size_bytes, sha256, original_name, uploaded_by, uploaded_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(id, auth.companyId, ownerType, ownerId, key, type, bytes.byteLength, sha256, name ? decodeURIComponent(name) : null, auth.user.id, now),
      auditStatement(c, { action: 'attachment.upload', targetType: 'abnormality', targetId: owner.id, factoryId: owner.factory_id, detail: { attachment: id, bytes: bytes.byteLength, type } }),
    ]);
  } catch (e) {
    await c.env.FILES.delete(key); // 記録できなかった実体は残さない
    throw e;
  }
  return c.json({ id }, 201);
});

/** 写真の取得（権限を確かめてから R2 から返す。公開 URL は作らない） */
attachmentRoutes.get('/attachments/:id', async (c) => {
  const auth = c.get('auth');
  const a = await c.env.DB.prepare('SELECT * FROM attachments WHERE id = ? AND company_id = ? AND deleted_at IS NULL')
    .bind(c.req.param('id'), auth.companyId).first<{ owner_type: string; owner_id: string; r2_key: string; content_type: string }>();
  if (!a) throw notFound();
  const owner = await ownerAbnormality(c, a.owner_type, a.owner_id);
  authorize(c, 'abnormality.report', { factoryId: owner.factory_id });
  const obj = await c.env.FILES.get(a.r2_key);
  if (!obj) throw notFound('写真の実体が見つかりません。');
  return new Response(obj.body, {
    headers: {
      'Content-Type': a.content_type,
      'Content-Disposition': 'inline',
      'Cache-Control': 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});

/** 写真の削除（追加した本人だけ、完了前）。記録は論理削除、実体は保存期間後に消す */
attachmentRoutes.delete('/attachments/:id', async (c) => {
  const auth = c.get('auth');
  const a = await c.env.DB.prepare('SELECT * FROM attachments WHERE id = ? AND company_id = ? AND deleted_at IS NULL')
    .bind(c.req.param('id'), auth.companyId).first<{ id: string; owner_type: string; owner_id: string; uploaded_by: string }>();
  if (!a) throw notFound();
  const owner = await ownerAbnormality(c, a.owner_type, a.owner_id);
  if (a.uploaded_by !== auth.user.id || owner.status === 'closed') throw new HttpError(403, '削除できるのは、追加した本人だけです（完了前）。');
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE attachments SET deleted_at = ?, deleted_by = ? WHERE id = ? AND deleted_at IS NULL').bind(nowIso(), auth.user.id, a.id),
    auditStatement(c, { action: 'attachment.delete', targetType: 'abnormality', targetId: owner.id, factoryId: owner.factory_id, detail: { attachment: a.id } }),
  ]);
  return c.body(null, 204);
});
