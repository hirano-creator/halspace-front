import { useState } from 'react';
import {
  MATCH_FIELDS, MATCH_FIELD_LABELS, ROLES, ROLE_LABELS, SCANS_PER_ITEM, SCANS_PER_ITEM_LABELS,
  type CompanySettings, type Role,
} from '@partsgate/shared';
import { apiGet, apiSend, type Page } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Alert, Button, Dialog, Field, Loading, PageHeader, StatusPill, errorMessage, fieldErrors, fmtDateTime, useLoad } from '../components/ui';

// ===================== ユーザー管理 =====================

interface UserRow { id: number; name: string; email: string | null; role: Role; status: string; last_seen_at: string | null; version: number }

export function UsersPage() {
  const { me } = useAuth();
  const { data, error, reload } = useLoad(() => apiGet<{ items: UserRow[] }>('/users'), []);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  return (
    <>
      <PageHeader title="ユーザー管理" sub="PARTS GATE を使うアカウントです。アカウントの作成・パスワード・PARTS GATE の利用の有効化は Space.app の管理画面で行います。" />
      <div className="flex flex-col gap-3 p-4 lg:p-5">
        <Alert kind="info">Space.app で PARTS GATE の利用を有効にした人が初めて開くと、ここに追加されます（最初は「一般」）。ここでは PARTS GATE 内のロールと利用停止を変えられます。</Alert>
        {notice && <Alert kind="success">{notice}</Alert>}
        {error && <Alert kind="error">{error}</Alert>}
        {!data ? <Loading /> : (
          <div className="card overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>氏名</th><th>メールアドレス</th><th>ロール</th><th>状態</th><th>最終利用</th><th /></tr></thead>
              <tbody>
                {data.items.map((u) => (
                  <tr key={u.id} className={u.status !== 'active' ? 'row-off' : ''}>
                    <td className="font-bold">{u.name}{u.id === me?.user.id && <span className="pill pill-info ml-2">自分</span>}</td>
                    <td className="text-slate-600">{u.email ?? '—'}</td>
                    <td><span className={`pill ${u.role === 'admin' ? 'pill-info' : 'pill-gray'}`}>{ROLE_LABELS[u.role]}</span></td>
                    <td><StatusPill status={u.status} /></td>
                    <td className="text-xs whitespace-nowrap text-slate-500">{fmtDateTime(u.last_seen_at)}</td>
                    <td className="text-right">{u.id !== me?.user.id && <Button size="sm" onClick={() => { setNotice(null); setEditing(u); }}>変更</Button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {editing && <UserForm row={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); setNotice('ユーザーを更新しました。'); reload(); }} />}
    </>
  );
}

function UserForm({ row, onClose, onSaved }: { row: UserRow; onClose: () => void; onSaved: () => void }) {
  const [role, setRole] = useState<Role>(row.role);
  const [status, setStatus] = useState(row.status);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true); setError(null);
    try { await apiSend('PUT', `/users/${row.id}`, { role, status, version: row.version }); onSaved(); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <Dialog open title={`${row.name} さんの設定`} onClose={onClose}
      footer={<><Button onClick={onClose} disabled={busy}>やめる</Button><Button variant="primary" onClick={() => void save()} disabled={busy}>保存する</Button></>}>
      {error && <Alert kind="error">{error}</Alert>}
      <Field label="ロール">
        <select className="input" value={role} onChange={(e) => setRole(e.target.value as Role)}>
          {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}{r === 'admin' ? '（CSV 取込・マスター・設定もできる）' : '（読み取りと閲覧）'}</option>)}
        </select>
      </Field>
      <Field label="利用状態">
        <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="active">利用中</option>
          <option value="suspended">利用停止（PARTS GATE を開けなくなる）</option>
        </select>
      </Field>
    </Dialog>
  );
}

// ===================== システム設定 =====================

export function SettingsPage() {
  const { reload: reloadMe } = useAuth();
  const { data, error } = useLoad(() => apiGet<CompanySettings>('/settings'), []);
  return (
    <>
      <PageHeader title="システム設定" sub="会社ごとの照合ルールです。変更は操作の記録に残ります。" />
      <div className="p-4 lg:p-5">
        {error && <Alert kind="error">{error}</Alert>}
        {!data ? <Loading /> : <SettingsForm initial={data} onSaved={() => void reloadMe()} />}
      </div>
    </>
  );
}

function SettingsForm({ initial, onSaved }: { initial: CompanySettings; onSaved: () => void }) {
  const [s, setS] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true); setMsg(null); setErrors({});
    try {
      const r = await apiSend<CompanySettings>('PUT', '/settings', s);
      setS(r); setMsg({ kind: 'success', text: '設定を保存しました。' }); onSaved();
    } catch (e) { setErrors(fieldErrors(e)); setMsg({ kind: 'error', text: errorMessage(e) }); } finally { setBusy(false); }
  };
  return (
    <div className="card flex max-w-3xl flex-col gap-5 p-5">
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <section className="flex flex-col gap-3.5">
        <h2 className="font-bold">バーコード照合</h2>
        <Field label="照合に使う列" error={errors.match_field} hint="ヒラノの CSV ではどちらも同じ値です（2026-11-05 確認）">
          <select className="input" value={s.match_field} onChange={(e) => setS({ ...s, match_field: e.target.value as CompanySettings['match_field'] })}>
            {MATCH_FIELDS.map((m) => <option key={m} value={m}>{MATCH_FIELD_LABELS[m]}</option>)}
          </select>
        </Field>
        <Field label="ラベルの枚数" error={errors.scans_per_item}>
          <select className="input" value={s.scans_per_item} onChange={(e) => setS({ ...s, scans_per_item: e.target.value as CompanySettings['scans_per_item'] })}>
            {SCANS_PER_ITEM.map((m) => <option key={m} value={m}>{SCANS_PER_ITEM_LABELS[m]}</option>)}
          </select>
        </Field>
        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field label="読み取り値から外す先頭の文字" error={errors.barcode_strip_prefix} hint="リーダーが番号の前に付ける文字（例: ]C1）。なければ空のまま">
            <input className="input mono" maxLength={10} value={s.barcode_strip_prefix} onChange={(e) => setS({ ...s, barcode_strip_prefix: e.target.value })} />
          </Field>
          <Field label="読み取り値から外す末尾の文字" error={errors.barcode_strip_suffix}>
            <input className="input mono" maxLength={10} value={s.barcode_strip_suffix} onChange={(e) => setS({ ...s, barcode_strip_suffix: e.target.value })} />
          </Field>
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={s.warn_ship_date_mismatch} onChange={(e) => setS({ ...s, warn_ship_date_mismatch: e.target.checked })} />
          <span>メーカー出荷日が今日でない明細を読んだら「要確認」にする<span className="block text-xs text-slate-500">オフにすると、別の日の明細も「正常」として照合します</span></span>
        </label>
      </section>
      <section className="flex flex-col gap-3.5 border-t border-slate-200 pt-5">
        <h2 className="font-bold">ログイン</h2>
        <Field label="再ログインまでの時間（時間）" error={errors.reauth_hours} hint="1〜72。これを過ぎると、もう一度ログインしてもらいます">
          <input className="input max-w-40" type="number" min={1} max={72} inputMode="numeric" value={s.reauth_hours} onChange={(e) => setS({ ...s, reauth_hours: Number(e.target.value) })} />
        </Field>
      </section>
      <div className="flex justify-end border-t border-slate-200 pt-4"><Button variant="primary" onClick={() => void save()} disabled={busy}>{busy ? '保存しています…' : '保存する'}</Button></div>
    </div>
  );
}

// ===================== 操作の記録（監査ログ） =====================

interface AuditRow { id: number; action: string; target_type: string | null; target_id: string | null; detail_json: string | null; created_at: string; user_name: string | null }

const ACTION_LABELS: Record<string, string> = {
  'user.first_access': '初めて利用', 'user.update': 'ユーザーの変更', 'settings.update': '設定の変更',
  'staff.create': '担当者の登録', 'staff.update': '担当者の変更', 'locations.create': '置場の登録', 'locations.update': '置場の変更',
  'destinations.create': '納品先の登録', 'destinations.update': '納品先の変更', 'destinations.bulk_create': '納品先のまとめて登録',
  'company.update': '企業情報の変更',
};

export function AuditPage() {
  const [pages, setPages] = useState<AuditRow[][]>([]);
  const [next, setNext] = useState<string | null>(null);
  const first = useLoad(async () => {
    const r = await apiGet<Page<AuditRow>>('/audit-logs?limit=50');
    setPages([r.items]); setNext(r.next_cursor);
    return true;
  }, []);
  const [error, setError] = useState<string | null>(null);
  const more = async () => {
    try { const r = await apiGet<Page<AuditRow>>(`/audit-logs?limit=50&cursor=${next}`); setPages((p) => [...p, r.items]); setNext(r.next_cursor); }
    catch (e) { setError(errorMessage(e)); }
  };
  const rows = pages.flat();
  return (
    <>
      <PageHeader title="操作の記録" sub="CSV 取込・マスターや設定の変更などの記録です。書き換え・削除はできません。" />
      <div className="flex flex-col gap-3 p-4 lg:p-5">
        {(first.error ?? error) && <Alert kind="error">{first.error ?? error}</Alert>}
        {!first.data ? <Loading /> : (
          <div className="card overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>日時</th><th>操作した人</th><th>操作</th><th>対象</th><th>内容</th></tr></thead>
              <tbody>
                {rows.length === 0 && <tr><td colSpan={5} className="py-10 text-center text-slate-500">記録はまだありません。</td></tr>}
                {rows.map((a) => (
                  <tr key={a.id}>
                    <td className="text-xs whitespace-nowrap">{fmtDateTime(a.created_at)}</td>
                    <td className="whitespace-nowrap">{a.user_name ?? '—'}</td>
                    <td className="whitespace-nowrap font-bold">{ACTION_LABELS[a.action] ?? a.action}</td>
                    <td className="mono text-xs">{a.target_type ? `${a.target_type} #${a.target_id ?? ''}` : '—'}</td>
                    <td className="mono max-w-md truncate text-xs text-slate-500" title={a.detail_json ?? ''}>{a.detail_json ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {next && <div className="border-t border-slate-100 p-2 text-center"><Button onClick={more}>さらに表示</Button></div>}
          </div>
        )}
      </div>
    </>
  );
}

// ===================== 企業管理（運営者だけ） =====================

interface CompanyRow { id: number; name: string; code: string; address: string | null; phone: string | null; admin_note: string | null; status: string; user_count: number; last_seen_at: string | null; version: number }

export function CompaniesPage() {
  const { me } = useAuth();
  const { data, error, reload } = useLoad(() => apiGet<{ items: CompanyRow[] }>('/admin/companies'), []);
  const [editing, setEditing] = useState<CompanyRow | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  return (
    <>
      <PageHeader title="企業管理" sub="PARTS GATE を使う会社の一覧です（HaLSpace の運営者だけが見られます）。" />
      <div className="flex flex-col gap-3 p-4 lg:p-5">
        <Alert kind="info">会社そのものは Space.app で作ります。その会社の人が初めて PARTS GATE を開くと、ここに追加されます。利用を停止すると、その会社の人は PARTS GATE を開けなくなります（データは消えません）。</Alert>
        {notice && <Alert kind="success">{notice}</Alert>}
        {error && <Alert kind="error">{error}</Alert>}
        {!data ? <Loading /> : (
          <div className="card overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>ID</th><th>企業名</th><th>企業コード</th><th>電話番号</th><th>利用者</th><th>最終利用</th><th>状態</th><th /></tr></thead>
              <tbody>
                {data.items.map((c) => (
                  <tr key={c.id} className={c.status !== 'active' ? 'row-off' : ''}>
                    <td className="mono">{c.id}</td>
                    <td className="font-bold">{c.name}{c.id === me?.company?.id && <span className="pill pill-info ml-2">自分の会社</span>}</td>
                    <td className="mono">{c.code}</td>
                    <td>{c.phone ?? '—'}</td>
                    <td className="text-right">{c.user_count} 人</td>
                    <td className="text-xs whitespace-nowrap text-slate-500">{fmtDateTime(c.last_seen_at)}</td>
                    <td><StatusPill status={c.status} /></td>
                    <td className="text-right"><Button size="sm" onClick={() => { setNotice(null); setEditing(c); }}>編集</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {editing && <CompanyForm row={editing} own={editing.id === me?.company?.id} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); setNotice('企業情報を更新しました。'); reload(); }} />}
    </>
  );
}

function CompanyForm({ row, own, onClose, onSaved }: { row: CompanyRow; own: boolean; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState({ name: row.name, code: row.code, address: row.address ?? '', phone: row.phone ?? '', admin_note: row.admin_note ?? '', status: row.status });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true); setError(null); setErrors({});
    try {
      await apiSend('PUT', `/admin/companies/${row.id}`, { ...v, address: v.address || null, phone: v.phone || null, admin_note: v.admin_note || null, version: row.version });
      onSaved();
    } catch (e) { setErrors(fieldErrors(e)); setError(errorMessage(e)); } finally { setBusy(false); }
  };
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }));
  return (
    <Dialog open title="企業情報の編集" onClose={onClose}
      footer={<><Button onClick={onClose} disabled={busy}>やめる</Button><Button variant="primary" onClick={() => void save()} disabled={busy}>保存する</Button></>}>
      {error && <Alert kind="error">{error}</Alert>}
      <div className="grid gap-3.5 sm:grid-cols-2">
        <Field label="企業名" required error={errors.name}><input className="input" maxLength={100} value={v.name} onChange={set('name')} /></Field>
        <Field label="企業コード" required error={errors.code}><input className="input mono" maxLength={50} value={v.code} onChange={set('code')} /></Field>
        <Field label="住所" error={errors.address} className="sm:col-span-2"><input className="input" maxLength={200} value={v.address} onChange={set('address')} /></Field>
        <Field label="電話番号" error={errors.phone}><input className="input" maxLength={20} value={v.phone} onChange={set('phone')} /></Field>
        <Field label="利用状態" hint={own ? '自分の会社は停止できません' : undefined}>
          <select className="input" value={v.status} onChange={set('status')} disabled={own}>
            <option value="active">利用中</option><option value="suspended">利用停止</option>
          </select>
        </Field>
        <Field label="管理者情報（担当者名・連絡先など）" error={errors.admin_note} className="sm:col-span-2">
          <textarea className="input" rows={3} maxLength={500} value={v.admin_note} onChange={set('admin_note')} />
        </Field>
      </div>
    </Dialog>
  );
}
