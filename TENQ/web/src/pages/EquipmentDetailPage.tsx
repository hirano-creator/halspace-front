import { useState } from 'react';
import { apiGet, apiSend } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { QrCode, qrUrl } from '../components/QrCode';
import { Alert, Button, Loading, PageHeader, ReasonDialog, useLoad } from '../components/ui';
import { EQUIPMENT_STATUS, FREQUENCY, INSPECTION_STATUS, formatDateTime } from '../labels';
import { currentQuery, navigate } from '../router';

export interface EquipmentDetail {
  id: string; factory_id: string; factory_name: string; equipment_code: string; name: string; location: string | null;
  category: string | null; maker: string | null; model: string | null; manager_user_id: string | null; manager_name: string | null;
  area_id: string | null; area_name: string | null; status: string; status_reason: string | null; frequency: string;
  template_id: string | null; template_name: string | null; notes: string | null; qr_token: string | null; qr_issued_at: string | null;
  created_at: string; updated_at: string; retired_at: string | null; version: number;
}
interface Perms { edit: boolean; editAll: boolean; stop: boolean; retire: boolean; qr: boolean }
interface InspectionSummary { id: string; inspection_date: string; status: string; overall_result: string | null; inspector_name: string; completed_at: string | null; current_revision: number }

type DialogKind = 'stop' | 'resume' | 'retire' | 'qr' | null;

export function EquipmentDetailPage({ id }: { id: string }) {
  const { me, can } = useAuth();
  const fromQr = currentQuery().get('from') === 'qr';
  const history = useLoad(() => apiGet<{ items: InspectionSummary[] }>(`/inspections?equipment=${encodeURIComponent(id)}&limit=10`), [id]);
  const { data, error, loading, reload } = useLoad(() => apiGet<{ item: EquipmentDetail; permissions: Perms }>(`/equipment/${encodeURIComponent(id)}`), [id]);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [done, setDone] = useState<string | null>(null);

  if (loading && !data) return <Loading />;
  if (error && !data) return <Alert kind="error">{error}</Alert>;
  if (!data || !me) return null;
  const { item: e, permissions: p } = data;
  const st = EQUIPMENT_STATUS[e.status];

  const changeStatus = async (status: string, reason: string) => {
    await apiSend('POST', `/equipment/${e.id}/status`, { version: e.version, status, reason: reason || undefined });
    setDone(status === 'retired' ? '廃止にしました。' : status === 'stopped' ? '停止中にしました。' : '稼働に戻しました。');
    reload();
  };

  return (
    <>
      <PageHeader title={`${e.equipment_code} ${e.name}`} sub={<>{e.factory_name}{e.area_name && ` ・ ${e.area_name}`} <span className={`badge ${st?.cls ?? ''}`}>{st?.label ?? e.status}</span></>}
        actions={<>
          {e.status === 'active' && can('inspection.perform', { factoryId: e.factory_id }) && <Button variant="primary" onClick={() => navigate(`/inspect/${e.id}`)}>点検する</Button>}
          {p.edit && e.status !== 'retired' && <Button onClick={() => navigate(`/equipment/${e.id}/edit`)}>編集</Button>}
          <Button onClick={() => navigate('/equipment')}>一覧へ</Button>
        </>} />

      {fromQr && <Alert kind="info">QR コードから開きました。</Alert>}
      {done && <Alert kind="success">{done}</Alert>}
      {e.status === 'stopped' && <Alert kind="warn">この設備は停止中です（点検の対象外）。理由: {e.status_reason ?? '—'}</Alert>}
      {e.status === 'retired' && <Alert kind="warn">この設備は廃止しました（{formatDateTime(e.retired_at)}）。過去の記録は残っています。</Alert>}

      <div className="detail-grid">
        <section className="panel">
          <h2>設備の情報</h2>
          <dl className="dl">
            <dt>設備番号</dt><dd>{e.equipment_code}</dd>
            <dt>設備名</dt><dd>{e.name}</dd>
            <dt>工場</dt><dd>{e.factory_name}</dd>
            <dt>エリア</dt><dd>{e.area_name ?? '未配置'}</dd>
            <dt>設置場所</dt><dd>{e.location ?? '—'}</dd>
            <dt>設備分類</dt><dd>{e.category ?? '—'}</dd>
            <dt>メーカー</dt><dd>{e.maker ?? '—'}</dd>
            <dt>型式</dt><dd>{e.model ?? '—'}</dd>
            <dt>管理担当者</dt><dd>{e.manager_name ?? '—'}</dd>
            <dt>点検頻度</dt><dd>{FREQUENCY[e.frequency] ?? e.frequency}</dd>
            <dt>点検基準</dt><dd>{e.template_name ?? '未設定'}</dd>
            <dt>備考</dt><dd className="pre">{e.notes ?? '—'}</dd>
            <dt>登録日時</dt><dd>{formatDateTime(e.created_at)}</dd>
            <dt>更新日時</dt><dd>{formatDateTime(e.updated_at)}</dd>
            <dt>設備ID</dt><dd className="mono small">{e.id}</dd>
          </dl>
        </section>

        <section className="panel qr-panel">
          <h2>QR コード</h2>
          {e.qr_token ? (
            <>
              <QrCode value={qrUrl(me.settings.qr_base_url, e.qr_token)} size={168} label={`${e.equipment_code} の QR コード`} />
              <p className="small muted">発行: {formatDateTime(e.qr_issued_at)}<br />QR には設備を示す番号だけが入っています。読み取ってもログインしなければ何も見えません。</p>
              {p.qr && e.status !== 'retired' && (
                <div className="button-row">
                  <Button onClick={() => navigate(`/qr?ids=${e.id}&factory=${e.factory_id}`)}>ラベルを印刷</Button>
                  <Button onClick={() => setDialog('qr')}>再発行</Button>
                </div>
              )}
            </>
          ) : <p className="muted">有効な QR コードがありません。</p>}
        </section>

        <section className="panel">
          <h2>最近の点検</h2>
          {history.error && <Alert kind="error">{history.error}</Alert>}
          {history.data?.items.length === 0 && <p className="muted small">点検の記録はまだありません。</p>}
          <ul className="history-list">
            {history.data?.items.map((h) => (
              <li key={h.id}>
                <a href={`#/inspections/${h.id}`}>{h.inspection_date}</a> {h.inspector_name}
                {' '}<span className={`badge ${INSPECTION_STATUS[h.status]?.cls ?? ''}`}>{INSPECTION_STATUS[h.status]?.label}</span>
                {h.overall_result && <> <span className={`badge ${h.overall_result === 'ng' ? 'st-ng' : 'st-ok'}`}>{h.overall_result === 'ng' ? '異常あり' : '異常なし'}</span></>}
                {h.current_revision > 1 && <small className="muted"> 訂正あり</small>}
              </li>
            ))}
          </ul>
        </section>

        {(p.stop || p.retire) && e.status !== 'retired' && (
          <section className="panel">
            <h2>使用状態</h2>
            <div className="button-row">
              {p.stop && e.status === 'active' && <Button onClick={() => setDialog('stop')}>停止中にする</Button>}
              {p.stop && e.status === 'stopped' && <Button onClick={() => setDialog('resume')}>稼働に戻す</Button>}
              {p.retire && <Button variant="danger" onClick={() => setDialog('retire')}>廃止にする</Button>}
            </div>
            <p className="small muted">停止中の設備は点検の対象外になります。廃止すると元に戻せません（過去の記録は残ります）。</p>
          </section>
        )}
      </div>

      <ReasonDialog open={dialog === 'stop'} title="停止中にする" confirmLabel="停止中にする" message={`${e.equipment_code} ${e.name} を停止中にします。`}
        onClose={() => setDialog(null)} onConfirm={(r) => changeStatus('stopped', r)} />
      <ReasonDialog open={dialog === 'resume'} title="稼働に戻す" confirmLabel="稼働に戻す" reasonRequired={false} message="修理などが終わり、点検の対象に戻します。"
        onClose={() => setDialog(null)} onConfirm={(r) => changeStatus('active', r)} />
      <ReasonDialog open={dialog === 'retire'} title="廃止にする" confirmLabel="廃止にする" danger message="廃止すると元に戻せません。過去の点検記録は残ります。"
        onClose={() => setDialog(null)} onConfirm={(r) => changeStatus('retired', r)} />
      <ReasonDialog open={dialog === 'qr'} title="QR コードを再発行" confirmLabel="再発行する"
        message="新しい QR コードを発行します。今のラベルは使えなくなるので、新しいラベルを印刷して張り替えてください。過去の点検記録はそのまま残ります。"
        onClose={() => setDialog(null)} onConfirm={async (r) => { await apiSend('POST', `/equipment/${e.id}/qr`, { reason: r }); setDone('QR コードを再発行しました。新しいラベルを印刷してください。'); reload(); }} />
    </>
  );
}
