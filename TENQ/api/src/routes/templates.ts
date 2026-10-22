import { Hono, type Context } from 'hono';
import type { AppEnv } from '../types';
import { auditStatement } from '../lib/audit';
import { newId, nowIso } from '../lib/crypto';
import { authorize } from '../lib/guard';
import { HttpError, Validator, conflict, notFound, readJson } from '../lib/http';

/**
 * 点検基準（テンプレート）と版（requirements F-9、database.md 3-6〜3-8）。
 * 公開した版は変えない。変更は「下書きの版」を作って公開すると新しい版になり、過去の点検は当時の版のまま残る。
 */
export const templateRoutes = new Hono<AppEnv>();

interface TemplateRow { id: string; company_id: number; factory_id: string | null; name: string; description: string | null; current_version_id: string | null; status: string; version: number }
interface ItemInput { label: string; criteria: string | null; group_label: string | null; required: number; allow_na: number }

async function loadTemplate(c: Context<AppEnv>, id: string): Promise<TemplateRow> {
  const auth = c.get('auth');
  const t = await c.env.DB.prepare('SELECT * FROM inspection_templates WHERE id = ? AND company_id = ?').bind(id, auth.companyId).first<TemplateRow>();
  // 工場専用の点検基準は、その工場の人にだけ見せる
  if (!t || (t.factory_id && auth.actor.role !== 'system_admin' && !auth.actor.factoryIds.includes(t.factory_id))) throw notFound();
  return t;
}

/** 点検項目の入力（1〜100 項目） */
function readItems(v: Validator, body: Record<string, unknown>): ItemInput[] {
  const raw = body.items;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 100) {
    v.fail('items', '点検項目は1〜100項目で入力してください。');
    return [];
  }
  return raw.map((x, i) => {
    const iv = new Validator((x && typeof x === 'object' ? x : {}) as Record<string, unknown>);
    const item = {
      label: iv.str('label', { required: true, max: 100, label: '項目名' }) ?? '',
      criteria: iv.str('criteria', { max: 300, label: '判定基準' }) ?? null,
      group_label: iv.str('group_label', { max: 40, label: '区分' }) ?? null,
      required: (x as { required?: unknown }).required === false ? 0 : 1,
      allow_na: (x as { allow_na?: unknown }).allow_na === true ? 1 : 0,
    };
    try { iv.done(); } catch (e) { v.fail(`items.${i}`, `${i + 1}行目: ${Object.values((e as HttpError).extra.errors as Record<string, string>).join(' ')}`); }
    return item;
  });
}

/** 項目をまとめて1文で入れる（json_each。D1 の1回あたりのクエリ数を増やさない） */
function insertItems(db: D1Database, versionId: string, items: ItemInput[]): D1PreparedStatement {
  const rows = items.map((it, i) => ({ id: newId(), sort_order: i + 1, ...it }));
  return db.prepare(
    `INSERT INTO inspection_items (id, template_version_id, sort_order, group_label, label, criteria, required, allow_na)
     SELECT json_extract(j.value, '$.id'), ?, json_extract(j.value, '$.sort_order'), json_extract(j.value, '$.group_label'),
            json_extract(j.value, '$.label'), json_extract(j.value, '$.criteria'), json_extract(j.value, '$.required'), json_extract(j.value, '$.allow_na')
     FROM json_each(?) j`,
  ).bind(versionId, JSON.stringify(rows));
}

templateRoutes.get('/templates', async (c) => {
  authorize(c, 'equipment.view');
  const auth = c.get('auth');
  const { results } = await c.env.DB.prepare(
    `SELECT t.id, t.name, t.description, t.factory_id, t.status, v.version_no AS current_version_no,
            (SELECT COUNT(*) FROM inspection_items i WHERE i.template_version_id = t.current_version_id) AS item_count,
            (SELECT COUNT(*) FROM equipment e WHERE e.template_id = t.id AND e.status <> 'retired') AS equipment_count,
            EXISTS (SELECT 1 FROM inspection_template_versions d WHERE d.template_id = t.id AND d.status = 'draft') AS has_draft
     FROM inspection_templates t LEFT JOIN inspection_template_versions v ON v.id = t.current_version_id
     WHERE t.company_id = ? AND t.status = 'active' ORDER BY t.name`,
  ).bind(auth.companyId).all<{ factory_id: string | null }>();
  const visible = results.filter((t) => !t.factory_id || auth.actor.role === 'system_admin' || auth.actor.factoryIds.includes(t.factory_id));
  return c.json({ items: visible });
});

templateRoutes.get('/templates/:id', async (c) => {
  authorize(c, 'equipment.view');
  const t = await loadTemplate(c, c.req.param('id'));
  const db = c.env.DB;
  const { results: versions } = await db.prepare(
    `SELECT v.id, v.version_no, v.status, v.change_reason, v.created_at, v.published_at, u.name AS published_by_name,
            (SELECT COUNT(*) FROM inspection_items i WHERE i.template_version_id = v.id) AS item_count
     FROM inspection_template_versions v LEFT JOIN users u ON u.id = v.published_by
     WHERE v.template_id = ? ORDER BY v.version_no DESC`,
  ).bind(t.id).all<{ id: string; status: string }>();
  const draft = versions.find((v) => v.status === 'draft');
  const itemsOf = async (versionId: string | null | undefined) => versionId
    ? (await db.prepare('SELECT id, sort_order, group_label, label, criteria, required, allow_na FROM inspection_items WHERE template_version_id = ? ORDER BY sort_order').bind(versionId).all()).results
    : [];
  return c.json({ template: t, versions, current: await itemsOf(t.current_version_id), draft: draft ? { id: draft.id, items: await itemsOf(draft.id) } : null });
});

templateRoutes.get('/template-versions/:id', async (c) => {
  authorize(c, 'equipment.view');
  const v = await c.env.DB.prepare(
    `SELECT v.*, t.company_id FROM inspection_template_versions v JOIN inspection_templates t ON t.id = v.template_id WHERE v.id = ? AND t.company_id = ?`,
  ).bind(c.req.param('id'), c.get('auth').companyId).first<{ id: string; template_id: string }>();
  if (!v) throw notFound();
  await loadTemplate(c, v.template_id);
  const { results } = await c.env.DB.prepare('SELECT id, sort_order, group_label, label, criteria, required, allow_na FROM inspection_items WHERE template_version_id = ? ORDER BY sort_order').bind(v.id).all();
  return c.json({ version: v, items: results });
});

/** 新しい点検基準（第1版を公開した状態で作る） */
templateRoutes.post('/templates', async (c) => {
  authorize(c, 'template.edit');
  const auth = c.get('auth');
  const body = await readJson(c.req.raw);
  const v = new Validator(body);
  const name = v.str('name', { required: true, max: 60, label: '名前' });
  const description = v.str('description', { max: 300, label: '説明' }) ?? null;
  const factoryId = v.str('factory_id', { max: 64, label: '工場' }) ?? null;
  const items = readItems(v, body);
  v.done();
  if (factoryId) authorize(c, 'template.edit', { factoryId });

  const id = newId();
  const versionId = newId();
  const now = nowIso();
  const db = c.env.DB;
  await db.batch([
    db.prepare(`INSERT INTO inspection_templates (id, company_id, factory_id, name, description, created_at, created_by, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, auth.companyId, factoryId, name, description, now, auth.user.id, now, auth.user.id),
    db.prepare(`INSERT INTO inspection_template_versions (id, template_id, version_no, status, created_at, created_by) VALUES (?, ?, 1, 'draft', ?, ?)`)
      .bind(versionId, id, now, auth.user.id),
    insertItems(db, versionId, items),
    db.prepare(`UPDATE inspection_template_versions SET status = 'published', published_at = ?, published_by = ? WHERE id = ?`).bind(now, auth.user.id, versionId),
    db.prepare('UPDATE inspection_templates SET current_version_id = ? WHERE id = ?').bind(versionId, id),
    auditStatement(c, { action: 'template.create', targetType: 'template', targetId: id, factoryId, detail: { name, items: items.length } }),
  ]);
  return c.json({ id }, 201);
});

/** 下書きの版を保存（なければ作る）。公開するまで点検には使われない */
templateRoutes.put('/templates/:id/draft', async (c) => {
  authorize(c, 'template.edit');
  const auth = c.get('auth');
  const t = await loadTemplate(c, c.req.param('id'));
  if (t.factory_id) authorize(c, 'template.edit', { factoryId: t.factory_id });
  const body = await readJson(c.req.raw);
  const v = new Validator(body);
  const items = readItems(v, body);
  v.done();

  const db = c.env.DB;
  const draft = await db.prepare("SELECT id FROM inspection_template_versions WHERE template_id = ? AND status = 'draft'").bind(t.id).first<{ id: string }>();
  const now = nowIso();
  if (draft) {
    await db.batch([
      db.prepare('DELETE FROM inspection_items WHERE template_version_id = ?').bind(draft.id),
      insertItems(db, draft.id, items),
    ]);
    return c.json({ draftId: draft.id });
  }
  const max = await db.prepare('SELECT MAX(version_no) AS n FROM inspection_template_versions WHERE template_id = ?').bind(t.id).first<{ n: number }>();
  const draftId = newId();
  await db.batch([
    db.prepare(`INSERT INTO inspection_template_versions (id, template_id, version_no, status, created_at, created_by) VALUES (?, ?, ?, 'draft', ?, ?)`)
      .bind(draftId, t.id, (max?.n ?? 0) + 1, now, auth.user.id),
    insertItems(db, draftId, items),
  ]);
  return c.json({ draftId }, 201);
});

templateRoutes.delete('/templates/:id/draft', async (c) => {
  authorize(c, 'template.edit');
  const t = await loadTemplate(c, c.req.param('id'));
  const db = c.env.DB;
  const draft = await db.prepare("SELECT id FROM inspection_template_versions WHERE template_id = ? AND status = 'draft'").bind(t.id).first<{ id: string }>();
  if (!draft) throw notFound('下書きはありません。');
  await db.batch([
    db.prepare('DELETE FROM inspection_items WHERE template_version_id = ?').bind(draft.id),
    db.prepare("DELETE FROM inspection_template_versions WHERE id = ? AND status = 'draft'").bind(draft.id),
  ]);
  return c.body(null, 204);
});

/** 下書きを公開して新しい版にする（変更理由は必須） */
templateRoutes.post('/templates/:id/publish', async (c) => {
  authorize(c, 'template.edit');
  const auth = c.get('auth');
  const t = await loadTemplate(c, c.req.param('id'));
  if (t.factory_id) authorize(c, 'template.edit', { factoryId: t.factory_id });
  const v = new Validator(await readJson(c.req.raw));
  const reason = v.str('change_reason', { required: true, max: 300, label: '変更理由' });
  v.done();

  const db = c.env.DB;
  const draft = await db.prepare(
    `SELECT v.id, v.version_no, (SELECT COUNT(*) FROM inspection_items i WHERE i.template_version_id = v.id) AS items
     FROM inspection_template_versions v WHERE v.template_id = ? AND v.status = 'draft'`,
  ).bind(t.id).first<{ id: string; version_no: number; items: number }>();
  if (!draft) throw new HttpError(409, '公開する下書きがありません。');
  if (!draft.items) throw new HttpError(422, '点検項目が1つもありません。');

  const now = nowIso();
  const [, pub] = await db.batch([
    db.prepare("UPDATE inspection_template_versions SET status = 'superseded' WHERE template_id = ? AND status = 'published'").bind(t.id),
    db.prepare("UPDATE inspection_template_versions SET status = 'published', change_reason = ?, published_at = ?, published_by = ? WHERE id = ? AND status = 'draft'")
      .bind(reason, now, auth.user.id, draft.id),
    db.prepare('UPDATE inspection_templates SET current_version_id = ?, updated_at = ?, updated_by = ?, version = version + 1 WHERE id = ?').bind(draft.id, now, auth.user.id, t.id),
    auditStatement(c, { action: 'template.publish', targetType: 'template', targetId: t.id, factoryId: t.factory_id, detail: { version_no: draft.version_no, reason, items: draft.items } }),
  ]);
  if (!pub?.meta.changes) throw conflict();
  return c.json({ versionId: draft.id, version_no: draft.version_no });
});
