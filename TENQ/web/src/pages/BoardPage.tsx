import { useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { simpleStatus, type BoardStatus, type SimpleStatus } from '@tenq/shared';
import { apiGet, apiSend, apiUpload } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { AuthImage, shrinkPhoto } from '../components/Photo';
import { HelpTags } from '../components/Coach';
import { SetupChecklist } from '../components/SetupChecklist';
import { Alert, Button, Loading, errorMessage, useLoad } from '../components/ui';
import { formatDateTime, formatTime } from '../labels';
import { navigate } from '../router';

/**
 * 管理者のホーム = 工場の見取り図（2026-10-31 簡単化。2026-11-03 に C 案「見取り図からすべて操作」へ。requirements §10 Q-15）。
 * 建屋（areas）を実際の配置どおりに並べ、設備を 3 色で出す: ✕ 異常 = 赤 / ○ 正常 = 緑 / まだ = 白の点線。
 * 赤は直すまで消えない（次の日以降も「2日前から」と出す）。右の欄に直っていない異常を常に並べる。
 * 設備を押すと、そのそばに小窓（詳細・「直した」・点検表・記録・QR 印刷）、建屋の名前を押すと建屋の小窓が出る。
 * 工場長以上は「配置を動かす」を押している間だけ、建屋の帯をつかんで動かし、右端の ◢ で幅を変え、設備をつかんで別の建屋へ動かせる。
 * 動かすたびにすぐ保存し、「元に戻す」で 1 つ前に戻せる（保存ボタンの押し忘れをなくすため）。
 */

interface Area { id: string; name: string; grid_row: number; grid_col: number; col_span: number; row_span: number; sort_order: number; version: number }
interface OpenAbn { id: string; title: string; description: string | null; found_at: string }
interface Item {
  id: string; equipment_code: string; name: string; status: string; frequency: string; area_id: string | null; board_order: number; board_x?: number | null; board_y?: number | null; board_w?: number | null; board_h?: number | null; template_id: string | null;
  manager_name: string | null; board_status: BoardStatus; open_abnormalities: number; abnormalities: OpenAbn[];
  inspection: null | { id: string; status: string; inspector_name: string; started_at: string; completed_at: string | null };
}
interface Board { factory: { id: string; name: string }; date: string; workingDay: boolean; lateThreshold: string; areas: Area[]; items: Item[] }
interface Draft { areas: Area[]; items: Item[] }
type Pop = { kind: 'eq' | 'area'; id: string; style: CSSProperties };

const UNPLACED = '__unplaced__';

/** 「？ 使い方」で付ける札（画面にないものは出ない） */
const HELP_TAGS = [
  { target: 'map-sum', name: '今日の数', desc: 'おかしい所・まだ・済みの台数' },
  { target: 'add-eq', name: '設備を足す', desc: '新しい設備を登録する' },
  { target: 'map-lock', name: '配置を動かす', desc: '押している間だけ建屋・設備をドラッグ' },
  { target: 'map-floor', name: '工場の見取り図', desc: '建屋の中に設備。赤＝おかしい／緑＝済み／点線＝まだ。押すと詳しい内容' },
  { target: 'map-side', name: '直っていない異常', desc: '押すと内容と「直した」' },
  { target: 'records', name: '記録', desc: '点検の記録・異常の記録・CSV' },
  { target: 'settings', name: '⚙ 設定', desc: '設備の一覧・QR 印刷・使う人・使い方を見る' },
];
const POP_W = 340;
/** 見取り図の縦の 1 マスの最低の高さ（board.css の .floor の grid-auto-rows と揃える） */
const ROW_UNIT = 40;
/** 建屋の中に好きな位置で置いた設備のタイルの大きさ（board.css の .eq.placed と揃える。はみ出さないように位置を抑える） */
const TILE_W = 132, TILE_H = 62;
/** カードの大きさを変えるときの最小（API の下限より少し大きく。文字が 1 行は読める大きさ） */
const MIN_W = 90, MIN_H = 44;
const tileW = (i: Item) => i.board_w ?? TILE_W;
const tileH = (i: Item) => i.board_h ?? TILE_H;
const placed = (i: Item) => i.area_id !== null && typeof i.board_x === 'number' && typeof i.board_y === 'number';
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** 異常を見つけた日（日本時間）から今日までの日数の表記 */
function since(foundAt: string, today: string): string {
  const d = new Date(Date.parse(foundAt) + 9 * 3600_000).toISOString().slice(0, 10);
  const days = Math.round((Date.parse(today) - Date.parse(d)) / 86_400_000);
  return days <= 0 ? '今日' : `${days}日前から`;
}

/** 縦に何マス使うか（古い API の応答には row_span がないので 3 マスとみなす） */
const rowSpanOf = (a: Area) => a.row_span || 3;

/** ほかの建屋と重なるか（縦・横とも） */
function overlaps(areas: Area[], id: string, n: { row: number; col: number; span: number; rows: number }): boolean {
  return areas.some((x) => x.id !== id
    && n.row < x.grid_row + rowSpanOf(x) && x.grid_row < n.row + n.rows
    && n.col < x.grid_col + x.col_span && x.grid_col < n.col + n.span);
}

/** 一番上の建屋が 0 マス目に来るように詰める（建屋どうしの間のすき間は実際の配置なので残す） */
function packRows(d: Draft): Draft {
  if (!d.areas.length) return d;
  const top = Math.min(...d.areas.map((a) => a.grid_row));
  return top === 0 ? d : { ...d, areas: d.areas.map((a) => ({ ...a, grid_row: a.grid_row - top })) };
}

/** 設備を area（null = 未配置）の beforeId の前（なければ最後）へ */
function moveCard(d: Draft, cardId: string, areaId: string | null, beforeId: string | null): Draft {
  const card = d.items.find((i) => i.id === cardId);
  if (!card) return d;
  const others = d.items.filter((i) => i.id !== cardId && (i.area_id ?? UNPLACED) === (areaId ?? UNPLACED)).sort((a, b) => a.board_order - b.board_order);
  const at = beforeId ? Math.max(0, others.findIndex((i) => i.id === beforeId)) : others.length;
  others.splice(at, 0, { ...card, area_id: areaId });
  const order = new Map(others.map((i, idx) => [i.id, idx + 1]));
  return { ...d, items: d.items.map((i) => (order.has(i.id) ? { ...i, area_id: i.id === cardId ? areaId : i.area_id, board_order: order.get(i.id)! } : i)) };
}

export function BoardPage() {
  const { me, can } = useAuth();
  const [factoryId, setFactoryId] = useState(me?.factories[0]?.id ?? '');
  const board = useLoad(() => apiGet<Board>(`/board?factory=${encodeURIComponent(factoryId)}`), [factoryId]);
  const [pop, setPop] = useState<Pop | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [toast, setToast] = useState<{ text: string; undo: boolean; n: number } | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const undoStack = useRef<Draft[]>([]);
  const toastSeq = useRef(0);
  const saveChain = useRef<Promise<void>>(Promise.resolve());
  const floorRef = useRef<HTMLDivElement>(null);
  /** 設備のタイルをつかんだ位置（タイルの左上から）。落とした場所にタイルの左上を合わせるため */
  const grabRef = useRef({ dx: 0, dy: 0 });
  const layoutRef = useRef<HTMLDivElement>(null);
  const canEdit = can('layout.edit', { factoryId });
  const [helpOpen, setHelpOpen] = useState(false);

  // 自動更新（配置を動かしている間は止める）。読み直しの関数は描画のたびに変わるので ref で持ち、タイマーを作り直さない。
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

  // 小窓は、外を押す・Esc で閉じる
  useEffect(() => {
    if (!pop) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element;
      if (!t.closest('.map-pop, .eq, .bld-name, .ng-list')) setPop(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPop(null); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey); };
  }, [pop]);

  // 「元に戻す」の帯は少しして消す
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 8000);
    return () => clearTimeout(t);
  }, [toast]);

  const data = board.data;
  const view = editing && draft ? draft : data;
  const areas = useMemo(() => [...(view?.areas ?? [])].sort((a, b) => a.grid_row - b.grid_row || a.grid_col - b.grid_col), [view]);
  const items = view?.items ?? [];
  const inArea = (areaId: string | null) => items.filter((i) => (i.area_id ?? UNPLACED) === (areaId ?? UNPLACED)).sort((a, b) => a.board_order - b.board_order || a.equipment_code.localeCompare(b.equipment_code));
  const unplaced = inArea(null);
  const areaName = new Map(areas.map((a) => [a.id, a.name]));
  const st = (i: Item) => simpleStatus(i.board_status, i.open_abnormalities);

  /** 小窓を、押したもののそば（右、入らなければ左）に出す。狭い画面では CSS で右から出す */
  function openPop(kind: Pop['kind'], id: string, anchor: Element | null) {
    const box = layoutRef.current?.getBoundingClientRect();
    const r = anchor?.getBoundingClientRect();
    let style: CSSProperties = {};
    if (box && r) {
      let left = r.right - box.left + 10;
      if (left + POP_W > box.width) left = r.left - box.left - POP_W - 10;
      style = { left: Math.max(0, left), top: Math.max(0, r.top - box.top - 8) };
    }
    setPop({ kind, id, style });
  }

  function startEdit() {
    if (!data) return;
    setDraft({ areas: data.areas.map((a) => ({ ...a })), items: data.items.map((i) => ({ ...i })) });
    undoStack.current = [];
    setEditing(true); setPop(null); setMsg(null);
  }

  function stopEdit() {
    setEditing(false); setDraft(null); setToast(null); setAdding(null);
    undoStack.current = [];
    // 保存が終わってから読み直す（先に読むと、保存前の配置が一瞬戻って見える）
    void saveChain.current.then(() => board.reload());
  }

  /** 保存は順番に 1 つずつ（前の保存が終わる前に次を送ると、古い配置が後から届いて上書きすることがある） */
  function persist(d: Draft) {
    saveChain.current = saveChain.current.then(async () => {
      try {
        await apiSend('PUT', '/areas/layout', {
          factory_id: factoryId,
          areas: d.areas.map((a, i) => ({ id: a.id, grid_row: a.grid_row, grid_col: a.grid_col, col_span: a.col_span, row_span: rowSpanOf(a), sort_order: a.sort_order ?? i })),
          equipment: d.items.map((i) => ({ id: i.id, area_id: i.area_id, board_order: i.board_order, board_x: i.board_x ?? null, board_y: i.board_y ?? null, board_w: i.board_w ?? null, board_h: i.board_h ?? null })),
        });
      } catch (e) {
        setToast(null);
        setMsg({ kind: 'error', text: `配置を保存できませんでした。${errorMessage(e)}` });
      }
    });
  }

  function commit(prev: Draft, next: Draft, label: string) {
    const packed = packRows(next);
    undoStack.current.push(prev);
    setDraft(packed);
    persist(packed);
    setMsg(null);
    setToast({ text: `${label}（保存しました）`, undo: true, n: ++toastSeq.current });
  }

  function undo() {
    const prev = undoStack.current.pop();
    if (!prev) return;
    setDraft(prev);
    persist(prev);
    setToast({ text: '元に戻しました', undo: undoStack.current.length > 0, n: ++toastSeq.current });
  }

  /**
   * 建屋の帯をつかんで動かす（mode = move）／右下の ◢ で幅と高さを変える（mode = size）。
   * 横は 12 列、縦は 1 マス（最低 ROW_UNIT px、中身が入りきらなければ伸びる）のマス目に吸い付く。
   * マスの位置はつかんだ時点のものを使う（動かすとマスの高さが変わり、位置が揺れるため）。
   * ほかの建屋と重なる場所には動かない
   */
  function onAreaDown(e: ReactPointerEvent, a: Area, mode: 'move' | 'size') {
    if (!editing || !draft || e.button !== 0 || !floorRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    const start = draft;
    const fr = floorRef.current.getBoundingClientRect();
    const cs = getComputedStyle(floorRef.current);
    const padL = parseFloat(cs.paddingLeft) || 0, padT = parseFloat(cs.paddingTop) || 0;
    const gap = parseFloat(cs.columnGap) || 0, rowGap = parseFloat(cs.rowGap) || 0;
    const colW = (fr.width - padL - (parseFloat(cs.paddingRight) || 0) + gap) / 12;
    const rows = cs.gridTemplateRows.split(' ').map(parseFloat).filter((n) => !Number.isNaN(n));
    const colAt = (x: number) => Math.floor((x - fr.left - padL) / colW);
    const rowAt = (y: number) => {
      let top = fr.top + padT;
      for (let i = 0; i < rows.length; i++) {
        const bottom = top + rows[i]!;
        if (y < bottom + rowGap / 2) return i;
        top = bottom + rowGap;
      }
      // 一番下のマスより下 = 新しいマス（最低の高さで続いているとみなす）
      return rows.length + Math.max(0, Math.floor((y - top) / (ROW_UNIT + rowGap)));
    };
    const grab = colAt(e.clientX) - a.grid_col;
    const grabRow = rowAt(e.clientY) - a.grid_row;
    let cur = { row: a.grid_row, col: a.grid_col, span: a.col_span, rows: rowSpanOf(a) };
    setDragId(a.id);
    const move = (ev: PointerEvent) => {
      const n = mode === 'move'
        ? { ...cur, col: clamp(colAt(ev.clientX) - grab, 0, 12 - a.col_span), row: clamp(rowAt(ev.clientY) - grabRow, 0, 200 - cur.rows) }
        : { ...cur, span: clamp(colAt(ev.clientX) - a.grid_col + 1, 2, 12 - a.grid_col), rows: clamp(rowAt(ev.clientY) - a.grid_row + 1, 2, 40) };
      if ((n.row === cur.row && n.col === cur.col && n.span === cur.span && n.rows === cur.rows) || overlaps(start.areas, a.id, n)) return;
      cur = n;
      setDraft((d) => d && { ...d, areas: d.areas.map((x) => (x.id === a.id ? { ...x, grid_row: n.row, grid_col: n.col, col_span: n.span, row_span: n.rows } : x)) });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDragId(null);
      if (cur.row === a.grid_row && cur.col === a.grid_col && cur.span === a.col_span && cur.rows === rowSpanOf(a)) return;
      const next = { ...start, areas: start.areas.map((x) => (x.id === a.id ? { ...x, grid_row: cur.row, grid_col: cur.col, col_span: cur.span, row_span: cur.rows } : x)) };
      commit(start, next, mode === 'move' ? `「${a.name}」を動かしました` : `「${a.name}」の大きさを変えました`);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  /**
   * 設備のタイルを落とす。建屋へは「落とした場所」に置く（建屋の中身の幅・高さに対する千分率で保存。
   * 建屋の大きさを変えても比率で付いてくる）。「まだ置いていない設備」へは位置を消して順に並べる
   */
  function dropOn(e: DragEvent, areaId: string | null, beforeId: string | null) {
    e.preventDefault(); e.stopPropagation();
    const id = e.dataTransfer.getData('text/plain');
    const card = draft?.items.find((i) => i.id === id);
    if (!draft || !card) return;
    const label = (to: string | null) => card.area_id === to ? `${card.equipment_code} を動かしました` : `${card.equipment_code} を「${to ? areaName.get(to) ?? '' : 'まだ置いていない設備'}」へ動かしました`;
    if (areaId === null) {
      if (id === beforeId) return;
      const next = moveCard(draft, id, null, beforeId);
      const same = (d: Draft) => d.items.filter((i) => i.area_id === null).sort((a, b) => a.board_order - b.board_order).map((i) => i.id).join();
      if (card.area_id === null && same(next) === same(draft)) return;
      commit(draft, { ...next, items: next.items.map((i) => (i.id === id ? { ...i, board_x: null, board_y: null } : i)) }, label(null));
      return;
    }
    const box = (e.currentTarget as HTMLElement).closest('.bld')?.querySelector('.eqs');
    if (!box) return;
    const r = box.getBoundingClientRect();
    const g = grabRef.current;
    const ratio = (v: number, size: number, tile: number) => Math.round(clamp(v / Math.max(1, size), 0, Math.max(0, size - tile) / Math.max(1, size)) * 1000);
    const x = ratio(e.clientX - g.dx - r.left, r.width, tileW(card));
    const y = ratio(e.clientY - g.dy - r.top, r.height, tileH(card));
    if (card.area_id === areaId && card.board_x === x && card.board_y === y) return;
    const next = card.area_id === areaId ? draft : moveCard(draft, id, areaId, null);
    commit(draft, { ...next, items: next.items.map((i) => (i.id === id ? { ...i, area_id: areaId, board_x: x, board_y: y } : i)) }, label(areaId));
  }

  /**
   * 設備のカードの右下 ◢ で大きさを変える（px）。順に並んでいたカードは、今の場所に置いた扱いにする。
   * カードは HTML のドラッグ（別の建屋へ移す）も持つので、引っぱっている間はそのカードのドラッグを止める
   */
  function onTileResize(e: ReactPointerEvent, i: Item) {
    if (!editing || !draft || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const tile = (e.currentTarget as HTMLElement).closest<HTMLElement>('.eq');
    const box = tile?.closest('.eqs');
    if (!tile || !box) return;
    tile.setAttribute('draggable', 'false');
    const start = draft;
    const tr = tile.getBoundingClientRect(), br = box.getBoundingClientRect();
    const per = (v: number, size: number) => Math.round(clamp(v / Math.max(1, size), 0, 1) * 1000);
    const x0 = placed(i) ? i.board_x! : per(tr.left - br.left, br.width);
    const y0 = placed(i) ? i.board_y! : per(tr.top - br.top, br.height);
    const w0 = Math.round(tr.width), h0 = Math.round(tr.height);
    let cur = { w: w0, h: h0 };
    const apply = (d: Draft): Draft => ({ ...d, items: d.items.map((x) => (x.id === i.id ? { ...x, board_x: x0, board_y: y0, board_w: cur.w, board_h: cur.h } : x)) });
    const move = (ev: PointerEvent) => {
      const n = {
        w: clamp(Math.round(w0 + ev.clientX - e.clientX), MIN_W, Math.max(MIN_W, Math.min(1200, Math.floor(br.width)))),
        h: clamp(Math.round(h0 + ev.clientY - e.clientY), MIN_H, Math.max(MIN_H, Math.min(800, Math.floor(br.height)))),
      };
      if (n.w === cur.w && n.h === cur.h) return;
      cur = n;
      setDraft((d) => d && apply(d));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      tile.setAttribute('draggable', 'true');
      if (cur.w === w0 && cur.h === h0) { setDraft(start); return; }
      commit(start, apply(start), `${i.equipment_code} の大きさを変えました`);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  async function addArea(name: string) {
    if (!draft) return;
    const row = draft.areas.length ? Math.max(...draft.areas.map((a) => a.grid_row + rowSpanOf(a))) : 0;
    try {
      const r = await apiSend<{ id: string }>('POST', '/areas', { factory_id: factoryId, name, grid_row: row, grid_col: 0, col_span: 4, row_span: 3, sort_order: draft.areas.length });
      // 建屋はもう登録済み。「元に戻す」では消さない（消すのは ⚙ の「工場・建屋」から）
      setDraft((d) => d && { ...d, areas: [...d.areas, { id: r.id, name, grid_row: row, grid_col: 0, col_span: 4, row_span: 3, sort_order: d.areas.length, version: 1 }] });
      undoStack.current = undoStack.current.map((d) => ({ ...d, areas: [...d.areas, { id: r.id, name, grid_row: row, grid_col: 0, col_span: 4, row_span: 3, sort_order: d.areas.length, version: 1 }] }));
      setAdding(null);
      setToast({ text: `「${name}」を足しました。帯をつかんで好きな場所へ動かせます`, undo: false, n: ++toastSeq.current });
    } catch (e) { setMsg({ kind: 'error', text: errorMessage(e) }); }
  }

  const tile = (i: Item) => {
    const s = st(i);
    const sub = s === 'ng' ? `✕ ${since(i.abnormalities[0]?.found_at ?? '', data?.date ?? '')}`
      : s === 'ok' ? `○ ${i.board_status === 'ng' ? '直した' : formatTime(i.inspection?.completed_at)}`
      : s === 'stop' ? (i.status === 'stopped' ? '停止中' : '今日は対象外')
      : i.board_status === 'doing' ? '点検中' : 'まだ';
    return (
      <button key={i.id} type="button" data-eq={i.id} className={`eq eq-${s} ${placed(i) ? 'placed' : ''} ${pop?.kind === 'eq' && pop.id === i.id ? 'sel' : ''}`} draggable={editing}
        style={placed(i) ? {
          left: `min(${i.board_x! / 10}%, calc(100% - ${tileW(i)}px))`, top: `min(${i.board_y! / 10}%, calc(100% - ${tileH(i)}px))`,
          width: tileW(i), height: tileH(i),
        } : undefined}
        onDragStart={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          grabRef.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
          e.dataTransfer.setData('text/plain', i.id); e.dataTransfer.effectAllowed = 'move';
        }}
        onDragOver={editing ? (e) => e.preventDefault() : undefined}
        onDrop={editing ? (e) => dropOn(e, i.area_id, i.id) : undefined}
        onClick={(e) => { if (!editing) openPop('eq', i.id, e.currentTarget); }}
        aria-label={`${i.equipment_code} ${i.name} ${sub}`}>
        <b>{i.equipment_code} {i.name}</b>
        <small>{sub}</small>
        {editing && i.area_id !== null && <span className="eq-rz" aria-hidden="true" title="引っぱって大きさを変える" onPointerDown={(e) => onTileResize(e, i)} />}
      </button>
    );
  };

  if (board.loading && !data) return <Loading />;
  if (board.error && !data) return <Alert kind="error">{board.error}</Alert>;
  if (!data) return null;
  const count = (s: SimpleStatus) => data.items.filter((i) => st(i) === s).length;
  const ngItems = data.items.filter((i) => st(i) === 'ng')
    .sort((a, b) => (a.abnormalities[0]?.found_at ?? '').localeCompare(b.abnormalities[0]?.found_at ?? ''));
  const popItem = pop?.kind === 'eq' ? data.items.find((i) => i.id === pop.id) : undefined;
  const popArea = pop?.kind === 'area' ? data.areas.find((a) => a.id === pop.id) : undefined;
  const areaMenu = canEdit || can('equipment.create', { factoryId }) || can('qr.issue', { factoryId });

  return (
    <div className={`map-page ${editing ? 'is-editing' : ''}`}>
      <div className="map-head">
        <h1>{data.factory.name}<small>{data.date}</small></h1>
        {(me?.factories.length ?? 0) > 1 && (
          <select aria-label="工場" value={factoryId} disabled={editing} onChange={(e) => { setFactoryId(e.target.value); setPop(null); }}>
            {me?.factories.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        )}
        <div className="map-sum" aria-label="今日の点検状況" data-tour="map-sum">
          <span className="n-ng">✕ 異常<b>{count('ng')}</b></span>
          <span className="n-todo">まだ<b>{count('todo')}</b></span>
          <span className="n-ok">○ 正常<b>{count('ok')}</b></span>
        </div>
        <div className="map-actions">
          {can('inspection.perform') && !editing && <Button data-tour="scan" onClick={() => navigate('/scan')}>QR を読む</Button>}
          {can('equipment.create', { factoryId }) && !editing && <Button data-tour="add-eq" onClick={() => navigate(`/equipment/new?factory=${encodeURIComponent(factoryId)}`)}>＋ 設備を足す</Button>}
          {canEdit && (editing
            ? <Button variant="primary" className="map-lock" data-tour="map-lock" onClick={stopEdit}>🔒 固定する</Button>
            : <Button className="map-lock" data-tour="map-lock" onClick={startEdit}>🔓 配置を動かす</Button>)}
          {!editing && <Button className="help-btn" onClick={() => setHelpOpen(true)}>？ 使い方</Button>}
        </div>
      </div>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      {board.error && <Alert kind="warn">最新の状況を読み込めませんでした（前回の表示のままです）。{board.error}</Alert>}
      {!data.workingDay && <Alert kind="info">今日は稼働日ではありません（毎日点検の設備は対象外です）。</Alert>}
      {editing && (
        <div className="map-edit-hint" role="status">
          🔓 配置を動かせます。建屋は <b>⠿ の帯</b>をつかんで動かし、右下の <b>◢</b> を引っぱると幅と高さが変わります。設備はタイルをつかんで、建屋の中の好きな場所へ（タイルの右下の ◢ で大きさも変わります）。
          動かすとすぐ保存されます。終わったら「🔒 固定する」を押してください。
        </div>
      )}

      <div className="map-layout" ref={layoutRef}>
        <div className="map-main">
          <div className={`floor ${editing ? 'editing' : ''}`} ref={floorRef} data-tour="map-floor">
            {areas.map((a) => {
              const list = inArea(a.id);
              const ng = list.filter((i) => st(i) === 'ng').length;
              const todo = list.filter((i) => st(i) === 'todo').length;
              return (
                <section key={a.id} className={`bld ${ng ? 'has-ng' : ''} ${editing ? 'editing' : ''} ${dragId === a.id ? 'dragging' : ''}`}
                  style={{ gridRow: `${a.grid_row + 1} / span ${rowSpanOf(a)}`, gridColumn: `${a.grid_col + 1} / span ${a.col_span}` }}
                  onDragOver={editing ? (e) => e.preventDefault() : undefined} onDrop={editing ? (e) => dropOn(e, a.id, null) : undefined} aria-label={a.name}>
                  <h2 className={editing ? 'bld-grab' : ''} onPointerDown={editing ? (e) => onAreaDown(e, a, 'move') : undefined}
                    title={editing ? 'つかんで動かす' : undefined}>
                    {editing ? <span className="bld-title"><span className="bld-grip" aria-hidden="true">⠿</span>{a.name}</span>
                      : areaMenu ? <button type="button" className="bld-name" onClick={(e) => openPop('area', a.id, e.currentTarget)}>{a.name}</button>
                      : <span className="bld-title">{a.name}</span>}
                    <small>{ng > 0 && <span className="r">✕ {ng}</span>}まだ {todo}</small>
                  </h2>
                  <div className="eqs">{list.map(tile)}{list.length === 0 && <span className="muted small">{editing ? 'ここに設備をドラッグ' : '設備がありません'}</span>}</div>
                  {editing && <span className="bld-rz" aria-hidden="true" title="引っぱって幅と高さを変える" onPointerDown={(e) => onAreaDown(e, a, 'size')} />}
                </section>
              );
            })}
            {areas.length === 0 && !editing && <p className="muted">建屋がまだありません。{canEdit ? '「🔓 配置を動かす」→「＋ 建屋を足す」で作ると、ここに並びます。' : ''}</p>}
          </div>

          {(unplaced.length > 0 || editing) && (
            <section className={`map-tray ${editing ? 'editing' : ''}`} aria-label="まだ置いていない設備"
              onDragOver={editing ? (e) => e.preventDefault() : undefined} onDrop={editing ? (e) => dropOn(e, null, null) : undefined}>
              <h2>
                まだ置いていない設備
                <small>{editing ? 'ここから建屋へドラッグ。建屋から外すときはここへ' : canEdit ? '「🔓 配置を動かす」で建屋へ置けます' : ''}</small>
                {editing && adding === null && <Button className="tray-add" data-tour="add-area" onClick={() => setAdding('')}>＋ 建屋を足す</Button>}
              </h2>
              {editing && adding !== null && (
                <form className="tray-form" onSubmit={(e) => { e.preventDefault(); if (adding.trim()) void addArea(adding.trim()); }}>
                  <input type="text" aria-label="新しい建屋の名前" maxLength={40} placeholder="建屋の名前（例: D棟 塗装）" value={adding} onChange={(e) => setAdding(e.target.value)} autoFocus />
                  <Button type="submit" variant="primary" disabled={!adding.trim()}>足す</Button>
                  <Button onClick={() => setAdding(null)}>やめる</Button>
                </form>
              )}
              <div className="eqs">{unplaced.map(tile)}{unplaced.length === 0 && <span className="muted small">全部の設備が建屋に入っています</span>}</div>
            </section>
          )}
        </div>

        <aside className="map-side" aria-label="直っていない異常" data-tour="map-side">
          <h2>直っていない異常（{ngItems.length}）</h2>
          {ngItems.length === 0 ? <p className="muted">ありません。</p> : (
            <ul className="ng-list">
              {ngItems.map((i) => (
                <li key={i.id}>
                  <button type="button" disabled={editing} onClick={() => {
                    const t = document.querySelector(`[data-eq="${i.id}"]`);
                    t?.scrollIntoView({ block: 'nearest' });
                    openPop('eq', i.id, t);
                  }}>
                    <b>✕ {i.equipment_code} {i.name}</b>
                    <small>{i.area_id ? areaName.get(i.area_id) : '未配置'}・{i.abnormalities.map((a) => a.title).join('、')}・{since(i.abnormalities[0]?.found_at ?? '', data.date)}</small>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="muted small">設備を押すと、そのそばに詳しい内容と「直した」が出ます。建屋の名前を押すと、建屋の操作が出ます。{refresh}秒ごとに自動で新しくなります。</p>
        </aside>

        {pop && (popItem || popArea) && <div className="side-bg" onClick={() => setPop(null)} aria-hidden="true" />}
        {popItem && (
          <div className="map-pop" role="dialog" aria-label={`${popItem.equipment_code} の詳細`} style={pop?.style}>
            <Detail key={popItem.id} item={popItem} status={st(popItem)} factoryId={factoryId}
              area={popItem.area_id ? areaName.get(popItem.area_id) ?? '' : '未配置'} today={data.date}
              onClose={() => setPop(null)} onChanged={() => board.reload()} />
          </div>
        )}
        {popArea && (
          <div className="map-pop" role="dialog" aria-label={`${popArea.name} の操作`} style={pop?.style}>
            <AreaMenu area={popArea} factoryId={factoryId} itemIds={inArea(popArea.id).map((i) => i.id)} canEdit={canEdit}
              onClose={() => setPop(null)} onChanged={() => board.reload()} onMove={startEdit} />
          </div>
        )}
      </div>

      {canEdit && <SetupChecklist areas={data.areas.length} items={data.items.length}
        inspectedToday={data.items.some((i) => !!i.inspection?.completed_at)} canQr={can('qr.issue', { factoryId })} />}
      {helpOpen && <HelpTags onClose={() => setHelpOpen(false)} tags={HELP_TAGS} />}

      {toast && (
        <div className="map-toast" role="status" key={toast.n}>
          <span>{toast.text}</span>
          {toast.undo && editing && <button type="button" onClick={undo}>元に戻す</button>}
        </div>
      )}
    </div>
  );
}

/** 建屋の小窓: 名前を変える・この建屋に設備を足す・QR をまとめて印刷・場所や大きさを変える */
function AreaMenu({ area, factoryId, itemIds, canEdit, onClose, onChanged, onMove }: {
  area: Area; factoryId: string; itemIds: string[]; canEdit: boolean; onClose: () => void; onChanged: () => void; onMove: () => void;
}) {
  const { can } = useAuth();
  const [name, setName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function rename() {
    if (!name?.trim()) return;
    setBusy(true); setErr(null);
    try {
      await apiSend('PATCH', `/areas/${encodeURIComponent(area.id)}`, { version: area.version, name: name.trim() });
      setName(null);
      onChanged();
    } catch (e) { setErr(errorMessage(e)); }
    finally { setBusy(false); }
  }

  return (
    <div className="det">
      <button type="button" className="det-x" onClick={onClose} aria-label="閉じる">×</button>
      <h2>{area.name}</h2>
      <p className="det-where">設備 {itemIds.length} 台</p>
      {err && <Alert kind="error">{err}</Alert>}
      {name !== null ? (
        <form className="fix-form" onSubmit={(e) => { e.preventDefault(); void rename(); }}>
          <label className="field">
            <span className="field-label">新しい名前</span>
            <input type="text" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </label>
          <Button type="submit" variant="primary" className="block" disabled={busy || !name.trim()}>{busy ? '変えています…' : '名前を変える'}</Button>
          <Button className="block" disabled={busy} onClick={() => setName(null)}>やめる</Button>
        </form>
      ) : (
        <div className="pop-acts">
          {canEdit && <button type="button" onClick={() => setName(area.name)}>✏ 名前を変える</button>}
          {can('equipment.create', { factoryId }) && <button type="button" onClick={() => navigate(`/equipment/new?factory=${encodeURIComponent(factoryId)}&area=${encodeURIComponent(area.id)}`)}>＋ この建屋に設備を足す</button>}
          {can('qr.issue', { factoryId }) && itemIds.length > 0 && <button type="button" onClick={() => navigate(`/qr?factory=${encodeURIComponent(factoryId)}&ids=${itemIds.map(encodeURIComponent).join(',')}`)}>🏷 この建屋の QR ラベルをまとめて印刷</button>}
          {canEdit && <button type="button" onClick={onMove}>↔ 場所・大きさを変える</button>}
        </div>
      )}
    </div>
  );
}

interface AbnDetail {
  abnormality: { id: string; version: number; report_no: string; title: string; description: string | null; found_at: string; reporter_name: string; equipment_status: string };
  photos: { id: string; owner_type: string }[];
  permissions: Record<string, boolean>;
}

/** 設備の小窓。異常があれば内容と写真、「直した」。この設備でできることもここから */
function Detail({ item, status, factoryId, area, today, onClose, onChanged }: {
  item: Item; status: SimpleStatus; factoryId: string; area: string; today: string; onClose: () => void; onChanged: () => void;
}) {
  const { can } = useAuth();
  const label = { ng: '✕ 異常', ok: item.board_status === 'ng' ? '○ 直した' : '○ 正常', todo: item.board_status === 'doing' ? '点検中' : 'まだ', stop: item.status === 'stopped' ? '停止中' : '今日は対象外' }[status];

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
        {item.template_id && can('template.edit') && <a href={`#/templates/${item.template_id}`}>点検する項目を変える</a>}
        {can('qr.issue', { factoryId }) && <a href={`#/qr?factory=${encodeURIComponent(factoryId)}&ids=${encodeURIComponent(item.id)}`}>QR ラベルを印刷</a>}
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
