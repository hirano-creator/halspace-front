import { useState } from 'react';
import { apiGet, apiSend } from '../api/client';
import { Alert, Button, Loading, PageHeader, ReasonDialog, useLoad } from '../components/ui';
import { INSPECTION_STATUS, JUDGMENT, formatDateTime } from '../labels';
import { navigate } from '../router';

type Judgment = 'ok' | 'ng' | 'na';
interface Detail {
  inspection: {
    id: string; equipment_id: string; equipment_code: string; equipment_name: string; inspection_date: string; status: string; overall_result: string | null;
    inspector_name: string; started_at: string; completed_at: string | null; comment: string | null; current_revision: number; version: number;
    template_name: string; version_no: number; voided_reason: string | null; voided_by_name: string | null;
  };
  items: { id: string; label: string; criteria: string | null; required: number; allow_na: number }[];
  results: { item_id: string; judgment: Judgment; note: string | null }[];
  corrections: { from_revision: number; to_revision: number; reason: string; corrected_at: string; corrected_by_name: string; diff: Record<string, { label: string; before: [string | null, string | null]; after: [string, string | null] }> }[];
  permissions: { correct: boolean; void: boolean };
}

/** 点検記録の詳細。訂正は元の記録を残して新しい版を追加する（requirements F-11） */
export function InspectionDetailPage({ id }: { id: string }) {
  const { data, error, loading, reload } = useLoad(() => apiGet<Detail>(`/inspections/${encodeURIComponent(id)}`), [id]);
  const [editing, setEditing] = useState(false);
  const [edits, setEdits] = useState<Record<string, { judgment: Judgment; note: string }>>({});
  const [reasonOpen, setReasonOpen] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  if (loading && !data) return <Loading />;
  if (error && !data) return <Alert kind="error">{error}</Alert>;
  if (!data) return null;
  const { inspection: ins, items, permissions } = data;
  const byItem = new Map(data.results.map((r) => [r.item_id, r]));
  const st = INSPECTION_STATUS[ins.status];
  const changed = Object.entries(edits).filter(([itemId, e]) => {
    const r = byItem.get(itemId);
    return r?.judgment !== e.judgment || (r?.note ?? '') !== e.note;
  });

  return (
    <>
      <PageHeader title={`点検記録 ${ins.equipment_code} ${ins.equipment_name}`}
        sub={<>{ins.inspection_date} ・ {ins.inspector_name} ・ <span className={`badge ${st?.cls ?? ''}`}>{st?.label}</span>{ins.overall_result && <> <span className={`badge ${ins.overall_result === 'ng' ? 'st-ng' : 'st-ok'}`}>{ins.overall_result === 'ng' ? '異常あり' : '異常なし'}</span></>}</>}
        actions={<>
          {permissions.correct && !editing && <Button variant="primary" onClick={() => { setEditing(true); setEdits({}); setMsg(null); }}>訂正する</Button>}
          {permissions.void && !editing && <Button onClick={() => setVoidOpen(true)}>取り消す</Button>}
          <Button onClick={() => navigate(`/equipment/${ins.equipment_id}`)}>設備へ</Button>
        </>} />

      {msg && <Alert kind="success">{msg}</Alert>}
      {ins.status === 'voided' && <Alert kind="warn">この点検は取り消されています（{ins.voided_by_name}: {ins.voided_reason}）。</Alert>}
      {ins.current_revision > 1 && <Alert kind="info">この記録は {ins.current_revision - 1} 回訂正されています。元の記録と訂正の理由は下の「訂正の履歴」に残っています。</Alert>}
      {editing && <Alert kind="info">訂正する項目の判定・コメントを変えて、最後に「訂正を保存」を押してください。元の記録は消えずに残ります。</Alert>}

      <section className="panel">
        <dl className="dl">
          <dt>開始</dt><dd>{formatDateTime(ins.started_at)}</dd>
          <dt>完了</dt><dd>{formatDateTime(ins.completed_at)}</dd>
          <dt>点検基準</dt><dd>{ins.template_name} 第{ins.version_no}版</dd>
          {ins.comment && <><dt>コメント</dt><dd className="pre">{ins.comment}</dd></>}
        </dl>
      </section>

      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>点検項目</th><th>判定</th><th>コメント</th></tr></thead>
          <tbody>
            {items.map((it) => {
              const r = byItem.get(it.id);
              const e = edits[it.id] ?? (r ? { judgment: r.judgment, note: r.note ?? '' } : undefined);
              const j = r ? JUDGMENT[r.judgment] : null;
              return (
                <tr key={it.id}>
                  <td><b>{it.label}</b>{it.criteria && <small className="block muted">{it.criteria}</small>}</td>
                  <td>
                    {editing ? (
                      <select aria-label={`${it.label} の判定`} value={e?.judgment ?? ''} onChange={(ev) => setEdits((x) => ({ ...x, [it.id]: { judgment: ev.target.value as Judgment, note: e?.note ?? '' } }))}>
                        {!e && <option value="">（未入力）</option>}
                        <option value="ok">正常</option><option value="ng">異常</option>{!!it.allow_na && <option value="na">対象外</option>}
                      </select>
                    ) : j ? <span className={`badge ${j.cls}`}>{j.label}</span> : <span className="muted">—</span>}
                  </td>
                  <td>
                    {editing ? (
                      <input aria-label={`${it.label} のコメント`} value={e?.note ?? ''} maxLength={500} disabled={!e}
                        onChange={(ev) => setEdits((x) => ({ ...x, [it.id]: { judgment: e!.judgment, note: ev.target.value } }))} />
                    ) : (r?.note ?? '')}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {editing && (
        <div className="button-row end" style={{ marginTop: 12 }}>
          <Button onClick={() => setEditing(false)}>やめる</Button>
          <Button variant="primary" disabled={!changed.length} onClick={() => setReasonOpen(true)}>訂正を保存（{changed.length}項目）</Button>
        </div>
      )}

      {data.corrections.length > 0 && (
        <section className="panel" style={{ marginTop: 16 }}>
          <h2>訂正の履歴</h2>
          <ol className="history">
            {data.corrections.map((c) => (
              <li key={c.to_revision}>
                <b>第{c.to_revision}版</b> {formatDateTime(c.corrected_at)} ・ {c.corrected_by_name}
                <div className="small">理由: {c.reason}</div>
                <ul className="small">
                  {Object.values(c.diff).map((d, i) => (
                    <li key={i}>{d.label}: {JUDGMENT[d.before[0] ?? '']?.label ?? '未入力'}{d.before[1] ? `（${d.before[1]}）` : ''} → {JUDGMENT[d.after[0]]?.label}{d.after[1] ? `（${d.after[1]}）` : ''}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </section>
      )}

      <ReasonDialog open={reasonOpen} title="訂正の理由" confirmLabel="訂正を保存" message="訂正の理由は記録に残ります（例: 押し間違い、確認し直したら異常だった）。"
        onClose={() => setReasonOpen(false)}
        onConfirm={async (reason) => {
          await apiSend('POST', `/inspections/${ins.id}/corrections`, { version: ins.version, reason, changes: changed.map(([item_id, e]) => ({ item_id, judgment: e.judgment, note: e.note || null })) });
          setEditing(false); setMsg('訂正を保存しました。'); reload();
        }} />
      <ReasonDialog open={voidOpen} title="点検記録を取り消す" confirmLabel="取り消す" danger message="この点検記録を取り消します。記録は「取消」として残り、同じ日にもう一度点検できるようになります。"
        onClose={() => setVoidOpen(false)}
        onConfirm={async (reason) => { await apiSend('POST', `/inspections/${ins.id}/void`, { reason }); setMsg('取り消しました。'); reload(); }} />
    </>
  );
}
