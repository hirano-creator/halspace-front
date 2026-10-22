import { useState } from 'react';
import { ABNORMALITY_STATUS_LABELS, SEVERITY_LABELS, type AbnormalityStatus, type Severity } from '@tenq/shared';
import { apiGet } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Alert, Loading, PageHeader, useLoad } from '../components/ui';
import { formatDateTime } from '../labels';
import { currentQuery, navigate } from '../router';

export interface AbnormalityRow {
  id: string; report_no: string; title: string; severity: Severity; status: AbnormalityStatus; found_at: string; due_date: string | null; overdue: boolean;
  equipment_id: string; equipment_code: string; equipment_name: string; factory_name: string; reporter_name: string; assignee_name: string | null;
  photo_count: number; equipment_stopped: number;
}

export const STATUS_CLS: Record<AbnormalityStatus, string> = {
  reported: 'st-ng', assigned: 'st-late', in_progress: 'st-doing', corrected: 'st-doing', verified: 'st-doing', closed: 'st-ok',
};
export const SEVERITY_CLS: Record<Severity, string> = { high: 'st-ng', medium: 'st-late', low: 'st-todo' };

const VIEWS = [
  { key: 'open', label: '完了していないもの' },
  { key: 'unhandled', label: '未対応（発生・担当決定）' },
  { key: 'overdue', label: '期限超過' },
  { key: 'mine', label: '自分が担当' },
  { key: 'corrected', label: '再確認待ち' },
  { key: 'verified', label: '承認待ち' },
  { key: 'all', label: 'すべて' },
] as const;

/** 異常・是正処置の一覧（S-06）。未対応と期限超過をすぐ確かめられるようにする */
export function AbnormalitiesPage() {
  const { me } = useAuth();
  const [view, setView] = useState<string>(currentQuery().get('view') ?? 'open');
  const [factory, setFactory] = useState('');
  const summary = useLoad(() => apiGet<Record<string, number>>('/abnormalities/summary'), []);
  const list = useLoad(() => {
    const p = new URLSearchParams({ view: view === 'mine' ? 'open' : view, limit: '100' });
    if (view === 'mine') p.set('assignee', 'me');
    if (factory) p.set('factory', factory);
    return apiGet<{ items: AbnormalityRow[] }>(`/abnormalities?${p}`);
  }, [view, factory]);
  const s = summary.data ?? {};

  return (
    <>
      <PageHeader title="異常・是正処置" sub="報告された異常の対応状況です。行を押すと詳細と対応の記録を開きます。" />
      <div className="abn-summary">
        <button type="button" className={`st-ng ${view === 'unhandled' ? 'on' : ''}`} onClick={() => setView('unhandled')}><b>{s.unhandled ?? '—'}</b><span>未対応</span></button>
        <button type="button" className={`st-late ${view === 'overdue' ? 'on' : ''}`} onClick={() => setView('overdue')}><b>{s.overdue ?? '—'}</b><span>期限超過</span></button>
        <button type="button" className={`st-doing ${view === 'mine' ? 'on' : ''}`} onClick={() => setView('mine')}><b>{s.mine ?? '—'}</b><span>自分が担当</span></button>
        <button type="button" className={view === 'corrected' ? 'on' : ''} onClick={() => setView('corrected')}><b>{s.to_verify ?? '—'}</b><span>再確認待ち</span></button>
        <button type="button" className={view === 'verified' ? 'on' : ''} onClick={() => setView('verified')}><b>{s.to_approve ?? '—'}</b><span>承認待ち</span></button>
      </div>

      <div className="filters">
        <select aria-label="表示する範囲" value={view} onChange={(e) => setView(e.target.value)}>
          {VIEWS.map((v) => <option key={v.key} value={v.key}>{v.label}</option>)}
        </select>
        {(me?.factories.length ?? 0) > 1 && (
          <select aria-label="工場" value={factory} onChange={(e) => setFactory(e.target.value)}>
            <option value="">すべての工場</option>
            {me?.factories.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        )}
      </div>

      {list.error && <Alert kind="error">{list.error}</Alert>}
      {list.loading && !list.data ? <Loading /> : (
        <ul className="abn-list">
          {list.data?.items.map((a) => (
            <li key={a.id}>
              <a href={`#/abnormalities/${a.id}`} className={`abn-row ${a.overdue ? 'is-overdue' : ''}`}>
                <span className={`badge ${SEVERITY_CLS[a.severity]}`}>危険度 {SEVERITY_LABELS[a.severity].label}</span>
                <span className="abn-main">
                  <b>{a.title}</b>
                  <small>{a.report_no} ・ {a.equipment_code} {a.equipment_name} ・ {formatDateTime(a.found_at)} {a.reporter_name}{a.photo_count > 0 && ` ・ 写真${a.photo_count}`}</small>
                  <small>{a.assignee_name ? `担当: ${a.assignee_name}` : '担当: 未定'}{a.due_date && ` ・ 期限: ${a.due_date}`}{a.overdue && <b className="overdue-flag"> 期限超過</b>}</small>
                </span>
                <span className={`badge ${STATUS_CLS[a.status]}`}>{ABNORMALITY_STATUS_LABELS[a.status]}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
      {list.data?.items.length === 0 && <p className="empty">該当する異常はありません。</p>}
      <p className="small muted">異常は、点検の完了画面か設備の詳細画面の「異常を報告」から登録します。<button type="button" className="link" onClick={() => navigate('/equipment')}>設備台帳へ</button></p>
    </>
  );
}
