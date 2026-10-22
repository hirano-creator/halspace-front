import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { BOARD_STATUSES, BOARD_STATUS_LABELS, type BoardStatus } from '@tenq/shared';
import { apiGet, apiSend } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Alert, Button, Loading, errorMessage, useLoad } from '../components/ui';
import { formatTime } from '../labels';
import { navigate } from '../router';

/**
 * PC のエリア別カード一覧（requirements F-7・F-12、モック C 案）。
 * 工場の棟・ラインごとの枠に設備カードを並べ、状態の色・アイコン・文字で今日の点検状況を示す。
 * 工場長以上は「配置を編集」で枠の位置・幅と、カードの置き場所・並びを変えられる。
 */

interface Area { id: string; name: string; grid_row: number; grid_col: number; col_span: number; sort_order: number }
interface Item {
  id: string; equipment_code: string; name: string; status: string; frequency: string; area_id: string | null; board_order: number;
  manager_name: string | null; board_status: BoardStatus; open_abnormalities: number;
  inspection: null | { id: string; status: string; inspector_name: string; started_at: string; completed_at: string | null };
}
interface Board { factory: { id: string; name: string }; date: string; workingDay: boolean; lateThreshold: string; areas: Area[]; items: Item[]; counts: Partial<Record<BoardStatus, number>> }

const ICON: Record<BoardStatus, string> = { late: '⏱', ng: '⚠', doing: '◔', todo: '○', ok: '✓', stop: '⦸' };
const UNPLACED = '__unplaced__';

export function BoardPage() {
  const { me, can } = useAuth();
  const [factoryId, setFactoryId] = useState(me?.factories[0]?.id ?? '');
  const board = useLoad(() => apiGet<Board>(`/board?factory=${encodeURIComponent(factoryId)}`), [factoryId]);
  const [filter, setFilter] = useState<BoardStatus | 'all'>('all');
  const [selected, setSelected] = useState<Item | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<{ areas: Area[]; items: Item[] } | null>(null);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const canEdit = can('layout.edit', { factoryId });

  // 自動更新（編集中は止める）。読み直しの関数は描画のたびに変わるので ref で持ち、タイマーを作り直さない
  const refresh = me?.settings.board_refresh_seconds ?? 30;
  const reloadRef = useRef(board.reload);
  useEffect(() => { reloadRef.current = board.reload; });
  useEffect(() => {
    if (editing) return;
    const t = setInterval(() => reloadRef.current(), refresh * 1000);
    return () => clearInterval(t);
  }, [editing, refresh]);

  const data = board.data;
  const areas = useMemo(() => [...(editing && draft ? draft.areas : data?.areas ?? [])].sort((a, b) => a.grid_row - b.grid_row || a.grid_col - b.grid_col), [editing, draft, data]);
  const items = editing && draft ? draft.items : data?.items ?? [];
  const inArea = (areaId: string | null) => items.filter((i) => (i.area_id ?? UNPLACED) === (areaId ?? UNPLACED)).sort((a, b) => a.board_order - b.board_order || a.equipment_code.localeCompare(b.equipment_code));
  const unplaced = inArea(null);

  function startEdit() {
    if (!data) return;
    setDraft({ areas: data.areas.map((a) => ({ ...a })), items: data.items.map((i) => ({ ...i })) });
    setEditing(true); setSelected(null); setMsg(null);
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

  /** カードを area（null = 未配置）の beforeId の前（なければ最後）へ */
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

  const card = (i: Item) => {
    const st = BOARD_STATUS_LABELS[i.board_status];
    const dim = filter !== 'all' && i.board_status !== filter;
    const sub = i.inspection
      ? (i.board_status === 'doing' ? `${i.inspection.inspector_name} 点検中` : `${formatTime(i.inspection.completed_at)} ${i.inspection.inspector_name}`)
      : i.board_status === 'stop' ? (i.status === 'stopped' ? '停止中' : '今日は対象外') : `期限 ${i.frequency === 'daily' ? data?.lateThreshold ?? '' : '期間内'}`;
    return (
      <button key={i.id} type="button" className={`mc st-${i.board_status} ${dim ? 'dim' : ''}`} draggable={editing}
        onDragStart={(e) => { e.dataTransfer.setData('text/plain', i.id); e.dataTransfer.effectAllowed = 'move'; }}
        onDragOver={editing ? (e) => e.preventDefault() : undefined}
        onDrop={editing ? onDrop(i.area_id, i.id) : undefined}
        onClick={() => { if (!editing) setSelected(i); }}
        aria-label={`${i.equipment_code} ${i.name} ${st.label}`}>
        <span className="mc-top"><span className="mc-code">{i.equipment_code}</span>{i.open_abnormalities > 0 && <span className="mc-abn" title="未完了の異常">⚠ {i.open_abnormalities}</span>}</span>
        <span className="mc-name">{i.name}</span>
        <span className="mc-st"><span aria-hidden="true">{ICON[i.board_status]}</span>{st.short}</span>
        <span className="mc-sub">{sub}</span>
      </button>
    );
  };

  if (board.loading && !data) return <Loading />;
  if (board.error && !data) return <Alert kind="error">{board.error}</Alert>;
  if (!data) return null;
  const c = data.counts;
  const target = data.items.filter((i) => i.board_status !== 'stop').length;
  const done = (c.ok ?? 0) + (c.ng ?? 0);

  return (
    <div className="board">
      <div className="board-head">
        <div>
          <h1 className="page-title">カード一覧 <small>{data.factory.name} ・ {data.date}</small></h1>
          <p className="page-sub">今日の点検の状況です。{refresh}秒ごとに自動で更新します。{!data.workingDay && '今日は稼働日ではありません。'}</p>
        </div>
        <div className="page-actions">
          {(me?.factories.length ?? 0) > 1 && (
            <select aria-label="工場" value={factoryId} disabled={editing} onChange={(e) => setFactoryId(e.target.value)}>
              {me?.factories.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          )}
          {canEdit && !editing && <Button onClick={startEdit}>配置を編集</Button>}
          {editing && <><Button onClick={() => { setEditing(false); setDraft(null); }} disabled={saving}>やめる</Button><Button variant="primary" onClick={() => void save()} disabled={saving}>{saving ? '保存しています…' : '配置を保存'}</Button></>}
        </div>
      </div>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      {editing && <Alert kind="info">カードをドラッグして、エリアの間やエリアの中で動かせます。エリアの位置と幅は各エリアの右上のボタンで変えます（横は12列）。最後に「配置を保存」を押してください。</Alert>}

      <div className="chips" role="group" aria-label="状態で絞り込む">
        <button type="button" className={`chip ${filter === 'all' ? 'on' : ''}`} onClick={() => setFilter('all')}>すべて <b>{data.items.length}</b></button>
        {BOARD_STATUSES.map((s) => (
          <button key={s} type="button" className={`chip st-${s} ${filter === s ? 'on' : ''}`} onClick={() => setFilter(filter === s ? 'all' : s)} aria-pressed={filter === s}>
            <span aria-hidden="true">{ICON[s]}</span>{BOARD_STATUS_LABELS[s].label} <b>{c[s] ?? 0}</b>
          </button>
        ))}
        <span className="board-progress">完了 {done} / {target} 台</span>
      </div>

      <div className="floor">
        {areas.map((a) => {
          const list = inArea(a.id);
          const aDone = list.filter((i) => i.board_status === 'ok' || i.board_status === 'ng').length;
          const aTarget = list.filter((i) => i.board_status !== 'stop').length;
          return (
            <section key={a.id} className={`area ${editing ? 'editing' : ''}`} style={{ gridRow: a.grid_row + 1, gridColumn: `${a.grid_col + 1} / span ${a.col_span}` }}
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
                ) : <small>{aDone} / {aTarget} 台 完了</small>}
              </h2>
              {!editing && aTarget > 0 && <div className="meter" aria-hidden="true">{BOARD_STATUSES.map((s) => { const n = list.filter((i) => i.board_status === s).length; return n ? <span key={s} className={`st-${s}`} style={{ width: `${(n / list.length) * 100}%` }} /> : null; })}</div>}
              <div className="cards">{list.map(card)}{list.length === 0 && <span className="muted small">{editing ? 'ここにドラッグ' : '設備がありません'}</span>}</div>
            </section>
          );
        })}
        {(unplaced.length > 0 || editing) && (
          <section className={`area unplaced ${editing ? 'editing' : ''}`} style={{ gridColumn: '1 / -1' }} onDragOver={editing ? (e) => e.preventDefault() : undefined} onDrop={editing ? onDrop(null, null) : undefined} aria-label="未配置">
            <h2>未配置 <small>エリアに入っていない設備</small></h2>
            <div className="cards">{unplaced.map(card)}{unplaced.length === 0 && <span className="muted small">ここにドラッグすると未配置になります</span>}</div>
          </section>
        )}
        {areas.length === 0 && !editing && <p className="muted">エリアがまだありません。「工場・エリア」でエリアを作ると、ここに枠が並びます。</p>}
      </div>

      {selected && <Drawer item={selected} onClose={() => setSelected(null)} canInspect={can('inspection.perform', { factoryId })} />}
      <Stats factoryId={factoryId} />
    </div>
  );
}

function Drawer({ item, onClose, canInspect }: { item: Item; onClose: () => void; canInspect: boolean }) {
  const st = BOARD_STATUS_LABELS[item.board_status];
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [onClose]);
  return (
    <>
      <div className="drawer-bg" onClick={onClose} aria-hidden="true" />
      <aside className={`drawer st-${item.board_status}`} role="dialog" aria-label={`${item.equipment_code} ${item.name}`}>
        <div className="drawer-head">
          <button type="button" className="drawer-x" onClick={onClose} aria-label="閉じる">×</button>
          <span className="muted small">{item.equipment_code}</span>
          <h2>{item.name}</h2>
          <span className={`badge st-${item.board_status}`}>{ICON[item.board_status]} {st.label}</span>
        </div>
        <dl className="dl">
          <dt>今日の点検</dt><dd>{item.inspection ? `${item.inspection.inspector_name}（${item.board_status === 'doing' ? `${formatTime(item.inspection.started_at)} 開始` : `${formatTime(item.inspection.completed_at)} 完了`}）` : 'まだ'}</dd>
          <dt>管理担当</dt><dd>{item.manager_name ?? '—'}</dd>
          <dt>未完了の異常</dt><dd>{item.open_abnormalities ? `${item.open_abnormalities} 件` : 'なし'}</dd>
        </dl>
        <div className="drawer-actions">
          {canInspect && item.status === 'active' && <Button variant="primary" onClick={() => navigate(`/inspect/${item.id}`)}>点検表を開く</Button>}
          {item.inspection && item.board_status !== 'doing' && <Button onClick={() => navigate(`/inspections/${item.inspection!.id}`)}>今日の点検記録</Button>}
          <Button onClick={() => navigate(`/equipment/${item.id}`)}>設備の詳細</Button>
          {item.open_abnormalities > 0 && <Button onClick={() => navigate(`/abnormalities?view=open`)}>異常の一覧</Button>}
          <Button onClick={() => navigate(`/abnormalities/new?equipment=${item.id}`)}>異常を報告</Button>
        </div>
      </aside>
    </>
  );
}

interface StatsData { from: string; to: string; byInspector: { name: string; completed: number; ng: number; days: number }[]; byCategory: { category: string; completed: number; ng: number; equipment: number }[] }

/** 直近30日の集計（点検者別・設備分類別） */
function Stats({ factoryId }: { factoryId: string }) {
  const s = useLoad(() => apiGet<StatsData>(`/stats?factory=${encodeURIComponent(factoryId)}`), [factoryId]);
  if (!s.data) return null;
  return (
    <section className="panel stats">
      <h2>直近30日の集計 <small className="muted">{s.data.from} 〜 {s.data.to}</small></h2>
      <div className="stats-grid">
        <table className="table">
          <caption>点検者別</caption>
          <thead><tr><th>点検者</th><th>点検数</th><th>異常あり</th><th>点検した日数</th></tr></thead>
          <tbody>{s.data.byInspector.map((r) => <tr key={r.name}><td>{r.name}</td><td>{r.completed}</td><td>{r.ng ?? 0}</td><td>{r.days}</td></tr>)}</tbody>
        </table>
        <table className="table">
          <caption>設備分類別</caption>
          <thead><tr><th>分類</th><th>設備</th><th>点検数</th><th>異常あり</th></tr></thead>
          <tbody>{s.data.byCategory.map((r) => <tr key={r.category}><td>{r.category}</td><td>{r.equipment}</td><td>{r.completed}</td><td>{r.ng ?? 0}</td></tr>)}</tbody>
        </table>
      </div>
    </section>
  );
}
