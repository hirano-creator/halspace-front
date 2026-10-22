import { useState } from 'react';
import { apiGet, apiSend } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Alert, Button, Field, Loading, PageHeader, ReasonDialog, errorMessage, fieldErrors, useLoad } from '../components/ui';
import { formatDateTime } from '../labels';
import { navigate } from '../router';

/**
 * 点検基準・点検項目（S-12）。公開した版は変えず、変更は下書き → 公開で新しい版にする。
 * 過去の点検は、点検したときの版で表示される。
 */

interface TemplateSummary { id: string; name: string; current_version_no: number | null; item_count: number; equipment_count: number; has_draft: number }
interface ItemDraft { label: string; criteria: string; group_label: string; required: boolean; allow_na: boolean }
interface ItemRow { id: string; sort_order: number; group_label: string | null; label: string; criteria: string | null; required: number; allow_na: number }
interface Detail {
  template: { id: string; name: string; description: string | null };
  versions: { id: string; version_no: number; status: string; change_reason: string | null; published_at: string | null; published_by_name: string | null; item_count: number }[];
  current: ItemRow[];
  draft: { id: string; items: ItemRow[] } | null;
}

const toDraft = (rows: ItemRow[]): ItemDraft[] => rows.map((r) => ({ label: r.label, criteria: r.criteria ?? '', group_label: r.group_label ?? '', required: !!r.required, allow_na: !!r.allow_na }));
const toBody = (rows: ItemDraft[]) => rows.map((r) => ({ label: r.label, criteria: r.criteria || null, group_label: r.group_label || null, required: r.required, allow_na: r.allow_na }));
const EMPTY_ITEM: ItemDraft = { label: '', criteria: '', group_label: '', required: true, allow_na: false };

export function TemplatesPage() {
  const { can } = useAuth();
  const { data, error, loading } = useLoad(() => apiGet<{ items: TemplateSummary[] }>('/templates'), []);
  if (loading && !data) return <Loading />;
  return (
    <>
      <PageHeader title="点検基準" sub="設備ごとの点検項目と判定基準です。変更すると新しい版になり、過去の点検記録は当時の版のまま残ります。"
        actions={can('template.edit') && <Button variant="primary" onClick={() => navigate('/templates/new')}>新しい点検基準</Button>} />
      {error && <Alert kind="error">{error}</Alert>}
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>名前</th><th>現在の版</th><th>項目数</th><th>使っている設備</th><th></th></tr></thead>
          <tbody>
            {data?.items.map((t) => (
              <tr key={t.id} className="row-link" onClick={() => navigate(`/templates/${t.id}`)}>
                <td><a href={`#/templates/${t.id}`} onClick={(e) => e.stopPropagation()}>{t.name}</a></td>
                <td>第{t.current_version_no ?? '—'}版</td><td>{t.item_count}</td><td>{t.equipment_count}台</td>
                <td>{t.has_draft ? <span className="badge st-late">下書きあり</span> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function TemplateDetailPage({ id }: { id: string }) {
  const { can } = useAuth();
  const creating = id === 'new';
  const detail = useLoad(() => (creating ? Promise.resolve(null) : apiGet<Detail>(`/templates/${encodeURIComponent(id)}`)), [id]);
  const [editing, setEditing] = useState(creating);
  const [rows, setRows] = useState<ItemDraft[]>(creating ? [{ ...EMPTY_ITEM }] : []);
  const [name, setName] = useState('');
  const [publishOpen, setPublishOpen] = useState(false);
  const [viewVersion, setViewVersion] = useState<{ no: number; items: ItemRow[] } | null>(null);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const editable = can('template.edit');

  if (!creating && detail.loading && !detail.data) return <Loading />;
  if (detail.error && !detail.data) return <Alert kind="error">{detail.error}</Alert>;
  const d = detail.data;

  const startEdit = () => { setRows(toDraft(d?.draft?.items ?? d?.current ?? [])); setEditing(true); setMsg(null); };
  const update = (i: number, patch: Partial<ItemDraft>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const move = (i: number, by: number) => setRows((r) => { const n = [...r]; const [x] = n.splice(i, 1); n.splice(i + by, 0, x!); return n; });

  async function saveDraft(): Promise<boolean> {
    try {
      await apiSend('PUT', `/templates/${id}/draft`, { items: toBody(rows) });
      setErrors({});
      return true;
    } catch (e) { setErrors(fieldErrors(e)); setMsg({ kind: 'error', text: errorMessage(e) }); return false; }
  }

  async function create() {
    try {
      const r = await apiSend<{ id: string }>('POST', '/templates', { name, items: toBody(rows) });
      navigate(`/templates/${r.id}`, true);
    } catch (e) { setErrors(fieldErrors(e)); setMsg({ kind: 'error', text: errorMessage(e) }); }
  }

  return (
    <>
      <PageHeader title={creating ? '新しい点検基準' : d?.template.name ?? ''}
        sub={!creating && d ? `現在 第${d.versions.find((v) => v.status === 'published')?.version_no ?? '—'}版` : '項目を入力して作成すると、第1版として使えるようになります。'}
        actions={!creating && editable && !editing && <Button variant="primary" onClick={startEdit}>{d?.draft ? '下書きの続きを編集' : '項目を変更する（新しい版）'}</Button>} />
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}

      {creating && (
        <Field label="名前" required error={errors.name}><input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="例: プレス機 日常点検" /></Field>
      )}

      {editing ? (
        <section className="panel">
          <h2>点検項目{!creating && '（下書き）'}</h2>
          {errors.items && <Alert kind="error">{errors.items}</Alert>}
          <ol className="item-editor">
            {rows.map((r, i) => (
              <li key={i} className={errors[`items.${i}`] ? 'has-error' : ''}>
                <div className="ie-grid">
                  <Field label={`${i + 1}. 項目名`} required><input value={r.label} maxLength={100} onChange={(e) => update(i, { label: e.target.value })} placeholder="例: 油漏れ" /></Field>
                  <Field label="判定基準"><input value={r.criteria} maxLength={300} onChange={(e) => update(i, { criteria: e.target.value })} placeholder="例: 配管継手・床に油のにじみがないこと" /></Field>
                  <Field label="区分"><input value={r.group_label} maxLength={40} onChange={(e) => update(i, { group_label: e.target.value })} placeholder="例: 安全" /></Field>
                </div>
                <div className="ie-opts">
                  <label className="check"><input type="checkbox" checked={r.required} onChange={(e) => update(i, { required: e.target.checked })} />必須</label>
                  <label className="check"><input type="checkbox" checked={r.allow_na} onChange={(e) => update(i, { allow_na: e.target.checked })} />「対象外」を選べる</label>
                  <span className="spacer" />
                  <Button onClick={() => move(i, -1)} disabled={i === 0} aria-label="上へ">↑</Button>
                  <Button onClick={() => move(i, 1)} disabled={i === rows.length - 1} aria-label="下へ">↓</Button>
                  <Button onClick={() => setRows((x) => x.filter((_, j) => j !== i))} disabled={rows.length === 1}>削除</Button>
                </div>
                {errors[`items.${i}`] && <p className="field-error">{errors[`items.${i}`]}</p>}
              </li>
            ))}
          </ol>
          <Button onClick={() => setRows((r) => [...r, { ...EMPTY_ITEM }])}>項目を追加</Button>
          <div className="button-row end" style={{ marginTop: 16 }}>
            {creating ? (
              <><Button onClick={() => history.back()}>やめる</Button><Button variant="primary" onClick={() => void create()} disabled={!name.trim()}>作成する（第1版）</Button></>
            ) : (
              <>
                <Button onClick={() => setEditing(false)}>閉じる</Button>
                {d?.draft && <Button onClick={async () => { await apiSend('DELETE', `/templates/${id}/draft`); setEditing(false); setMsg({ kind: 'success', text: '下書きを破棄しました。' }); detail.reload(); }}>下書きを破棄</Button>}
                <Button onClick={async () => { if (await saveDraft()) { setMsg({ kind: 'success', text: '下書きを保存しました。公開するまで点検には使われません。' }); detail.reload(); } }}>下書きを保存</Button>
                <Button variant="primary" onClick={async () => { if (await saveDraft()) setPublishOpen(true); }}>公開する（新しい版）</Button>
              </>
            )}
          </div>
        </section>
      ) : d && (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>#</th><th>項目名</th><th>判定基準</th><th>区分</th><th>必須</th><th>対象外</th></tr></thead>
            <tbody>
              {d.current.map((r) => (
                <tr key={r.id}><td>{r.sort_order}</td><td><b>{r.label}</b></td><td>{r.criteria ?? '—'}</td><td>{r.group_label ?? '—'}</td><td>{r.required ? '必須' : '任意'}</td><td>{r.allow_na ? '可' : '—'}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {d && (
        <section className="panel" style={{ marginTop: 16 }}>
          <h2>版の履歴</h2>
          <ol className="history">
            {d.versions.map((v) => (
              <li key={v.id}>
                <b>第{v.version_no}版</b> <span className={`badge ${v.status === 'published' ? 'st-ok' : v.status === 'draft' ? 'st-late' : 'st-todo'}`}>{{ published: '使用中', draft: '下書き', superseded: '過去の版' }[v.status]}</span>
                {' '}{formatDateTime(v.published_at)} {v.published_by_name ?? ''} ・ {v.item_count}項目
                {v.change_reason && <div className="small">変更理由: {v.change_reason}</div>}
                {v.status === 'superseded' && <> <button type="button" className="link" onClick={async () => {
                  const r = await apiGet<{ items: ItemRow[] }>(`/template-versions/${v.id}`);
                  setViewVersion({ no: v.version_no, items: r.items });
                }}>この版の項目を見る</button></>}
              </li>
            ))}
          </ol>
          {viewVersion && (
            <div className="panel inset">
              <h3>第{viewVersion.no}版の項目</h3>
              <ol>{viewVersion.items.map((r) => <li key={r.id}>{r.label}{r.criteria && <span className="muted">（{r.criteria}）</span>}</li>)}</ol>
              <Button onClick={() => setViewVersion(null)}>閉じる</Button>
            </div>
          )}
        </section>
      )}

      <ReasonDialog open={publishOpen} title="新しい版を公開" confirmLabel="公開する"
        message="公開すると、これから始める点検はこの版の項目になります。過去の点検記録と、いま点検中のものは前の版のままです。"
        onClose={() => setPublishOpen(false)}
        onConfirm={async (reason) => {
          const r = await apiSend<{ version_no: number }>('POST', `/templates/${id}/publish`, { change_reason: reason });
          setEditing(false); setMsg({ kind: 'success', text: `第${r.version_no}版を公開しました。` }); detail.reload();
        }} />
    </>
  );
}
