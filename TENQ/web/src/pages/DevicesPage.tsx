import { useState } from 'react';
import { apiGet, apiSend } from '../api/client';
import { Alert, Button, Loading, PageHeader, errorMessage, useLoad } from '../components/ui';
import { formatDateTime } from '../labels';

interface Device { id: string; device_label: string | null; created_at: string; expires_at: string; last_used_at: string | null; current: boolean }

/** 自分が端末に記憶したログインの一覧。スマホを無くしたときは、別の端末からここで取り消せる */
export function DevicesPage() {
  const { data, error, loading, reload } = useLoad(() => apiGet<{ items: Device[] }>('/auth/devices'), []);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  if (loading && !data) return <Loading />;
  return (
    <>
      <PageHeader title="ログインした端末" sub="「この端末にログインを記憶する」を選んだ端末の一覧です。スマホを無くしたときは、ここで取り消してから管理者に連絡してください。" />
      {error && <Alert kind="error">{error}</Alert>}
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      {data?.items.length === 0 && <p className="empty">ログインを記憶している端末はありません。</p>}
      <ul className="cards">
        {data?.items.map((d) => (
          <li key={d.id} className="panel">
            <b>{d.device_label ?? '端末'}</b>{d.current && <span className="badge st-doing">この端末</span>}
            <p className="small muted">記憶した日時: {formatDateTime(d.created_at)} ／ 期限: {formatDateTime(d.expires_at)} ／ 最終利用: {formatDateTime(d.last_used_at)}</p>
            <Button onClick={async () => {
              try { await apiSend('DELETE', `/auth/devices/${d.id}`); setMsg({ kind: 'success', text: '取り消しました。' }); reload(); }
              catch (e) { setMsg({ kind: 'error', text: errorMessage(e) }); }
            }}>取り消す</Button>
          </li>
        ))}
      </ul>
    </>
  );
}
