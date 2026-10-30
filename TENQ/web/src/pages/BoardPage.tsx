import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { simpleStatus, type BoardStatus, type SimpleStatus } from '@tenq/shared';
import { apiGet, apiSend, apiUpload } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { AuthImage, shrinkPhoto } from '../components/Photo';
import { Alert, Button, Loading, errorMessage, useLoad } from '../components/ui';
import { formatDateTime, formatTime } from '../labels';
import { navigate } from '../router';

/**
 * 管理者のホーム = 工場の見取り図（2026-10-31 簡単化。PC 画面 A 案。requirements §10 Q-15）。
 * 建屋（areas）を実際の配置どおりに並べ、設備を 3 色で出す: ✕ 異常 = 赤 / ○ 正常 = 緑 / まだ = 白の点線。
 * 赤は直すまで消えない（次の日以降も「2日前から」と出す）。右の欄に直っていない異常を常に並べ、
 * 設備を押すと同じ欄に詳細と「直した」が出る。
 * 工場長以上は「配置を編集」で建屋の位置・幅と、設備の置き場所・並びを変えられる。
 */

interface Area { id: string; name: string; grid_row: number; grid_col: number; col_span: number; sort_order: number }
interface OpenAbn { id: string; title: string; description: string | null; found_at: string }
interface Item {
  id: string; equipment_code: string; name: string; status: string; frequency: string; area_id: string | null; board_order: number;
  manager_name: string | null; board_status: BoardStatus; open_abnormalities: number; abnormalities: OpenAbn[];
  inspection: null | { id: string; status: string; inspector_name: string; started_at: string; completed_at: string | null };
}
interface Board { factory: { id: string; name: string }; date: string; workingDay: boolean; lateThreshold: string; areas: Area[]; items: Item[] }

const UNPLACED = '__unplaced__';

/** 異常を見つけた日（日本時間）から今日までの日数の表記 */
function since(foundAt: string, today: string): string {
  const d = new Date(Date.parse(foundAt) + 9 * 3600_000).toISOString().slice(0, 10);
  const days = Math.round((Date.parse(today) - Date.parse(d)) / 86_400_000);
  return days <= 0 ? '今日' : `${days}日前から`;
}

export function BoardPage() {
  const { me, can } = useAuth();
  const [factoryId, setFactoryId] = useState(me?.factories[0]?.id ?? '');
  const board = useLoad(() => apiGet<Board>(`/board?factory=${encodeURIComponent(factoryId)}`), [factoryId]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<{ areas: Area[]; items: Item[] } | null>(null);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const canEdit = can('layout.edit', { factoryId });

  // 自動更新（編集中・「直した」の入力中は止める）。読み直しの関数は描画のたびに変わるので ref で持ち、タイマーを作り直さない。
  // 画面を見ていないとき（別のタブ・最小化・スリープ）は API を呼ばない。開きっぱなしの PC で
  // Workers 無料プランの呼び出し回数（1日 10 万回）を使い切らないため。見える状態に戻ったら、間が空いていればすぐ読み直す
  const refresh = me?.settings.board_refresh_seconds ?? 30;
  const reloadRef = useRef(board.reload);
  useEffect(() => { reloadRef.current = board.reload; });
  useEffect(() => {
    if (editing) return;
    let last = Date.now();
    const tick = () => {
      if (document.hidden) return;
      last = Date.now();
      reloadRef.current();
    };
    const t = setInterval(tick, refresh * 1000);
    const onVisible = () => { if (!document.hidden && Date.now() - last >= refresh * 1000) tick(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVisible); };
  }, [editing, refresh]);

  const data = board.data;
  const areas = useMemo(() => [...(editing && draft ? draft.areas : data?.areas ?? [])].sort((a, b) => a.grid_row - b.grid_row || a.grid_col - b.grid_col), [editing, draft, data]);
  const items = editing && draft ? draft.items : data?.items ?? [];
  const inArea = (areaId: string | null) => items.filter((i) => (i.area_id ?? UNPLACED) === (areaId ?? UNPLACED)).sort((a, b) => a.board_order - b.board_order || a.equipment_code.localeCompare(b.equipment_code));
  const unplaced = inArea(null);
  const areaName = new Map(areas.map((a) => [a.id, a.name]));
  const st = (i: Item) => simpleStatus(i.board_status, i.open_abnormalities);
  const selected = data?.items.find((i) => i.id === selectedId) ?? null;

  function startEdit() {
    if (!data) return;
    setDraft({ areas: data.areas.map((a) => ({ ...a })), items: data.items.map((i) => ({ ...i })) });
    setEditing(true); setSelectedId(null); setMsg(null);
  }

  function moveArea(id: string, patch: (a: Area) => Partial<Area>) {
    setDraft((d) => d && { ...d, areas: d.areas.map((a) => {
      if (a.id !== id) return a;
      const n = { ...a, ...patch(a) };
      n.col_span = Math.max(2, Math.min(12, n.col_span));
      n.grid_col = Math.max(0, Math.min(12 - n.col_span, n.grid_col));
      n.grid_row = Math.max(0, Math.min(50, n.grid_row));
      return n;
    }) });
  }

  /** 設備を area（null = 未配置）の beforeId の前（なければ最後）へ */
  function moveCard(cardId: string, areaId: string | null, beforeId: string | null) {
    setDraft((d) => {
      if (!d) return d;
      const card = d.items.find((i) => i.id === cardId);
      if (!card) return d;
      const others = d.items.filter((i) => i.id !== cardId && (i.area_id ?? UNPLACED) === (areaId ?? UNPLACED)).sort((a, b) => a.board_order - b.board_order);
      const at = beforeId ? Math.max(0, others.findIndex((i) => i.id === beforeId)) : others.length;
      others.splice(at, 0, { ...card, area_id: areaId });
      const order = new Map(others.map((i, idx) => [i.id, idx + 1]));
      return { ...d, items: d.items.map((i) => (order.has(i.id) ? { ...i, area_id: i.id === cardId ? areaId : i.area_id, board_order: order.get(i.id)! } : i)) };
    });
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    try {
      await apiSend('PUT', '/areas/layout', {
        factory_id: factoryId,
        areas: draft.areas.map((a, i) => ({ id: a.id, grid_row: a.grid_row, grid_col: a.grid_col, col_span: a.col_span, sort_order: a.sort_order ?? i })),
        equipment: draft.items.map((i) => ({ id: i.id, area_id: i.area_id, board_order: i.board_order })),
      });
      setEditing(false); setDraft(null); setMsg({ kind: 'success', text: '配置を保存しました。' });
      board.reload();
    } catch (e) { setMsg({ kind: 'error', text: errorMessage(e) }); }
    finally { setSaving(false); }
  }

  const onDrop = (areaId: string | null, beforeId: string | null) => (e: DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    const id = e.dataTransfer.getData('text/plain');
    if (id) moveCard(id, areaId, beforeId);
  };

  const tile = (i: Item) => {
    const s = st(i);
    const sub = s === 'ng' ? `✕ ${since(i.abnormalities[0]?.found_at ?? '', data?.date ?? '')}`
      : s === 'ok' ? `○ ${i.board_status === 'ng' ? '直した' : formatTime(i.inspection?.completed_at)}`
      : s === 'stop' ? (i.status === 'stopped' ? '停止中' : '今日は対象外')
      : i.board_status === 'doing' ? '点検中' : 'まだ';
    return (
      <button key={i.id} type="button" className={`eq eq-${s} ${selectedId === i.id ? 'sel' : ''}`} draggable={editing}
        onDragStart={(e) => { e.dataTransfer.setData('text/plain', i.id); e.dataTransfer.effectAllowed = 'move'; }}
        onDragOver={editing ? (e) => e.preventDefault() : undefined}
        onDrop={editing ? onDrop(i.area_id, i.id) : undefined}
        onClick={() => { if (!editing) setSelectedId(i.id); }}
        aria-label={`${i.equipment_code} ${i.name} ${sub}`}>
        <b>{i.equipment_code} {i.name}</b>
        <small>{sub}</small>
      </button>
    );
  };

  if (board.loading && !data) return <Loading />;
  if (board.error && !data) return <Alert kind="error">{board.error}</Alert>;
  if (!data) return null;
  const count = (s: SimpleStatus) => data.items.filter((i) => st(i) === s).length;
  const ngItems = data.items.filter((i) => st(i) === 'ng')
    .sort((a, b) => (a.abnormalities[0]?.found_at ?? '').localeCompare(b.abnormalities[0]?.found_at ?? ''));

  return (
    <div className="map-page">
      <div className="map-head">
        <h1>{data.factory.name}<small>{data.date}</small></h1>
        {(me?.factories.length ?? 0) > 1 && (
          <select aria-label="工場" value={factoryId} disabled={editing} onChange={(e) => { setFactoryId(e.target.value); setSelectedId(null); }}>
            {me?.factories.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        )}
        <div className="map-sum" aria-label="今日の点検状況">
          <span className="n-ng">✕ 異常<b>{count('ng')}</b></span>
          <span className="n-todo">まだ<b>{count('todo')}</b></span>
          <span className="n-ok">○ 正常<b>{count('ok')}</b></span>
        </div>
        <div className="map-actions">
          {can('inspection.perform') && !editing && <Button onClick={() => navigate('/scan')}>QR を読む</Button>}
          {canEdit && !editing && <Button onClick={startEdit}>配置を編集</Button>}
          {editing && <><Button onClick={() => { setEditing(false); setDraft(null); }} disabled={saving}>やめる</Button><Button variant="primary" onClick={() => void save()} disabled={saving}>{saving ? '保存しています…' : '配置を保存'}</Button></>}
        </div>
      </div>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      {board.error && <Alert kind="warn">最新の状況を読み込めませんでした（前回の表示のままです）。{board.error}</Alert>}
      {!data.workingDay && <Alert kind="info">今日は稼働日ではありません（毎日点検の設備は対象外です）。</Alert>}
      {editing && <Alert kind="info">設備をドラッグして、建屋の間や建屋の中で動かせます。建屋の位置と幅は各建屋の右上のボタンで変えます（横は12列）。最後に「配置を保存」を押してください。</Alert>}

      <div className="map-layout">
        <div className="floor">
          {areas.map((a) => {
            const list = inArea(a.id);
            const ng = list.filter((i) => st(i) === 'ng').length;
            const todo = list.filter((i) => st(i) === 'todo').length;
            return (
              <section key={a.id} className={`bld ${ng ? 'has-ng' : ''} ${editing ? 'editing' : ''}`} style={{ gridRow: a.grid_row + 1, gridColumn: `${a.grid_col + 1} / span ${a.col_span}` }}
                onDragOver={editing ? (e) => e.preventDefault() : undefined} onDrop={editing ? onDrop(a.id, null) : undefined} aria-label={a.name}>
                <h2>
                  {a.name}
                  {editing ? (
                    <span className="area-ctl">
                      <button type="button" aria-label={`${a.name} を上へ`} onClick={() => moveArea(a.id, (x) => ({ grid_row: x.grid_row - 1 }))}>↑</button>
                      <button type="button" aria-label={`${a.name} を下へ`} onClick={() => moveArea(a.id, (x) => ({ grid_row: x.grid_row + 1 }))}>↓</button>
                      <button type="button" aria-label={`${a.name} を左へ`} onClick={() => moveArea(a.id, (x) => ({ grid_col: x.grid_col - 1 }))}>←</button>
                      <button type="button" aria-label={`${a.name} を右へ`} onClick={() => moveArea(a.id, (x) => ({ grid_col: x.grid_col + 1 }))}>→</button>
                      <button type="button" aria-label={`${a.name} の幅を狭く`} onClick={() => moveArea(a.id, (x) => ({ col_span: x.col_span - 1 }))}>幅−</button>
                      <button type="button" aria-label={`${a.name} の幅を広く`} onClick={() => moveArea(a.id, (x) => ({ col_span: x.col_span + 1 }))}>幅＋</button>
                    </span>
                  ) : <small>{ng > 0 && <span className="r">✕ {ng}</span>}まだ {todo}</small>}
                </h2>
                <div className="eqs">{list.map(tile)}{list.length === 0 && <span className="muted small">{editing ? 'ここにドラッグ' : '設備がありません'}</span>}</div>
              </section>
            );
          })}
          {(unplaced.length > 0 || editing) && (
            <section className={`bld unplaced ${editing ? 'editing' : ''}`} style={{ gridColumn: '1 / -1' }} onDragOver={editing ? (e) => e.preventDefault() : undefined} onDrop={editing ? onDrop(null, null) : undefined} aria-label="未配置">
              <h2>未配置 <small>建屋に入っていない設備</small></h2>
              <div className="eqs">{unplaced.map(tile)}{unplaced.length === 0 && <span className="muted small">ここにドラッグすると未配置になります</span>}</div>
            </section>
          )}
          {areas.length === 0 && !editing && <p className="muted">建屋がまだありません。メニューの「工場・建屋」で建屋を作ると、ここに並びます。</p>}
        </div>

        {!editing && (
          <>
            {selected && <div className="side-bg" onClick={() => setSelectedId(null)} aria-hidden="true" />}
            <aside className={`map-side ${selected ? 'has-sel' : ''}`} aria-label={selected ? `${selected.equipment_code} の詳細` : '直っていない異常'}>
              {selected ? (
                <Detail key={selected.id} item={selected} status={st(selected)} area={selected.area_id ? areaName.get(selected.area_id) ?? '' : '未配置'} today={data.date}
                  onClose={() => setSelectedId(null)} onChanged={() => board.reload()} />
              ) : (
                <>
                  <h2>直っていない異常（{ngItems.length}）</h2>
                  {ngItems.length === 0 ? <p className="muted">ありません。</p> : (
                    <ul className="ng-list">
                      {ngItems.map((i) => (
                        <li key={i.id}>
                          <button type="button" onClick={() => setSelectedId(i.id)}>
                            <b>✕ {i.equipment_code} {i.name}</b>
                            <small>{i.area_id ? areaName.get(i.area_id) : '未配置'}・{i.abnormalities.map((a) => a.title).join('、')}・{since(i.abnormalities[0]?.found_at ?? '', data.date)}</small>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="muted small">設備を押すと、ここに詳細が出ます。{refresh}秒ごとに自動で新しくなります。</p>
                </>
              )}
            </aside>
          </>
        )}
      </div>
    </div>
  );
}

interface AbnDetail {
  abnormality: { id: string; version: number; report_no: string; title: string; description: string | null; found_at: string; reporter_name: string; equipment_status: string };
  photos: { id: string; owner_type: string }[];
  permissions: Record<string, boolean>;
}

/** 右の欄の詳細。異常があれば内容と写真、「直した」 */
function Detail({ item, status, area, today, onClose, onChanged }: {
  item: Item; status: SimpleStatus; area: string; today: string; onClose: () => void; onChanged: () => void;
}) {
  const { can } = useAuth();
  const label = { ng: '✕ 異常', ok: item.board_status === 'ng' ? '○ 直した' : '○ 正常', todo: item.board_status === 'doing' ? '点検中' : 'まだ', stop: item.status === 'stopped' ? '停止中' : '今日は対象外' }[status];
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [onClose]);

  return (
    <div className="det">
      <button type="button" className="det-x" onClick={onClose} aria-label="閉じる">×</button>
      <h2>{item.equipment_code} {item.name}</h2>
      <p className="det-where">{area}</p>
      <span className={`det-st det-${status}`}>{label}</span>
      {item.abnormalities.map((a) => <AbnBox key={a.id} abn={a} today={today} onChanged={onChanged} />)}
      {status === 'ng' && item.status === 'active' && can('abnormality.resolve') && <a className="stop-link" href={`#/equipment/${item.id}`}>危ないので設備を止める（設備の画面へ）</a>}
      {status !== 'ng' && (
        <dl className="dl">
          <dt>今日の点検</dt>
          <dd>{item.inspection ? `${item.inspection.inspector_name}（${item.board_status === 'doing' ? `${formatTime(item.inspection.started_at)} 開始` : `${formatTime(item.inspection.completed_at)}`}）` : 'まだ'}</dd>
          {item.manager_name && <><dt>担当</dt><dd>{item.manager_name}</dd></>}
        </dl>
      )}
      <div className="det-links">
        {can('inspection.perform') && item.status === 'active' && !item.inspection && <Button onClick={() => navigate(`/inspect/${item.id}`)}>点検表を開く</Button>}
        {item.inspection && item.board_status !== 'doing' && <a href={`#/inspections/${item.inspection.id}`}>今日の点検記録を見る</a>}
        <a href={`#/equipment/${item.id}`}>この設備の記録・台帳を見る</a>
      </div>
    </div>
  );
}

function AbnBox({ abn, today, onChanged }: { abn: OpenAbn; today: string; onChanged: () => void }) {
  const d = useLoad(() => apiGet<AbnDetail>(`/abnormalities/${encodeURIComponent(abn.id)}`), [abn.id]);
  const [form, setForm] = useState(false);
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [resume, setResume] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const x = d.data?.abnormality;
  const canFix = !!d.data?.permissions.resolve;
  const stopped = x?.equipment_status === 'stopped';

  async function save() {
    if (!x) return;
    if (!text.trim()) { setErr('何をして直したかを書いてください。'); return; }
    setBusy(true); setErr(null);
    try {
      const r = await apiSend<{ correctiveActionId: string }>('POST', `/abnormalities/${x.id}/transition`, { action: 'resolve', version: x.version, description: text.trim(), resume_equipment: stopped && resume });
      // 写真は記録のあとで送る（送れなくても「直した」は記録済み）
      let failed = 0;
      for (const f of files) {
        try { await apiUpload(`/attachments?owner_type=corrective_action&owner_id=${encodeURIComponent(r.correctiveActionId)}`, await shrinkPhoto(f), f.name); } catch { failed++; }
      }
      if (failed) window.alert(`「直した」は記録しました。写真 ${failed} 枚は送れませんでした。`);
      onChanged();
    } catch (e) { setErr(errorMessage(e)); d.reload(); }
    finally { setBusy(false); }
  }

  return (
    <div className="abn-box">
      <dl className="dl">
        <dt>異常の内容</dt><dd><b>{abn.title}</b>{abn.description && <><br />{abn.description}</>}</dd>
        <dt>見つけた人</dt><dd>{x ? `${x.reporter_name}（${formatDateTime(x.found_at)}）` : '…'}</dd>
        <dt>経過</dt><dd className="r">{since(abn.found_at, today)}</dd>
      </dl>
      {!!d.data?.photos.length && <div className="abn-photos">{d.data.photos.map((p) => <AuthImage key={p.id} id={p.id} alt="異常の写真" />)}</div>}
      {err && <Alert kind="error">{err}</Alert>}
      {form ? (
        <div className="fix-form">
          <label className="field">
            <span className="field-label">何をして直したか（一言）</span>
            <input type="text" maxLength={500} value={text} onChange={(e) => setText(e.target.value)} placeholder="例: パッキンを交換した" autoFocus />
          </label>
          <label className="photo-add inline">
            {files.length ? `写真 ${files.length} 枚` : '＋ 直したあとの写真（任意）'}
            <input type="file" accept="image/*" multiple onChange={(e) => { const fs = [...(e.target.files ?? [])]; e.target.value = ''; setFiles((p) => [...p, ...fs].slice(0, 5)); }} />
          </label>
          {stopped && <label className="check-line"><input type="checkbox" checked={resume} onChange={(e) => setResume(e.target.checked)} /> 止めていた設備を動かしてよい</label>}
          <Button variant="primary" className="block big fix-go" disabled={busy} onClick={() => void save()}>{busy ? '記録しています…' : '記録する'}</Button>
          <Button className="block" disabled={busy} onClick={() => { setForm(false); setErr(null); }}>やめる</Button>
        </div>
      ) : canFix && <Button variant="primary" className="block big fix-go" onClick={() => setForm(true)}>○ 直した</Button>}
    </div>
  );
}
