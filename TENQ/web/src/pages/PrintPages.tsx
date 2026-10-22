import { ABNORMALITY_STATUS_LABELS, SEVERITY_LABELS, type AbnormalityStatus, type Severity } from '@tenq/shared';
import { apiGet } from '../api/client';
import { Alert, Button, Loading, useLoad } from '../components/ui';
import { JUDGMENT, formatDateTime } from '../labels';
import { currentQuery } from '../router';

/**
 * 印刷用の帳票（S-10）。画面上部の操作ボタンは印刷されない（.no-print）。
 *  - 月間点検表: 設備ごと・A4 横。行 = 点検項目、列 = 日（紙の点検表と同じ形）
 *  - ISO 監査向けの記録一覧: 期間・工場ごと・A4 縦
 */

const MARK: Record<string, string> = { ok: '○', ng: '×', na: '－' };
const FREQ: Record<string, string> = { daily: '毎日', weekly: '毎週', monthly: '毎月' };

function PrintBar({ title }: { title: string }) {
  return (
    <div className="no-print print-bar">
      <span>{title}（印刷用）</span>
      <Button onClick={() => history.back()}>戻る</Button>
      <Button variant="primary" onClick={() => window.print()}>印刷する</Button>
    </div>
  );
}

interface Sheet {
  equipment: { equipment_code: string; name: string; location: string | null; category: string | null; frequency: string; factory_name: string; manager_name: string | null };
  month: string;
  inspections: { inspection_date: string; inspector: string; overall_result: string; current_revision: number; version_no: number }[];
  rows: { label: string; criteria: string | null; cells: Record<string, { judgment: string; note: string | null }> }[];
  abnormalities: { report_no: string; title: string; severity: Severity; status: AbnormalityStatus; found_at: string }[];
  generatedAt: string; generatedBy: string;
}

export function MonthlySheetPage() {
  const q = currentQuery();
  const { data, error, loading } = useLoad(() => apiGet<Sheet>(`/reports/monthly-sheet?equipment=${encodeURIComponent(q.get('equipment') ?? '')}&month=${q.get('month') ?? ''}`), [q.toString()]);
  if (loading && !data) return <Loading />;
  if (error || !data) return <Alert kind="error">{error ?? '帳票を作れませんでした。'}</Alert>;
  const [y, m] = data.month.split('-').map(Number) as [number, number];
  const days = Array.from({ length: new Date(y, m, 0).getDate() }, (_, i) => `${data.month}-${String(i + 1).padStart(2, '0')}`);
  const byDate = new Map(data.inspections.map((i) => [i.inspection_date, i]));
  const notes = data.rows.flatMap((r) => Object.entries(r.cells).filter(([, c]) => c.note).map(([d, c]) => ({ d, label: r.label, note: c.note! })));

  return (
    <div className="print-page landscape">
      <PrintBar title="月間点検表" />
      <div className="sheet-doc">
        <header className="doc-head">
          <div>
            <h1>日常点検表 {y}年{m}月</h1>
            <p>{data.equipment.factory_name} ・ <b>{data.equipment.equipment_code} {data.equipment.name}</b> ・ {data.equipment.location ?? ''} ・ 点検頻度: {FREQ[data.equipment.frequency]} ・ 管理担当: {data.equipment.manager_name ?? '—'}</p>
          </div>
          <table className="stamp"><tbody><tr><th>作成</th><th>確認</th><th>承認</th></tr><tr><td /><td /><td /></tr></tbody></table>
        </header>
        <table className="sheet-table">
          <thead>
            <tr><th className="item-col">点検項目 ／ 判定基準</th>{days.map((d) => <th key={d}>{Number(d.slice(-2))}</th>)}</tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.label}>
                <th className="item-col"><b>{r.label}</b>{r.criteria && <small>{r.criteria}</small>}</th>
                {days.map((d) => { const c = r.cells[d]; return <td key={d} className={c?.judgment === 'ng' ? 'ng' : ''}>{c ? MARK[c.judgment] : ''}</td>; })}
              </tr>
            ))}
            <tr className="sign-row">
              <th className="item-col">点検者</th>
              {days.map((d) => { const i = byDate.get(d); return <td key={d} className="vertical">{i ? i.inspector.split(' ')[0] : ''}</td>; })}
            </tr>
            <tr className="sign-row">
              <th className="item-col">訂正</th>
              {days.map((d) => { const i = byDate.get(d); return <td key={d}>{i && i.current_revision > 1 ? '訂' : ''}</td>; })}
            </tr>
          </tbody>
        </table>
        <p className="legend">○ 正常 ／ × 異常 ／ － 対象外 ／ 空欄 点検なし ／ 「訂」は記録が訂正されていることを示します（訂正の理由はシステムに記録）</p>
        {(notes.length > 0 || data.abnormalities.length > 0) && (
          <div className="doc-notes">
            {notes.length > 0 && <><h2>異常・コメント</h2><ul>{notes.map((n, i) => <li key={i}>{Number(n.d.slice(-2))}日 {n.label}: {n.note}</li>)}</ul></>}
            {data.abnormalities.length > 0 && <><h2>異常報告</h2><ul>{data.abnormalities.map((a) => <li key={a.report_no}>{a.report_no} {formatDateTime(a.found_at)} {a.title}（危険度 {SEVERITY_LABELS[a.severity].label}・{ABNORMALITY_STATUS_LABELS[a.status]}）</li>)}</ul></>}
          </div>
        )}
        <footer className="doc-foot">TENQ — Smart Inspection System ／ 出力: {formatDateTime(data.generatedAt)} {data.generatedBy}</footer>
      </div>
    </div>
  );
}

interface AuditPack {
  factory: { code: string; name: string }; from: string; to: string; generatedAt: string; generatedBy: string;
  summary: { total: number; completed: number; ng: number; voided: number; corrected: number };
  equipment: { equipment_code: string; name: string; frequency: string; status: string; completed: number; ng: number; first_date: string | null; last_date: string | null }[];
  corrections: { inspection_date: string; equipment_code: string; equipment: string; to_revision: number; reason: string; corrected_at: string; corrected_by: string; diff: Record<string, { label: string; before: [string | null, string | null]; after: [string, string | null] }> }[];
  versions: { template: string; version_no: number; change_reason: string | null; published_at: string | null; published_by: string | null; items: number }[];
  abnormalities: { report_no: string; equipment_code: string; title: string; severity: Severity; status: AbnormalityStatus; found_at: string; due_date: string | null; corrected_date: string | null; assignee: string | null; verifier: string | null; verified_at: string | null; approver: string | null; approved_at: string | null; actions: string | null; overdue: boolean }[];
  voided: { inspection_date: string; equipment_code: string; voided_reason: string; voided_at: string; voided_by: string | null }[];
}

export function AuditPackPage() {
  const q = currentQuery();
  const { data, error, loading } = useLoad(() => apiGet<AuditPack>(`/reports/audit-pack?${q.toString()}`), [q.toString()]);
  if (loading && !data) return <Loading />;
  if (error || !data) return <Alert kind="error">{error ?? '帳票を作れませんでした。'}</Alert>;
  const s = data.summary;
  return (
    <div className="print-page">
      <PrintBar title="ISO 監査向けの記録一覧" />
      <div className="sheet-doc portrait">
        <header className="doc-head">
          <div>
            <h1>設備日常点検 記録一覧</h1>
            <p>{data.factory.code} {data.factory.name} ・ 期間 {data.from} 〜 {data.to}</p>
          </div>
          <table className="stamp"><tbody><tr><th>作成</th><th>確認</th><th>承認</th></tr><tr><td /><td /><td /></tr></tbody></table>
        </header>
        <p className="doc-disclaimer">この一覧は TENQ に記録された内容を出力したものです。ISO 等の規格への適合は、適用規格・社内手順・保存期間・承認方法に照らして品質管理担当者が確認してください。</p>

        <h2>1. 点検の実施状況</h2>
        <p>点検 {s.total ?? 0} 件（完了 {s.completed ?? 0}・うち異常あり {s.ng ?? 0}・取消 {s.voided ?? 0}・訂正あり {s.corrected ?? 0}）</p>
        <table className="doc-table">
          <thead><tr><th>設備</th><th>頻度</th><th>状態</th><th>完了</th><th>異常あり</th><th>最初</th><th>最後</th></tr></thead>
          <tbody>{data.equipment.map((e) => <tr key={e.equipment_code} className={e.completed === 0 && e.status === 'active' ? 'warn' : ''}><td>{e.equipment_code} {e.name}</td><td>{FREQ[e.frequency]}</td><td>{e.status === 'active' ? '稼働' : '停止中'}</td><td>{e.completed}</td><td>{e.ng ?? 0}</td><td>{e.first_date ?? '—'}</td><td>{e.last_date ?? '—'}</td></tr>)}</tbody>
        </table>

        <h2>2. 使用した点検基準の版</h2>
        <table className="doc-table">
          <thead><tr><th>点検基準</th><th>版</th><th>項目数</th><th>公開</th><th>変更理由</th></tr></thead>
          <tbody>{data.versions.map((v) => <tr key={`${v.template}-${v.version_no}`}><td>{v.template}</td><td>第{v.version_no}版</td><td>{v.items}</td><td>{formatDateTime(v.published_at)} {v.published_by ?? ''}</td><td>{v.change_reason ?? '（初版）'}</td></tr>)}</tbody>
        </table>

        <h2>3. 点検記録の訂正（{data.corrections.length} 件）</h2>
        {data.corrections.length === 0 ? <p>なし</p> : (
          <table className="doc-table">
            <thead><tr><th>点検日</th><th>設備</th><th>訂正日時・訂正者</th><th>理由</th><th>内容</th></tr></thead>
            <tbody>{data.corrections.map((c, i) => <tr key={i}><td>{c.inspection_date}</td><td>{c.equipment_code}</td><td>{formatDateTime(c.corrected_at)} {c.corrected_by}</td><td>{c.reason}</td>
              <td>{Object.values(c.diff).map((d) => `${d.label}: ${JUDGMENT[d.before[0] ?? '']?.label ?? '未入力'} → ${JUDGMENT[d.after[0]]?.label}`).join(' / ')}</td></tr>)}</tbody>
          </table>
        )}

        <h2>4. 異常と是正処置（{data.abnormalities.length} 件）</h2>
        {data.abnormalities.length === 0 ? <p>なし</p> : (
          <table className="doc-table">
            <thead><tr><th>報告番号</th><th>設備・内容</th><th>危険度</th><th>状態</th><th>担当・期限</th><th>是正</th><th>再確認・承認</th></tr></thead>
            <tbody>{data.abnormalities.map((a) => <tr key={a.report_no} className={a.overdue ? 'warn' : ''}>
              <td>{a.report_no}<br /><small>{formatDateTime(a.found_at)}</small></td><td>{a.equipment_code} {a.title}</td><td>{SEVERITY_LABELS[a.severity].label}</td>
              <td>{ABNORMALITY_STATUS_LABELS[a.status]}{a.overdue && '（期限超過）'}</td><td>{a.assignee ?? '—'}<br /><small>{a.due_date ?? ''}</small></td>
              <td>{a.actions ?? '—'}<br /><small>{a.corrected_date ?? ''}</small></td>
              <td>{a.verifier ? `${a.verifier}（${formatDateTime(a.verified_at)}）` : '—'}<br />{a.approver ? `${a.approver}（${formatDateTime(a.approved_at)}）` : ''}</td>
            </tr>)}</tbody>
          </table>
        )}

        <h2>5. 取り消した点検（{data.voided.length} 件）</h2>
        {data.voided.length === 0 ? <p>なし</p> : (
          <table className="doc-table">
            <thead><tr><th>点検日</th><th>設備</th><th>取消日時・取消者</th><th>理由</th></tr></thead>
            <tbody>{data.voided.map((v, i) => <tr key={i}><td>{v.inspection_date}</td><td>{v.equipment_code}</td><td>{formatDateTime(v.voided_at)} {v.voided_by ?? ''}</td><td>{v.voided_reason}</td></tr>)}</tbody>
          </table>
        )}
        <footer className="doc-foot">TENQ — Smart Inspection System ／ 出力: {formatDateTime(data.generatedAt)} {data.generatedBy}</footer>
      </div>
    </div>
  );
}
