import { useState } from 'react';
import { apiDownload, apiGet } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Alert, Button, Field, PageHeader, errorMessage, useLoad } from '../components/ui';
import { navigate } from '../router';

/** CSV 出力・帳票（S-10）。出力はすべて監査ログに残る */

const jstToday = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date());

export function ReportsPage() {
  const { me } = useAuth();
  const [factory, setFactory] = useState(me?.factories[0]?.id ?? '');
  const [from, setFrom] = useState(jstToday().slice(0, 8) + '01');
  const [to, setTo] = useState(jstToday());
  const [month, setMonth] = useState(jstToday().slice(0, 7));
  const [equipmentId, setEquipmentId] = useState('');
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const equipment = useLoad(() => apiGet<{ items: { id: string; equipment_code: string; name: string }[] }>(`/equipment?limit=200&factory=${encodeURIComponent(factory)}`), [factory]);

  async function download(kind: string, path: string, name: string) {
    setBusy(kind); setMsg(null);
    try { await apiDownload(path, name); setMsg({ kind: 'success', text: `${name} を出力しました。出力したことは操作の記録に残ります。` }); }
    catch (e) { setMsg({ kind: 'error', text: errorMessage(e) }); }
    finally { setBusy(null); }
  }
  const range = `from=${from}&to=${to}&factory=${encodeURIComponent(factory)}`;

  return (
    <>
      <PageHeader title="CSV 出力・帳票" sub="CSV は Excel でそのまま開けます（文字化けしない形式）。1回に出せるのは 10,000 行までです。" />
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}

      <section className="panel">
        <h2>対象</h2>
        <div className="form-grid compact">
          {(me?.factories.length ?? 0) > 1 && (
            <Field label="工場"><select value={factory} onChange={(e) => setFactory(e.target.value)}>{me?.factories.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></Field>
          )}
          <Field label="開始日"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="終了日"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        </div>
      </section>

      <div className="report-grid">
        <section className="panel">
          <h2>点検記録 CSV</h2>
          <p className="small muted">期間内の点検を、点検項目ごとに1行で出力します（訂正がある場合は最新の内容）。</p>
          <Button variant="primary" disabled={!!busy} onClick={() => void download('i', `/exports/inspections.csv?${range}`, 'TENQ_点検記録.csv')}>{busy === 'i' ? '出力しています…' : 'CSV を出力'}</Button>
        </section>
        <section className="panel">
          <h2>異常・是正処置 CSV</h2>
          <p className="small muted">期間内に見つかった異常と、その是正処置・再確認・承認を1件1行で出力します。</p>
          <Button variant="primary" disabled={!!busy} onClick={() => void download('a', `/exports/abnormalities.csv?${range}`, 'TENQ_異常・是正処置.csv')}>{busy === 'a' ? '出力しています…' : 'CSV を出力'}</Button>
        </section>
        <section className="panel">
          <h2>設備台帳 CSV</h2>
          <p className="small muted">工場の設備台帳を出力します（廃止した設備を除く）。</p>
          <Button variant="primary" disabled={!!busy} onClick={() => void download('e', `/exports/equipment.csv?factory=${encodeURIComponent(factory)}`, 'TENQ_設備台帳.csv')}>{busy === 'e' ? '出力しています…' : 'CSV を出力'}</Button>
        </section>
        <section className="panel">
          <h2>ISO 監査向けの記録一覧（印刷）</h2>
          <p className="small muted">期間内の点検の実施状況、訂正の履歴と理由、使った点検基準の版、異常と是正処置、取消をまとめた一覧です。</p>
          <Button disabled={!factory} onClick={() => navigate(`/print/audit?${range}`)}>印刷用の画面を開く</Button>
        </section>
        <section className="panel">
          <h2>月間点検表（印刷）</h2>
          <p className="small muted">設備ごとに、点検項目 × 日付の表で1か月分を印刷します（紙の点検表と同じ形）。</p>
          <div className="form-grid compact">
            <Field label="設備">
              <select value={equipmentId} onChange={(e) => setEquipmentId(e.target.value)}>
                <option value="">選んでください</option>
                {equipment.data?.items.map((e) => <option key={e.id} value={e.id}>{e.equipment_code} {e.name}</option>)}
              </select>
            </Field>
            <Field label="月"><input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></Field>
          </div>
          <Button disabled={!equipmentId} onClick={() => navigate(`/print/monthly?equipment=${equipmentId}&month=${month}`)}>印刷用の画面を開く</Button>
        </section>
      </div>
    </>
  );
}
