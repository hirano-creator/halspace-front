import { useState, type FormEvent } from 'react';
import { apiGet, apiSend } from '../api/client';
import { Alert, Button, Field, Loading, PageHeader, errorMessage, fieldErrors, useLoad } from '../components/ui';
import { formatDateTime } from '../labels';

/** 監査ログ（S-14）とシステム設定（S-13） */

const ACTION_LABELS: Record<string, string> = {
  'inspection.start': '点検の開始', 'inspection.complete': '点検の完了', 'inspection.void': '点検の取消', 'inspection.correct': '点検記録の訂正', 'inspection.takeover': '点検の引き継ぎ',
  'abnormality.report': '異常の報告', 'abnormality.assign': '担当・期限の決定', 'abnormality.start': '対応の開始', 'abnormality.correct': '是正の記録',
  'abnormality.verify': '再確認', 'abnormality.reject': '差し戻し', 'abnormality.approve': '承認',
  'equipment.create': '設備の登録', 'equipment.update': '設備の編集', 'equipment.stop': '設備の停止', 'equipment.resume': '設備の再開', 'equipment.retire': '設備の廃止',
  'qr.reissue': 'QR の再発行', 'template.create': '点検基準の作成', 'template.publish': '点検基準の公開', 'layout.update': '配置の変更',
  'area.create': 'エリアの作成', 'area.update': 'エリアの変更', 'factory.create': '工場の追加', 'factory.update': '工場の変更',
  'user.update': '利用者の設定', 'user.first_access': '初回の利用', 'device.remember': 'ログインの記憶', 'device.logout': 'ログアウト', 'device.revoke': '端末の取り消し', 'device.revoke_all': '端末の一括取り消し',
  'attachment.upload': '写真の追加', 'attachment.delete': '写真の削除', 'export.csv': 'CSV の出力', 'report.print': '帳票の出力', 'settings.update': '設定の変更',
};

interface LogRow { id: number; created_at: string; action: string; target_type: string | null; target_id: string | null; detail: Record<string, unknown> | null; ip: string | null; actor_name: string | null; factory_name: string | null }

export function AuditLogPage() {
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [applied, setApplied] = useState('');
  const page = useLoad(() => apiGet<{ items: LogRow[]; nextCursor: string | null }>(`/audit-logs?limit=100${applied}`), [applied]);
  const [more, setMore] = useState<{ key: string; rows: LogRow[]; cursor: string | null } | null>(null);
  const extra = more?.key === applied ? more : null;
  const rows = page.data ? [...page.data.items, ...(extra?.rows ?? [])] : [];
  const cursor = extra ? extra.cursor : page.data?.nextCursor ?? null;
  const [open, setOpen] = useState<number | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const p = new URLSearchParams();
    if (action) p.set('action', action);
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    setApplied(p.toString() ? `&${p}` : '');
  };

  return (
    <>
      <PageHeader title="操作の記録（監査ログ）" sub="誰が・いつ・何をしたかの記録です。この記録は変更・削除できません。" />
      <form className="panel search-form" onSubmit={submit}>
        <div className="form-grid compact">
          <Field label="操作">
            <select value={action} onChange={(e) => setAction(e.target.value)}>
              <option value="">すべて</option>
              <option value="inspection">点検</option><option value="abnormality">異常・是正</option><option value="equipment">設備</option>
              <option value="template">点検基準</option><option value="user">利用者</option><option value="device">ログイン・端末</option>
              <option value="export">CSV の出力</option><option value="report">帳票の出力</option><option value="settings">設定</option>
            </select>
          </Field>
          <Field label="開始日"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="終了日"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        </div>
        <div className="button-row end"><Button type="submit" variant="primary">絞り込む</Button></div>
      </form>
      {page.error && <Alert kind="error">{page.error}</Alert>}
      {page.loading && !page.data ? <Loading /> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>日時</th><th>操作した人</th><th>操作</th><th className="hide-sm">工場</th><th>内容</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="small">{formatDateTime(r.created_at)}</td>
                  <td>{r.actor_name ?? '—'}</td>
                  <td>{ACTION_LABELS[r.action] ?? r.action}</td>
                  <td className="hide-sm">{r.factory_name ?? '—'}</td>
                  <td className="small">
                    {r.detail && <button type="button" className="link" onClick={() => setOpen(open === r.id ? null : r.id)}>{open === r.id ? '閉じる' : '詳しく'}</button>}
                    {open === r.id && <pre className="detail-json">{JSON.stringify(r.detail, null, 2)}</pre>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <p className="empty">記録はありません。</p>}
        </div>
      )}
      {cursor && <div className="more"><Button onClick={async () => {
        const r = await apiGet<{ items: LogRow[]; nextCursor: string | null }>(`/audit-logs?limit=100${applied}&cursor=${cursor}`);
        setMore({ key: applied, rows: [...(extra?.rows ?? []), ...r.items], cursor: r.nextCursor });
      }}>さらに読み込む</Button></div>}
    </>
  );
}

type Settings = Record<string, number | string>;
type Spec = { kind: 'int'; min: number; max: number; label: string } | { kind: 'time'; label: string } | { kind: 'text'; max: number; label: string };

const HINTS: Record<string, string> = {
  retention_years: '記録を保存する期間です。期間を過ぎても自動では削除しません（docs/operations.md §5）。品質管理担当者と決めてください。',
  late_threshold: '毎日点検の設備を、この時刻を過ぎても点検していなければ「遅れ」と表示します。',
  board_refresh_seconds: 'カード一覧を自動で読み直す間隔です。',
  photo_max_count: '異常 1 件に付けられる写真の枚数です。',
  device_login_days: 'スマホでログインを記憶する日数です。過ぎるとログインし直しになります。',
  reauth_hours: 'Space.app のログインで使っているとき、この時間ごとにログインし直しになります。',
  high_severity_message: '危険度「高」の異常を報告するときに表示する文です。会社の安全管理ルールに合わせてください。',
};

export function SettingsPage() {
  const { data, error, loading, reload } = useLoad(() => apiGet<{ settings: Settings; editable: Record<string, Spec> }>('/settings'), []);
  const [form, setForm] = useState<Settings | null>(null);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  if (loading && !data) return <Loading />;
  if (error || !data) return <Alert kind="error">{error ?? '設定を読み込めませんでした。'}</Alert>;
  const values = form ?? data.settings;

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!data) return;
    const body = Object.fromEntries(Object.keys(data.editable).map((k) => [k, data.editable[k]!.kind === 'int' ? Number(values[k]) : values[k]]));
    try { await apiSend('PUT', '/settings', body); setMsg({ kind: 'success', text: '設定を保存しました。変更は操作の記録に残ります。' }); setErrors({}); setForm(null); reload(); }
    catch (err) { setMsg({ kind: 'error', text: errorMessage(err) }); setErrors(fieldErrors(err)); }
  }

  return (
    <>
      <PageHeader title="システム設定" sub="会社全体の設定です（システム管理者だけが変更できます）。" />
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <form className="panel form" onSubmit={save}>
        {Object.entries(data.editable).map(([key, spec]) => (
          <Field key={key} label={spec.label} error={errors[key]} hint={HINTS[key]}>
            {spec.kind === 'text'
              ? <textarea rows={3} maxLength={spec.max} value={String(values[key] ?? '')} onChange={(e) => setForm({ ...values, [key]: e.target.value })} />
              : <input type={spec.kind === 'time' ? 'time' : 'number'} min={spec.kind === 'int' ? spec.min : undefined} max={spec.kind === 'int' ? spec.max : undefined}
                  value={String(values[key] ?? '')} onChange={(e) => setForm({ ...values, [key]: e.target.value })} />}
          </Field>
        ))}
        <Field label="QR コードの宛先" hint="印刷済みの QR が読めなくなるため、画面からは変更できません（docs/architecture.md §4-3）。">
          <input value={String(data.settings.qr_base_url)} disabled />
        </Field>
        <div className="button-row end"><Button type="submit" variant="primary" disabled={!form}>保存する</Button></div>
      </form>
    </>
  );
}
