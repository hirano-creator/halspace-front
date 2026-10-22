import { useState } from 'react';
import { ROLES, ROLE_LABELS, type Role } from '@tenq/shared';
import { apiGet, apiSend } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Alert, Button, Loading, PageHeader, ReasonDialog, errorMessage, useLoad } from '../components/ui';
import { formatDateTime } from '../labels';

interface UserRow {
  id: string; name: string; email: string | null; role: Role | null; status: 'active' | 'suspended'; suspended_reason: string | null;
  last_seen_at: string | null; factory_ids: string[]; active_devices: number; version: number;
}

/** ユーザー管理（システム管理者）。アカウントの作成・削除・パスワードは Space.app の管理画面で行う */
export function UsersPage() {
  const { me } = useAuth();
  const { data, error, loading, reload } = useLoad(() => apiGet<{ items: UserRow[] }>('/users'), []);
  const [factories, setFactories] = useState<{ id: string; name: string }[]>([]);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [suspendTarget, setSuspendTarget] = useState<UserRow | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<UserRow | null>(null);
  useLoad(() => apiGet<{ items: { id: string; name: string }[] }>('/factories').then((r) => setFactories(r.items)), []);

  const save = async (u: UserRow, body: Record<string, unknown>, ok: string) => {
    try {
      await apiSend('PATCH', `/users/${u.id}`, { version: u.version, ...body });
      setMsg({ kind: 'success', text: ok });
      reload();
    } catch (e) {
      setMsg({ kind: 'error', text: errorMessage(e) });
      reload();
    }
  };

  if (loading && !data) return <Loading />;

  return (
    <>
      <PageHeader title="ユーザー管理" sub="TENQ のロールと所属工場を設定します。アカウントの追加・パスワードの再発行は Space.app の管理画面で行います。" />
      {error && <Alert kind="error">{error}</Alert>}
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}

      <div className="table-wrap">
        <table className="table users">
          <thead><tr><th>氏名</th><th>ロール</th><th>所属工場</th><th>状態</th><th className="hide-sm">最終利用</th><th>操作</th></tr></thead>
          <tbody>
            {data?.items.map((u) => (
              <tr key={u.id} className={u.status === 'suspended' ? 'row-muted' : ''}>
                <td><b>{u.name}</b><small className="block muted">{u.email}</small></td>
                <td>
                  <select aria-label={`${u.name} のロール`} value={u.role ?? ''} disabled={u.id === me?.user.id}
                    onChange={(e) => void save(u, { role: e.target.value || null }, `${u.name} さんのロールを変更しました。`)}>
                    <option value="">未設定</option>
                    {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                  </select>
                </td>
                <td>
                  {u.role === 'system_admin' ? <span className="muted small">全工場</span> : (
                    <div className="chips">
                      {factories.map((f) => (
                        <label key={f.id} className="chip-check">
                          <input type="checkbox" checked={u.factory_ids.includes(f.id)}
                            onChange={(e) => void save(u, { factory_ids: e.target.checked ? [...u.factory_ids, f.id] : u.factory_ids.filter((x) => x !== f.id) }, `${u.name} さんの所属工場を変更しました。`)} />
                          {f.name}
                        </label>
                      ))}
                    </div>
                  )}
                </td>
                <td>
                  {u.status === 'active' ? <span className="badge st-ok">利用中</span> : <span className="badge st-ng" title={u.suspended_reason ?? ''}>停止中</span>}
                  {u.active_devices > 0 && <small className="block muted">記憶した端末 {u.active_devices}台</small>}
                </td>
                <td className="hide-sm small">{formatDateTime(u.last_seen_at)}</td>
                <td>
                  <div className="button-row">
                    {u.id !== me?.user.id && (u.status === 'active'
                      ? <Button onClick={() => setSuspendTarget(u)}>利用停止</Button>
                      : <Button onClick={() => void save(u, { status: 'active' }, `${u.name} さんの利用停止を解除しました。`)}>停止を解除</Button>)}
                    {u.active_devices > 0 && <Button onClick={() => setRevokeTarget(u)}>端末の記憶を取消</Button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ReasonDialog open={!!suspendTarget} title="利用停止" confirmLabel="利用停止にする" danger
        message={<>{suspendTarget?.name} さんの TENQ の利用を止めます。端末に記憶したログインもすべて取り消されます。<br />端末の紛失・退職の場合は、Space.app 側でもパスワードの再発行を行ってください。</>}
        onClose={() => setSuspendTarget(null)}
        onConfirm={async (reason) => { if (suspendTarget) await save(suspendTarget, { status: 'suspended', suspended_reason: reason }, `${suspendTarget.name} さんを利用停止にしました。`); }} />
      <ReasonDialog open={!!revokeTarget} title="端末のログイン記憶を取り消す" confirmLabel="取り消す" reasonRequired={false}
        message={`${revokeTarget?.name ?? ''} さんが端末に記憶したログインをすべて取り消します。次に開くときはログインが必要になります。`}
        onClose={() => setRevokeTarget(null)}
        onConfirm={async () => {
          if (!revokeTarget) return;
          const r = await apiSend<{ revoked: number }>('POST', `/users/${revokeTarget.id}/revoke-devices`, {});
          setMsg({ kind: 'success', text: `${revokeTarget.name} さんの端末の記憶を ${r.revoked} 件取り消しました。` });
          reload();
        }} />
    </>
  );
}
