import { useState, type FormEvent } from 'react';
import { ABNORMALITY_STATUS_LABELS, SEVERITY_LABELS, type AbnormalityStatus, type Severity } from '@tenq/shared';
import { apiGet, apiSend, apiUpload } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { AuthImage, shrinkPhoto } from '../components/Photo';
import { Alert, Button, Field, Loading, PageHeader, errorMessage, fieldErrors, useLoad } from '../components/ui';
import { CORRECTIVE_KIND, formatDateTime } from '../labels';
import { currentQuery, navigate } from '../router';
import { SEVERITY_CLS, STATUS_CLS } from './AbnormalitiesPage';

interface Detail {
  abnormality: {
    id: string; report_no: string; title: string; description: string | null; severity: Severity; status: AbnormalityStatus; found_at: string;
    emergency_action: string | null; equipment_stopped: number; due_date: string | null; corrected_date: string | null; overdue: boolean; version: number;
    equipment_id: string; equipment_code: string; equipment_name: string; equipment_status: string; factory_id: string; factory_name: string;
    reporter_name: string; assignee_name: string | null; assignee_user_id: string | null; verified_by_name: string | null; verified_at: string | null;
    approved_by_name: string | null; approved_at: string | null; item_label: string | null; inspection_id: string | null; inspection_date: string | null;
  };
  events: { from_status: string | null; to_status: AbnormalityStatus; comment: string | null; created_at: string; actor_name: string }[];
  actions: { id: string; kind: string; cause: string | null; description: string; performed_at: string | null; performed_by_name: string }[];
  photos: { id: string; owner_type: string; uploaded_at: string; uploaded_by_name: string; uploaded_by: string }[];
  permissions: { resolve: boolean; addPhoto: boolean };
}

/** 2026-10-31 の簡単化で、ふだんの流れは「異常あり → 直した」の 2 つだけ（requirements §10 Q-5） */
const EVENT_LABEL: Partial<Record<AbnormalityStatus, string>> = { reported: '✕ 異常あり', closed: '○ 直した' };

/** 異常の詳細と「直した」（S-06）。状態の遷移はサーバーの遷移表どおりにしかできない */
export function AbnormalityDetailPage({ id }: { id: string }) {
  const { me, can } = useAuth();
  const q = currentQuery();
  const { data, error, loading, reload } = useLoad(() => apiGet<Detail>(`/abnormalities/${encodeURIComponent(id)}`), [id]);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(
    q.get('new') ? { kind: 'success', text: q.get('photoFailed') ? `報告しました。ただし写真 ${q.get('photoFailed')} 枚を送れませんでした。下の「写真を追加」から送り直してください。` : '報告しました。設備担当者・工場長に伝わります。' } : null,
  );
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [form, setForm] = useState({ description: '', resume: true });

  if (loading && !data) return <Loading />;
  if (error && !data) return <Alert kind="error">{error}</Alert>;
  if (!data || !me) return null;
  const a = data.abnormality;
  const p = data.permissions;
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function run(action: string, body: Record<string, unknown>, ok: string) {
    setBusy(true); setErrors({});
    try {
      await apiSend('POST', `/abnormalities/${a.id}/transition`, { version: a.version, action, ...body });
      setMsg({ kind: 'success', text: ok });
      setForm((f) => ({ ...f, description: '' }));
      reload();
    } catch (e) {
      setMsg({ kind: 'error', text: errorMessage(e) });
      setErrors(fieldErrors(e));
    } finally {
      setBusy(false);
    }
  }

  const canResume = a.equipment_status === 'stopped' && can('equipment.stop', { factoryId: a.factory_id });

  return (
    <>
      <PageHeader title={a.title}
        sub={<>{a.report_no} ・ <a href={`#/equipment/${a.equipment_id}`}>{a.equipment_code} {a.equipment_name}</a> ・ <span className={`badge ${SEVERITY_CLS[a.severity]}`}>危険度 {SEVERITY_LABELS[a.severity].label}</span></>}
        actions={<Button onClick={() => navigate('/abnormalities')}>一覧へ</Button>} />
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      {a.severity === 'high' && a.status !== 'closed' && <Alert kind="error">{me.settings.high_severity_message}{a.equipment_stopped ? '（報告者は設備の使用を止めました）' : ''}</Alert>}

      <div className="detail-grid">
        <section className="panel">
          <h2>報告の内容</h2>
          <dl className="dl">
            <dt>状態</dt><dd>{a.status === 'closed' ? <span className="badge st-ok">○ 直した</span> : <span className="badge st-ng">✕ 異常あり</span>}</dd>
            <dt>発見</dt><dd>{formatDateTime(a.found_at)} {a.reporter_name}</dd>
            {a.item_label && <><dt>点検項目</dt><dd><a href={`#/inspections/${a.inspection_id}`}>{a.inspection_date} の点検</a>「{a.item_label}」</dd></>}
            <dt>詳しい内容</dt><dd className="pre">{a.description ?? '—'}</dd>
            <dt>応急処置</dt><dd className="pre">{a.emergency_action ?? '—'}</dd>
            <dt>設備の状態</dt><dd>{a.equipment_status === 'stopped' ? '停止中' : a.equipment_status === 'active' ? '稼働' : '廃止'}</dd>
            <dt>直した日</dt><dd>{a.corrected_date ?? '—'}</dd>
            {/* 2026-10-31 より前の 6 段階の記録（担当・再確認・承認）があれば出す */}
            {a.assignee_name && <><dt>対応担当者</dt><dd>{a.assignee_name}{a.due_date && `（期限 ${a.due_date}）`}</dd></>}
            {a.verified_by_name && <><dt>再確認</dt><dd>{a.verified_by_name}（{formatDateTime(a.verified_at)}）</dd></>}
            {a.approved_by_name && <><dt>承認</dt><dd>{a.approved_by_name}（{formatDateTime(a.approved_at)}）</dd></>}
          </dl>
        </section>

        <section className="panel">
          <h2>写真（{data.photos.length}）</h2>
          <div className="photo-grid">
            {data.photos.map((ph) => (
              <figure key={ph.id}>
                <AuthImage id={ph.id} alt={`${a.title} の写真`} />
                <figcaption>{ph.owner_type === 'corrective_action' ? '是正後 ・ ' : ''}{formatDateTime(ph.uploaded_at)} {ph.uploaded_by_name}</figcaption>
              </figure>
            ))}
          </div>
          {p.addPhoto && (
            <label className="photo-add inline">
              <input type="file" accept="image/jpeg,image/png,image/webp,image/*" capture="environment" multiple disabled={busy}
                onChange={async (e) => {
                  const files = [...(e.target.files ?? [])];
                  e.target.value = '';
                  if (!files.length) return;
                  setBusy(true);
                  // 是正を記録した後の写真は「是正後」として、最後の是正処置に付ける
                  const lastAction = data.actions[data.actions.length - 1];
                  const owner = ['corrected', 'verified'].includes(a.status) && lastAction ? `owner_type=corrective_action&owner_id=${lastAction.id}` : `owner_type=abnormality&owner_id=${a.id}`;
                  try {
                    for (const f of files) await apiUpload(`/attachments?${owner}`, await shrinkPhoto(f), f.name);
                    setMsg({ kind: 'success', text: `写真を ${files.length} 枚追加しました。` });
                  } catch (err) { setMsg({ kind: 'error', text: errorMessage(err) }); }
                  setBusy(false);
                  reload();
                }} />
              <span>＋ 写真を追加</span>
            </label>
          )}
        </section>

        {p.resolve && (
          <section className="panel action-panel">
            <h2>直した</h2>
            <form className="act-form" onSubmit={(e: FormEvent) => { e.preventDefault(); void run('resolve', { description: form.description, resume_equipment: canResume && form.resume }, '「直した」を記録しました。'); }}>
              <Field label="何をして直したか（一言）" required error={errors.description}><input type="text" maxLength={500} value={form.description} onChange={set('description')} placeholder="例: パッキンを交換した" /></Field>
              {canResume && (
                <label className="check"><input type="checkbox" checked={form.resume} onChange={(e) => setForm((f) => ({ ...f, resume: e.target.checked }))} />
                  <span>止めていた設備を動かしてよい<small>この異常で止めていた設備を、点検の対象に戻します。</small></span></label>
              )}
              <Button type="submit" variant="primary" className="fix-go" disabled={busy || !form.description.trim()}>○ 直した</Button>
            </form>
          </section>
        )}

        <section className="panel">
          <h2>対応の記録</h2>
          <ol className="timeline">
            {data.events.map((ev, i) => (
              <li key={i}>
                <span className={`badge ${STATUS_CLS[ev.to_status]}`}>{EVENT_LABEL[ev.to_status] ?? ABNORMALITY_STATUS_LABELS[ev.to_status]}</span>
                <span className="small"> {formatDateTime(ev.created_at)} {ev.actor_name}</span>
                {ev.comment && <div className="small pre">{ev.comment}</div>}
              </li>
            ))}
          </ol>
          {data.actions.length > 0 && (
            <>
              <h3>是正処置</h3>
              {data.actions.map((ac) => (
                <div key={ac.id} className="action-item">
                  <b>{CORRECTIVE_KIND[ac.kind] ?? ac.kind}</b> {ac.performed_at} {ac.performed_by_name}
                  {ac.cause && <div className="small">原因: {ac.cause}</div>}
                  <div className="small pre">{ac.description}</div>
                </div>
              ))}
            </>
          )}
        </section>
      </div>
    </>
  );
}
