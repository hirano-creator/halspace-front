import { useState, type FormEvent } from 'react';
import { ABNORMALITY_STATUSES, ABNORMALITY_STATUS_LABELS, SEVERITY_LABELS, type AbnormalityStatus, type Severity } from '@tenq/shared';
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
  permissions: { assign: boolean; start: boolean; correct: boolean; verify: boolean; reject: boolean; approve: boolean; addPhoto: boolean };
}

const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date());

/** 異常の詳細と対応（S-06）。状態の遷移はサーバーの遷移表どおりにしかできない */
export function AbnormalityDetailPage({ id }: { id: string }) {
  const { me, can } = useAuth();
  const q = currentQuery();
  const { data, error, loading, reload } = useLoad(() => apiGet<Detail>(`/abnormalities/${encodeURIComponent(id)}`), [id]);
  const staff = useLoad(() => apiGet<{ items: { id: string; name: string; role: string }[] }>('/users/directory'), []);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(
    q.get('new') ? { kind: 'success', text: q.get('photoFailed') ? `報告しました。ただし写真 ${q.get('photoFailed')} 枚を送れませんでした。下の「写真を追加」から送り直してください。` : '報告しました。設備担当者・工場長に伝わります。' } : null,
  );
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [form, setForm] = useState({ assignee: '', due: '', description: '', cause: '', kind: 'permanent', corrected: today(), comment: '', resume: true });

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
      setForm((f) => ({ ...f, comment: '' }));
      reload();
    } catch (e) {
      setMsg({ kind: 'error', text: errorMessage(e) });
      setErrors(fieldErrors(e));
    } finally {
      setBusy(false);
    }
  }

  const stepIndex = ABNORMALITY_STATUSES.indexOf(a.status);
  const canResume = a.equipment_status === 'stopped' && can('equipment.stop', { factoryId: a.factory_id });

  return (
    <>
      <PageHeader title={a.title}
        sub={<>{a.report_no} ・ <a href={`#/equipment/${a.equipment_id}`}>{a.equipment_code} {a.equipment_name}</a> ・ <span className={`badge ${SEVERITY_CLS[a.severity]}`}>危険度 {SEVERITY_LABELS[a.severity].label}</span></>}
        actions={<Button onClick={() => navigate('/abnormalities')}>一覧へ</Button>} />
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      {a.overdue && <Alert kind="warn">対応期限（{a.due_date}）を過ぎています。</Alert>}
      {a.severity === 'high' && a.status !== 'closed' && <Alert kind="error">{me.settings.high_severity_message}{a.equipment_stopped ? '（報告者は設備の使用を止めました）' : ''}</Alert>}

      <ol className="steps" aria-label="対応の進み具合">
        {ABNORMALITY_STATUSES.map((s, i) => (
          <li key={s} className={i < stepIndex ? 'passed' : i === stepIndex ? 'now' : ''} aria-current={i === stepIndex ? 'step' : undefined}>{ABNORMALITY_STATUS_LABELS[s]}</li>
        ))}
      </ol>

      <div className="detail-grid">
        <section className="panel">
          <h2>報告の内容</h2>
          <dl className="dl">
            <dt>状態</dt><dd><span className={`badge ${STATUS_CLS[a.status]}`}>{ABNORMALITY_STATUS_LABELS[a.status]}</span></dd>
            <dt>発見</dt><dd>{formatDateTime(a.found_at)} {a.reporter_name}</dd>
            {a.item_label && <><dt>点検項目</dt><dd><a href={`#/inspections/${a.inspection_id}`}>{a.inspection_date} の点検</a>「{a.item_label}」</dd></>}
            <dt>詳しい内容</dt><dd className="pre">{a.description ?? '—'}</dd>
            <dt>応急処置</dt><dd className="pre">{a.emergency_action ?? '—'}</dd>
            <dt>設備の状態</dt><dd>{a.equipment_status === 'stopped' ? '停止中' : a.equipment_status === 'active' ? '稼働' : '廃止'}</dd>
            <dt>対応担当者</dt><dd>{a.assignee_name ?? '未定'}</dd>
            <dt>対応期限</dt><dd>{a.due_date ?? '—'}</dd>
            <dt>対応完了日</dt><dd>{a.corrected_date ?? '—'}</dd>
            <dt>再確認</dt><dd>{a.verified_by_name ? `${a.verified_by_name}（${formatDateTime(a.verified_at)}）` : '—'}</dd>
            <dt>承認</dt><dd>{a.approved_by_name ? `${a.approved_by_name}（${formatDateTime(a.approved_at)}）` : '—'}</dd>
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

        {(p.assign || p.start || p.correct || p.verify || p.approve) && (
          <section className="panel action-panel">
            <h2>対応する</h2>

            {p.assign && (
              <form className="act-form" onSubmit={(e: FormEvent) => { e.preventDefault(); void run('assign', { assignee_user_id: form.assignee || a.assignee_user_id, due_date: form.due || a.due_date }, '担当と期限を決めました。'); }}>
                <h3>{a.status === 'reported' ? '担当と期限を決める' : '担当・期限を変える'}</h3>
                <Field label="対応担当者" required error={errors.assignee_user_id}>
                  <select value={form.assignee || a.assignee_user_id || ''} onChange={set('assignee')}>
                    <option value="">選んでください</option>
                    {staff.data?.items.filter((u) => u.role !== 'worker').map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                </Field>
                <Field label="対応期限" required error={errors.due_date}><input type="date" value={form.due || a.due_date || ''} min={today()} onChange={set('due')} /></Field>
                <Button type="submit" variant="primary" disabled={busy || !(form.assignee || a.assignee_user_id) || !(form.due || a.due_date)}>決める</Button>
              </form>
            )}

            {p.start && (
              <div className="act-form">
                <h3>対応を始める</h3>
                <p className="small muted">修理・調査に取りかかったら押してください。</p>
                <Button variant="primary" disabled={busy} onClick={() => void run('start', {}, '対応中にしました。')}>対応を始める</Button>
              </div>
            )}

            {p.correct && (
              <form className="act-form" onSubmit={(e: FormEvent) => { e.preventDefault(); void run('correct', { description: form.description, cause: form.cause || null, kind: form.kind, corrected_date: form.corrected }, '是正を記録しました。担当者以外の人に再確認を依頼してください。'); }}>
                <h3>是正を記録する</h3>
                <Field label="修理・是正の内容" required error={errors.description}><textarea rows={3} maxLength={2000} value={form.description} onChange={set('description')} placeholder="例: 留め具を新品に交換し、カバーが固定されることを確認" /></Field>
                <Field label="原因" error={errors.cause}><textarea rows={2} maxLength={1000} value={form.cause} onChange={set('cause')} /></Field>
                <div className="form-grid">
                  <Field label="処置の種類"><select value={form.kind} onChange={set('kind')}>{Object.entries(CORRECTIVE_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
                  <Field label="対応完了日" required error={errors.corrected_date}><input type="date" value={form.corrected} max={today()} onChange={set('corrected')} /></Field>
                </div>
                <Button type="submit" variant="primary" disabled={busy || !form.description.trim()}>是正完了にする</Button>
              </form>
            )}

            {(p.verify || p.reject) && (
              <div className="act-form">
                <h3>再確認</h3>
                <p className="small muted">現場で、直っていることを確かめてください（是正を記録した人とは別の人が行います）。</p>
                <Field label="コメント（差し戻すときは必須）" error={errors.comment}><textarea rows={2} maxLength={500} value={form.comment} onChange={set('comment')} /></Field>
                <div className="button-row">
                  {p.verify && <Button variant="primary" disabled={busy} onClick={() => void run('verify', { comment: form.comment || null }, '再確認しました。工場長の承認を待っています。')}>直っている（再確認済み）</Button>}
                  {p.reject && <Button variant="danger" disabled={busy || !form.comment.trim()} onClick={() => void run('reject', { comment: form.comment }, '対応中に差し戻しました。')}>直っていない（差し戻す）</Button>}
                </div>
              </div>
            )}

            {p.approve && (
              <div className="act-form">
                <h3>承認</h3>
                <Field label="コメント"><textarea rows={2} maxLength={500} value={form.comment} onChange={set('comment')} /></Field>
                {canResume && (
                  <label className="check"><input type="checkbox" checked={form.resume} onChange={(e) => setForm((f) => ({ ...f, resume: e.target.checked }))} />
                    <span>設備を「稼働」に戻す<small>この異常で止めていた設備を、点検の対象に戻します。</small></span></label>
                )}
                <Button variant="primary" disabled={busy} onClick={() => void run('approve', { comment: form.comment || null, resume_equipment: canResume && form.resume }, '承認して完了にしました。')}>承認して完了</Button>
              </div>
            )}
          </section>
        )}

        <section className="panel">
          <h2>対応の記録</h2>
          <ol className="timeline">
            {data.events.map((ev, i) => (
              <li key={i}>
                <span className={`badge ${STATUS_CLS[ev.to_status]}`}>{ABNORMALITY_STATUS_LABELS[ev.to_status]}</span>
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
