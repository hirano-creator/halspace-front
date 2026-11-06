import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type CompositionEvent, type KeyboardEvent } from 'react';
import { toCsv } from '@partsgate/shared';
import { ApiError, apiGet, apiSend, saveBlob, type Page } from '../api/client';
import { Alert, Button, Field, Loading, errorMessage } from '../components/ui';
import { deviceId, deviceLabel, getWorkSession, setDeviceLabel, setWorkSession, subscribeWorkSession, type WorkSession } from '../scan/session';
import { play, unlockSound } from '../scan/sound';

/**
 * バーコード読み取り（置場別チェック）。docs/scan-matching.md、モック _mock-c-compact.html。
 * 担当者を選ぶ → 読み取りバーでリーダーの入力を受ける → API が判定 → 結果をバーと一覧の行で示す。
 */
export function ScanPage() {
  const session = useSyncExternalStore(subscribeWorkSession, getWorkSession);
  return session ? <ScanBoard session={session} /> : <StaffSelect />;
}

// ===================== 担当者を選ぶ =====================

interface StaffRow { id: number; code: string; name: string; department: string | null }

function StaffSelect() {
  const [staff, setStaff] = useState<StaffRow[] | null>(null);
  const [label, setLabel] = useState(deviceLabel);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    apiGet<Page<StaffRow>>('/staff?status=active&limit=200').then((r) => setStaff(r.items)).catch((e: unknown) => setError(errorMessage(e)));
  }, []);
  const choose = async (s: StaffRow) => {
    unlockSound(); // ボタンを押した操作のうちに音を使えるようにする
    setBusy(true); setError(null);
    try {
      setDeviceLabel(label);
      const r = await apiSend<WorkSession>('POST', '/work-sessions', { staff_id: s.id, device_id: deviceId(), device_label: label.trim() || null });
      setWorkSession({ id: r.id, staff: r.staff });
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 p-4 lg:p-8">
      <div>
        <h1 className="text-2xl font-bold">担当者を選んでください</h1>
        <p className="text-sm text-slate-500">読み取りの記録には、ここで選んだ人の名前が残ります。交代するときは画面の「担当者を変える」を押してください。</p>
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      {!staff ? <Loading /> : staff.length === 0 ? (
        <Alert kind="warn">担当者が登録されていません。管理者に「担当者管理」で登録してもらってください。</Alert>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {staff.map((s) => (
            <button key={s.id} type="button" disabled={busy} onClick={() => void choose(s)}
              className="card flex min-h-24 flex-col items-start justify-center gap-0.5 px-4 py-3 text-left hover:border-slate-500 hover:bg-slate-50 disabled:opacity-50">
              <span className="text-xl font-bold">{s.name}</span>
              <span className="text-xs text-slate-500">{s.code}{s.department ? `・${s.department}` : ''}</span>
            </button>
          ))}
        </div>
      )}
      <Field label="この PC の名前（任意）" hint="読み取りの記録の「使用端末」に残ります。例: 出荷場PC1">
        <input className="input max-w-xs" maxLength={50} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="出荷場PC1" />
      </Field>
    </div>
  );
}

// ===================== 読み取り（置場別チェック） =====================

type ResultKind = 'ok' | 'not_found' | 'duplicate' | 'over_quantity' | 'review' | 'error';
interface ScanItem {
  id: number; global_no: string; status: string; matched_at: string | null; matched_staff_name: string | null; product_code: string; product_name: string; quantity: number; location_id: number | null; location_code: string;
  location_name: string | null; customer_name: string | null; destination_name: string | null; slip_no: string; slip_total: number; slip_matched: number;
}
interface ScanResponse {
  scan_id: number; result: ResultKind; message: string; barcode: string; input: string; scanned_at: string; staff_name: string; replay: boolean;
  item: ScanItem | null; previous: { scanned_at: string; staff_name: string } | null;
}
interface ShownResult { kind: 'ok' | 'dup' | 'rv' | 'nf'; label: string; message: string; barcode: string; item: ScanItem | null; moved: boolean; manual: boolean; at: number }
interface BoardItem {
  id: number; global_no: string; ssd: string | null; vrd: string | null; ship_method: string | null; product_code: string; location_code: string;
  quantity: number; unit_weight: number | null; total_weight: number | null; status: string; matched_at: string | null; matched_staff_name: string | null;
  customer_name: string | null; destination_name: string | null;
}
interface Tab { location_id: number; code: string; name: string; total: number; done: number; qty: number; weight: number }
interface Board { vrd: string; location_id: number; tabs: Tab[]; items: BoardItem[]; truncated: boolean }
interface Today { total: number; ok: number; duplicate: number; review: number; error: number }

type Mode = 'ready' | 'stopped' | 'manual' | 'busy-staff';

const LABELS: Record<ResultKind, { kind: ShownResult['kind']; label: string; sound: 'ok' | 'warn' | 'error' }> = {
  ok: { kind: 'ok', label: '正常', sound: 'ok' },
  duplicate: { kind: 'dup', label: '読み取り済み', sound: 'warn' },
  over_quantity: { kind: 'nf', label: '数量超過', sound: 'error' },
  review: { kind: 'rv', label: '要確認', sound: 'warn' },
  not_found: { kind: 'nf', label: '未登録', sound: 'error' },
  error: { kind: 'nf', label: 'エラー', sound: 'error' },
};

const fmtTime = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(Date.parse(iso) + 9 * 3_600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCMonth() + 1)}/${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
};
const md = (ymd: string | null) => (ymd ? `${ymd.slice(5, 7)}/${ymd.slice(8, 10)}` : '');
const newScanId = () => crypto.randomUUID().replace(/-/g, '');

/** 送信の失敗（通信）だけは、同じ読み取り ID で待ってから送り直す（docs/scan-matching.md §6） */
const RETRY_WAIT_MS = [2000, 5000, 10000];
const QUEUE_MAX = 20;

function ScanBoard({ session }: { session: WorkSession }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<Mode>('ready');
  const [result, setResult] = useState<ShownResult | null>(null);
  const [sending, setSending] = useState(0);
  const [dates, setDates] = useState<{ today: string; items: { vrd: string; total: number; pending: number }[] } | null>(null);
  const [vrd, setVrd] = useState<string | null>(null);
  const [locationId, setLocationId] = useState(0);
  const [board, setBoard] = useState<Board | null>(null);
  const [boardError, setBoardError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'todo' | 'done'>('all');
  const [todoFirst, setTodoFirst] = useState(false);
  const [full, setFull] = useState(false);
  const [hit, setHit] = useState<{ id: number; kind: 'hit' | 'hitdup' } | null>(null);
  const [today, setToday] = useState<Today | null>(null);
  const queue = useRef<{ id: string; raw: string; input: 'scanner' | 'manual'; at: string }[]>([]);
  const running = useRef(false);
  const keyTimes = useRef<number[]>([]);
  const pendingEnter = useRef(false); // 日本語入力の確定に使われた Enter（確定し終わったら送る）
  const locRef = useRef(0);
  const [tick, setTick] = useState(0); // 一覧の読み直し（読み取りのあとに 1 増やす）
  useEffect(() => { locRef.current = locationId; }, [locationId]);

  const focus = useCallback(() => { setTimeout(() => inputRef.current?.focus(), 0); }, []);

  const loadToday = useCallback(() => { apiGet<Today>('/scans/today').then(setToday).catch(() => { /* 件数だけなので出さない */ }); }, []);

  useEffect(() => {
    apiGet<{ today: string; items: { vrd: string; total: number; pending: number }[] }>('/scan-board/dates').then((d) => {
      setDates(d);
      // 既定の納期: 今日以降で照合待ちがある最初の日 → 今日 → いちばん新しい日
      const pick = d.items.find((x) => x.vrd >= d.today && x.pending > 0)?.vrd ?? d.items.find((x) => x.vrd === d.today)?.vrd ?? d.items[d.items.length - 1]?.vrd ?? d.today;
      setVrd(pick);
    }).catch((e: unknown) => setBoardError(errorMessage(e)));
    loadToday();
  }, [loadToday]);
  // ---- 一覧（納期・置場・読み直しの回数が変わったら読み直す） ----
  useEffect(() => {
    if (!vrd) return;
    let alive = true;
    apiGet<Board>(`/scan-board?vrd=${vrd}${locationId ? `&location_id=${locationId}` : ''}`)
      .then((b) => {
        if (!alive) return;
        setBoard(b); setBoardError(null);
        if (!locationId) setLocationId(b.location_id);
      })
      .catch((e: unknown) => { if (alive) setBoardError(errorMessage(e)); });
    return () => { alive = false; };
  }, [vrd, locationId, tick]);

  // ---- 読み取りの送信（順番待ちで 1 件ずつ） ----
  const show = useCallback((r: ScanResponse, manual: boolean) => {
    const L = LABELS[r.result];
    const moved = !!r.item?.location_id && r.item.location_id !== locRef.current;
    let message = r.message;
    if (r.result === 'duplicate' && r.previous) message = `${fmtTime(r.previous.scanned_at).slice(6, 11)} に ${r.previous.staff_name} さんがチェック済みです`;
    setResult({ kind: L.kind, label: L.label, message, barcode: r.barcode, item: r.item, moved, manual, at: Date.now() });
    play(L.sound);
    if (r.item) {
      setHit({ id: r.item.id, kind: r.result === 'ok' ? 'hit' : 'hitdup' });
      // 一覧の読み直しを待たずに、読んだ行をその場でチェック済みにする（件数は読み直しで合わせる）
      const it = r.item;
      setBoard((bd) => bd && { ...bd, items: bd.items.map((x) => (x.id === it.id ? { ...x, status: it.status, matched_at: it.matched_at, matched_staff_name: it.matched_staff_name } : x)) });
      // 別の置場の部品なら、その置場のタブに切り替える
      if (moved && r.item.location_id) setLocationId(r.item.location_id);
      else setTick((t) => t + 1);
    } else setHit(null);
  }, []);

  const pump = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      while (queue.current.length) {
        const q = queue.current[0]!;
        setSending(queue.current.length);
        let res: ScanResponse | null = null;
        for (let attempt = 0; ; attempt++) {
          try {
            res = await apiSend<ScanResponse>('POST', '/scans', { work_session_id: session.id, client_scan_id: q.id, raw_value: q.raw, input: q.input, client_scanned_at: q.at });
            break;
          } catch (e) {
            if (e instanceof ApiError && e.status === 409) {
              // 担当者の選択が切れた。読み取りを止めて選び直してもらう
              queue.current = [];
              setWorkSession(null);
              return;
            }
            if (e instanceof ApiError && e.status === 0 && attempt < RETRY_WAIT_MS.length) {
              setResult({ kind: 'nf', label: '通信を再試行中', message: `通信できません。${RETRY_WAIT_MS[attempt]! / 1000} 秒後に送り直します（${attempt + 1}/${RETRY_WAIT_MS.length}）`, barcode: q.raw, item: null, moved: false, manual: false, at: Date.now() });
              await new Promise((r) => setTimeout(r, RETRY_WAIT_MS[attempt]));
              continue;
            }
            setResult({ kind: 'nf', label: 'エラー', message: e instanceof ApiError && e.status === 0
              ? '通信できません。この読み取りは保存されていない可能性があります。もう一度読み取ってください'
              : errorMessage(e), barcode: q.raw, item: null, moved: false, manual: false, at: Date.now() });
            play('error');
            break;
          }
        }
        queue.current.shift();
        if (res) show(res, q.input === 'manual');
      }
    } finally {
      running.current = false;
      setSending(0);
      loadToday();
    }
  }, [session.id, show, loadToday]);

  const submit = (raw: string, input: 'scanner' | 'manual') => {
    const v = raw.trim();
    if (!v) return;
    if (queue.current.length >= QUEUE_MAX) {
      setResult({ kind: 'nf', label: '送信待ちがいっぱいです', message: '通信の回復を待っています。少し待ってから読み取ってください', barcode: v, item: null, moved: false, manual: false, at: Date.now() });
      play('error');
      return;
    }
    queue.current.push({ id: newScanId(), raw: v, input, at: new Date().toISOString() });
    void pump();
  };

  // ---- 読み取り欄（見えない入力欄。リーダーはキーボードとして文字を送り、最後に Enter） ----
  const finishInput = (el: HTMLInputElement) => {
    const raw = el.value;
    el.value = '';
    // 文字の間隔が平均 30ms 未満ならリーダー、それより遅ければ手入力（docs/scan-matching.md §1）
    const t = keyTimes.current;
    keyTimes.current = [];
    const avg = t.length > 1 ? (t[t.length - 1]! - t[0]!) / (t.length - 1) : 0;
    const input = mode === 'manual' || avg >= 30 ? 'manual' : 'scanner';
    if (mode === 'manual') setMode('ready');
    submit(raw, input);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // 日本語入力がオンだと、リーダーの文字は変換中の文字になり、最後の Enter は「確定」に使われる。
    // そのまま無視すると読み取りが送られず入力欄にたまるので、確定し終わった時点で送る（onCompositionEnd）
    if (e.nativeEvent.isComposing || e.keyCode === 229) {
      if (e.code === 'Enter' || e.code === 'NumpadEnter') pendingEnter.current = true;
      else keyTimes.current.push(performance.now());
      return;
    }
    if (e.key === 'Escape' && mode === 'manual') { e.currentTarget.value = ''; setMode('ready'); return; }
    if (e.key !== 'Enter') { keyTimes.current.push(performance.now()); return; }
    e.preventDefault();
    finishInput(e.currentTarget);
  };
  const onCompositionEnd = (e: CompositionEvent<HTMLInputElement>) => {
    if (!pendingEnter.current) return;
    pendingEnter.current = false;
    finishInput(e.currentTarget);
  };

  const changeStaff = async () => {
    setMode('busy-staff');
    try { await apiSend('POST', `/work-sessions/${session.id}/end`, {}); } catch { /* 終わらせられなくても選び直しはできる */ }
    setWorkSession(null);
  };

  // ---- 表示 ----
  // 選んだ置場は、一覧の読み直しを待たずにすぐ表示に使う（別の置場の部品を読んだときにタブがすぐ切り替わるように）
  const currentLoc = locationId || board?.location_id || 0;
  const tab = board?.tabs.find((t) => t.location_id === currentLoc);
  let rows = board?.items ?? [];
  if (filter === 'todo') rows = rows.filter((r) => r.status !== 'matched');
  if (filter === 'done') rows = rows.filter((r) => r.status === 'matched');
  if (todoFirst) rows = [...rows].sort((a, b) => Number(a.status === 'matched') - Number(b.status === 'matched'));
  const all = board?.items ?? [];
  const done = all.filter((r) => r.status === 'matched').length;
  const totalAll = board?.tabs.reduce((s, t) => s + t.total, 0) ?? 0;
  const doneAll = board?.tabs.reduce((s, t) => s + t.done, 0) ?? 0;

  // 読んだ行をその位置まで見せる
  useEffect(() => {
    if (!hit) return;
    document.getElementById(`scan-row-${hit.id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [hit, board]);

  const barClass = mode === 'stopped' ? 'stopped' : mode === 'busy-staff' ? 'paused' : mode === 'manual' ? 'manual' : result ? result.kind : 'idle';
  const saveCsv = () => {
    if (!board || !tab) return;
    const csv = toCsv(['グローバル番号', 'メーカー出荷日(SSD)', 'ミスミ納期(VRD)', '出荷方法', '商品コード', '置場', '数量', '個別重量', '商品重量', 'チェック者', 'チェック時間'],
      all.map((r) => [r.global_no, r.ssd, r.vrd, r.ship_method, r.product_code, r.location_code, r.quantity, r.unit_weight, r.total_weight, r.matched_staff_name ?? '', r.matched_at ? fmtTime(r.matched_at) : '']));
    saveBlob(`置場別チェック_${board.vrd}_${tab.code}.csv`, new Blob([csv], { type: 'text/csv' }));
  };

  return (
    <div className="scan flex h-[calc(100dvh-64px)] flex-col bg-white lg:h-dvh">
      {/* 1 段目: 担当者・読み取りバー・納期 */}
      <div className="flex flex-wrap items-stretch gap-2.5 border-b border-slate-200 px-3 py-2">
        <div className="flex flex-col justify-center text-[11px] leading-tight whitespace-nowrap text-slate-500">
          担当<b className="text-base text-slate-900">{session.staff.name}</b>
          <button type="button" className="text-left text-blue-700" onClick={() => void changeStaff()}>担当者を変える</button>
        </div>
        <div role="status" aria-live="polite" onClick={() => { if (mode === 'stopped') setMode('ready'); focus(); }}
          className={`rbar rbar-${barClass} relative order-last flex min-h-14 min-w-0 basis-full cursor-pointer items-center gap-3 rounded-xl border-2 px-3 py-1 md:order-none md:basis-0 md:flex-1`}>
          <span className="w-8 flex-none text-center text-2xl font-bold" aria-hidden="true">
            {mode === 'stopped' || mode === 'busy-staff' ? '⏸' : mode === 'manual' ? '⌨' : result ? ({ ok: '✔', dup: '⚠', rv: '⚠', nf: '✖' })[result.kind] : '▣'}
          </span>
          {mode === 'stopped' ? <><b className="text-xl">読み取りが止まっています</b><span className="text-sm">ここを押すと再開します</span></>
            : mode === 'busy-staff' ? <b className="text-base">担当者を変えています…</b>
            : mode === 'manual' ? <b className="text-base">手入力</b>
            : result ? (
              <>
                <b className="text-xl whitespace-nowrap">{result.label}</b>
                <span className="min-w-0 truncate text-sm">
                  {result.item?.location_code ? <>置場 <b>{result.item.location_code} {result.item.location_name ?? ''}</b> </> : null}
                  {result.message}
                  {result.moved && <span className="ml-1.5 rounded-full bg-blue-100 px-2 py-px text-xs font-bold text-blue-800">置場が違います → 切り替えました</span>}
                  {result.manual && <span className="ml-1.5 rounded-full bg-slate-200 px-2 py-px text-xs text-slate-700">手入力</span>}
                </span>
                <span className="ml-auto hidden text-right text-xs leading-snug whitespace-nowrap md:block">
                  <span className="mono">{result.item?.global_no ?? result.barcode}</span><br />
                  {result.item && <><span className="mono">{result.item.product_code}</span> 数量 <b className="text-base">{result.item.quantity}</b></>}
                </span>
              </>
            ) : <b className="min-w-0 truncate text-base">リーダーで部品のラベルを読んでください</b>}
          <input ref={inputRef} autoFocus aria-label="バーコードの読み取り値" autoComplete="off" spellCheck={false}
            className={mode === 'manual' ? 'input mono relative z-10 flex-1' : 'absolute inset-0 h-full w-full cursor-pointer opacity-0'}
            placeholder={mode === 'manual' ? 'ラベルの番号を入力して Enter（Esc でやめる）' : undefined}
            disabled={mode === 'busy-staff'} onKeyDown={onKeyDown} onCompositionEnd={onCompositionEnd}
            onFocus={() => setMode((m) => (m === 'stopped' ? 'ready' : m))}
            onBlur={() => setTimeout(() => { if (document.activeElement !== inputRef.current) setMode((m) => (m === 'ready' || m === 'manual' ? 'stopped' : m)); }, 150)} />
          <span className="relative z-10 flex flex-none items-center gap-1.5 border-l border-black/10 pl-2.5 text-xs font-bold whitespace-nowrap">
            {sending > 0 && <span className="text-slate-600">確認中…{sending > 1 ? `（${sending}）` : ''}</span>}
            <span className={`h-2.5 w-2.5 rounded-full ${mode === 'stopped' ? 'bg-white' : mode === 'ready' ? 'animate-pulse bg-green-600' : 'bg-slate-400'}`} aria-hidden="true" />
            {mode === 'ready' ? '読み取りOK' : mode === 'manual' ? '' : '停止中'}
            {mode !== 'busy-staff' && (
              <button type="button" className="rounded-md border border-current bg-white/80 px-1.5 py-0.5 text-[11px] text-inherit"
                onClick={(e) => { e.stopPropagation(); setMode(mode === 'manual' ? 'ready' : 'manual'); focus(); }}>{mode === 'manual' ? 'やめる' : '手入力'}</button>
            )}
          </span>
        </div>
        <label className="ml-auto flex flex-col justify-center rounded-lg border border-slate-300 px-2.5 text-[11px] text-slate-500 md:ml-0">
          ミスミ納期
          <select className="bg-transparent text-sm font-bold text-slate-900 outline-none" value={vrd ?? ''} onChange={(e) => { setVrd(e.target.value); setLocationId(0); setHit(null); focus(); }} aria-label="ミスミ納期">
            {!dates?.items.length && <option value="">（注文なし）</option>}
            {dates?.items.map((d) => <option key={d.vrd} value={d.vrd}>{md(d.vrd)}{d.vrd === dates.today ? '（今日）' : ''} 残り {d.pending}</option>)}
          </select>
        </label>
      </div>

      {/* 2 段目: 置場タブ＋絞り込み */}
      <div className="flex flex-wrap items-end gap-1.5 border-b border-slate-300 bg-slate-50 px-3 pt-1.5">
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="置場">
          {board?.tabs.map((t) => {
            const cur = t.location_id === currentLoc;
            const complete = t.total > 0 && t.done === t.total;
            return (
              <button key={t.location_id} type="button" role="tab" aria-selected={cur} onClick={() => { setLocationId(t.location_id); setHit(null); focus(); }}
                className={`relative min-w-32 rounded-t-lg border border-b-0 px-2.5 pt-1 pb-1.5 text-left whitespace-nowrap ${cur ? 'border-slate-300 bg-white' : 'border-transparent'} ${t.total ? '' : 'opacity-50'}`}>
                <span className="text-sm font-extrabold">{t.code} {t.name}</span>
                <span className={`float-right ml-2 text-[13px] font-bold ${complete ? 'text-green-700' : ''}`}>{complete ? '✔ ' : ''}{t.done}/{t.total}</span>
                <span className="mt-1 block h-1 overflow-hidden rounded bg-slate-300"><span className={`block h-full ${complete ? 'bg-green-700' : 'bg-slate-700'}`} style={{ width: `${t.total ? (t.done / t.total) * 100 : 0}%` }} /></span>
                {cur && <span className="absolute inset-x-0 -bottom-px h-0.5 bg-white" />}
              </button>
            );
          })}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-1.5 pb-1.5">
          <div className="flex overflow-hidden rounded-lg border border-slate-300 text-xs" role="group" aria-label="絞り込み">
            {([['all', 'すべて'], ['todo', '未チェック'], ['done', '済み']] as const).map(([k, l]) => (
              <button key={k} type="button" aria-pressed={filter === k} onClick={() => { setFilter(k); focus(); }}
                className={`border-l border-slate-200 px-2.5 py-1.5 whitespace-nowrap first:border-l-0 ${filter === k ? 'bg-slate-900 text-white' : 'bg-white'}`}>{l}</button>
            ))}
          </div>
          <button type="button" aria-pressed={todoFirst} onClick={() => { setTodoFirst((x) => !x); focus(); }} className={`btn btn-sm ${todoFirst ? 'bg-slate-200' : ''}`}>未チェックを上へ</button>
          <button type="button" aria-pressed={full} onClick={() => { setFull((x) => !x); focus(); }} className={`btn btn-sm ${full ? 'bg-slate-200' : ''}`} title="今のシートと同じ全部の列">全列</button>
          <Button size="sm" onClick={() => { window.print(); focus(); }}>印刷</Button>
          <Button size="sm" onClick={() => { saveCsv(); focus(); }}>CSV</Button>
        </div>
      </div>

      {/* 一覧の上: 全部の行が同じ値になる列 */}
      <div className="flex flex-wrap gap-x-5 border-b border-slate-200 px-3.5 py-1 text-xs text-slate-500">
        {tab && <span>置場 <b className="text-slate-900">{tab.code} {tab.name}</b></span>}
        {vrd && <span>ミスミ納期 <b className="text-slate-900">{vrd.replace(/-/g, '/')}</b></span>}
        <span className="ml-auto">{rows.length} 件表示{board?.truncated ? '（多すぎるため一部だけ）' : ''}</span>
      </div>
      {boardError && <div className="p-2"><Alert kind="error">{boardError}</Alert></div>}

      <div className="min-h-0 flex-1 overflow-auto">
        {!board ? <Loading /> : (
          <table className="scan-grid w-full border-collapse text-[13px]">
            <thead>
              <tr>
                <th className="w-8" /><th>グローバル番号</th>
                {full && <><th>メーカー出荷日(SSD)</th><th>ミスミ納期(VRD)</th><th>出荷方法</th></>}
                <th>商品コード</th>{full && <th>置場</th>}<th>数量</th><th>個別重量</th><th>商品重量</th><th>チェック者</th><th>チェック時間</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={full ? 12 : 8} className="py-12 text-center text-slate-500">{all.length ? '該当する明細はありません。' : 'この置場・納期の明細はありません。'}</td></tr>}
              {rows.map((r) => {
                const checked = r.status === 'matched';
                const h = hit?.id === r.id ? hit.kind : '';
                return (
                  <tr key={r.id} id={`scan-row-${r.id}`} className={`${checked ? 'chk' : ''} ${h}`}>
                    <td className={`text-center font-bold ${checked ? 'text-green-700' : 'text-slate-300'}`} aria-label={checked ? 'チェック済み' : '未チェック'}>{checked ? '✔' : '○'}</td>
                    <td className="mono">{r.global_no}</td>
                    {full && <><td className="text-center">{r.ssd?.replace(/-/g, '')}</td><td className="text-center">{r.vrd?.replace(/-/g, '')}</td><td>{r.ship_method}</td></>}
                    <td className="mono">{r.product_code}</td>{full && <td className="text-center">{r.location_code}</td>}
                    <td className="text-right">{r.quantity}</td>
                    <td className="text-right">{r.unit_weight?.toLocaleString() ?? ''}</td>
                    <td className="text-right">{r.total_weight?.toLocaleString() ?? ''}</td>
                    <td>{r.matched_staff_name ?? ''}</td>
                    <td className="whitespace-nowrap">{checked ? fmtTime(r.matched_at) : ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* 最下段: 合計 */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-slate-300 bg-slate-50 px-3.5 py-1.5 text-xs whitespace-nowrap text-slate-500">
        {tab && <b className="text-[13px] text-slate-900">{tab.code} {tab.name}</b>}
        <span>済み <b className="text-[15px] text-slate-900">{done}/{all.length}</b></span>
        <span>未チェック <b className={`text-[15px] ${all.length - done ? 'text-amber-700' : 'text-green-700'}`}>{all.length - done}</b></span>
        <span>数量 <b className="text-[15px] text-slate-900">{all.reduce((s, r) => s + r.quantity, 0)}</b></span>
        <span>商品重量 <b className="text-[15px] text-slate-900">{(all.reduce((s, r) => s + (r.total_weight ?? 0), 0) / 1000).toFixed(1)} kg</b></span>
        <span className="h-4 w-px bg-slate-300" />
        <span>全置場 済み <b className="text-[15px] text-slate-900">{doneAll}/{totalAll}</b></span>
        {today && <span>今日の読み取り <b className="text-[15px] text-slate-900">{today.total}</b>（正常 {today.ok}・重複 {today.duplicate}・要確認 {today.review}・エラー {today.error}）</span>}
      </div>
    </div>
  );
}
