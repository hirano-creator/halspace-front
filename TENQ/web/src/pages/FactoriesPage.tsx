import { useState, type FormEvent } from 'react';
import { apiGet, apiSend } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Alert, Button, Field, Loading, PageHeader, errorMessage, fieldErrors, useLoad } from '../components/ui';
import { WEEKDAYS, workingDaysText } from '../labels';

interface Factory { id: string; code: string; name: string; address: string | null; working_days: string; status: string; version: number }
interface Area { id: string; name: string; grid_row: number; grid_col: number; col_span: number; sort_order: number; status: string; version: number }

/**
 * 工場とエリア。工場の追加はシステム管理者、エリアは工場長以上。
 * エリアのドラッグでの配置は、カード一覧と一緒に第6段階で作る。ここでは行・列・横幅を数字で指定する。
 */
export function FactoriesPage() {
  const { can } = useAuth();
  const factories = useLoad(() => apiGet<{ items: Factory[] }>('/factories'), []);
  const [selected, setSelected] = useState<string>('');
  const factoryId = selected || factories.data?.items[0]?.id || '';
  const areas = useLoad(() => (factoryId ? apiGet<{ items: Area[] }>(`/areas?factory=${encodeURIComponent(factoryId)}`) : Promise.resolve({ items: [] })), [factoryId]);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  if (factories.loading && !factories.data) return <Loading />;
  const current = factories.data?.items.find((f) => f.id === factoryId);

  return (
    <>
      <PageHeader title="工場・エリア" sub="エリアは、PC のカード一覧で設備を並べる枠です。あとからいつでも追加・変更できます。" />
      {factories.error && <Alert kind="error">{factories.error}</Alert>}
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}

      <section className="panel">
        <h2>工場</h2>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>コード</th><th>工場名</th><th>稼働曜日</th><th>状態</th><th></th></tr></thead>
            <tbody>
              {factories.data?.items.map((f) => (
                <tr key={f.id} className={f.id === factoryId ? 'row-selected' : ''}>
                  <td className="code">{f.code}</td><td>{f.name}</td><td>{workingDaysText(f.working_days)}</td>
                  <td>{f.status === 'active' ? '稼働' : '無効'}</td>
                  <td><Button onClick={() => setSelected(f.id)} disabled={f.id === factoryId}>エリアを見る</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {can('settings.manage') && <NewFactory onDone={(t) => { setMsg({ kind: 'success', text: t }); factories.reload(); }} />}
      </section>

      {current && (
        <section className="panel">
          <h2>{current.name} のエリア</h2>
          {areas.error && <Alert kind="error">{areas.error}</Alert>}
          <div className="area-preview" aria-label="配置のイメージ">
            {areas.data?.items.filter((a) => a.status === 'active').map((a) => (
              <div key={a.id} className="area-box" style={{ gridRow: a.grid_row + 1, gridColumn: `${a.grid_col + 1} / span ${a.col_span}` }}>{a.name}</div>
            ))}
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>エリア名</th><th>行</th><th>列</th><th>横幅（12列中）</th><th>並び順</th><th>状態</th><th></th></tr></thead>
              <tbody>
                {areas.data?.items.map((a) => <AreaRow key={`${a.id}-${a.version}`} area={a} editable={can('layout.edit', { factoryId })}
                  onDone={(t, ok) => { setMsg({ kind: ok ? 'success' : 'error', text: t }); areas.reload(); }} />)}
              </tbody>
            </table>
          </div>
          {can('layout.edit', { factoryId }) && <NewArea factoryId={factoryId} onDone={(t) => { setMsg({ kind: 'success', text: t }); areas.reload(); }} />}
        </section>
      )}
    </>
  );
}

function AreaRow({ area, editable, onDone }: { area: Area; editable: boolean; onDone: (text: string, ok: boolean) => void }) {
  const [v, setV] = useState(area);
  const changed = JSON.stringify(v) !== JSON.stringify(area);
  const num = (k: keyof Area) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: Number(e.target.value) }));
  const save = async () => {
    try {
      await apiSend('PATCH', `/areas/${area.id}`, { version: area.version, name: v.name, grid_row: v.grid_row, grid_col: v.grid_col, col_span: v.col_span, sort_order: v.sort_order, status: v.status });
      onDone(`「${v.name}」を保存しました。`, true);
    } catch (e) { onDone(errorMessage(e), false); }
  };
  return (
    <tr className={area.status !== 'active' ? 'row-muted' : ''}>
      <td><input aria-label="エリア名" value={v.name} maxLength={40} disabled={!editable} onChange={(e) => setV({ ...v, name: e.target.value })} /></td>
      <td><input aria-label="行" type="number" min={0} max={50} value={v.grid_row} disabled={!editable} onChange={num('grid_row')} className="num" /></td>
      <td><input aria-label="列" type="number" min={0} max={11} value={v.grid_col} disabled={!editable} onChange={num('grid_col')} className="num" /></td>
      <td><input aria-label="横幅" type="number" min={2} max={12} value={v.col_span} disabled={!editable} onChange={num('col_span')} className="num" /></td>
      <td><input aria-label="並び順" type="number" min={0} max={9999} value={v.sort_order} disabled={!editable} onChange={num('sort_order')} className="num" /></td>
      <td>
        <select aria-label="状態" value={v.status} disabled={!editable} onChange={(e) => setV({ ...v, status: e.target.value })}>
          <option value="active">使用中</option><option value="inactive">無効</option>
        </select>
      </td>
      <td>{editable && <Button variant="primary" disabled={!changed} onClick={() => void save()}>保存</Button>}</td>
    </tr>
  );
}

function NewArea({ factoryId, onDone }: { factoryId: string; onDone: (text: string) => void }) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await apiSend('POST', '/areas', { factory_id: factoryId, name, col_span: 4 });
      setName(''); setError(null);
      onDone(`エリア「${name}」を追加しました。`);
    } catch (err) { setError(fieldErrors(err).name ?? errorMessage(err)); }
  };
  return (
    <form className="inline-form" onSubmit={submit}>
      <Field label="エリアを追加" error={error ?? undefined}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例: D棟 組立" maxLength={40} />
      </Field>
      <Button type="submit" disabled={!name.trim()}>追加</Button>
    </form>
  );
}

function NewFactory({ onDone }: { onDone: (text: string) => void }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await apiSend('POST', '/factories', { code, name, working_days: [...days].sort().join(',') });
      setCode(''); setName(''); setErrors({}); setError(null);
      onDone(`工場「${name}」を追加しました。所属する人をユーザー管理で設定してください。`);
    } catch (err) { setErrors(fieldErrors(err)); setError(errorMessage(err)); }
  };
  return (
    <form className="inline-form wrap" onSubmit={submit}>
      {error && <Alert kind="error">{error}</Alert>}
      <Field label="工場コード" error={errors.code}><input value={code} onChange={(e) => setCode(e.target.value)} maxLength={20} placeholder="例: F03" /></Field>
      <Field label="工場名" error={errors.name}><input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} /></Field>
      <fieldset className="days">
        <legend>稼働曜日</legend>
        {WEEKDAYS.map((w, i) => (
          <label key={w} className="chip-check">
            <input type="checkbox" checked={days.includes(i + 1)} onChange={(e) => setDays((d) => (e.target.checked ? [...d, i + 1] : d.filter((x) => x !== i + 1)))} />{w}
          </label>
        ))}
      </fieldset>
      <Button type="submit" disabled={!code.trim() || !name.trim() || !days.length}>工場を追加</Button>
    </form>
  );
}
