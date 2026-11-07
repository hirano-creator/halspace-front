import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../auth/AuthContext';
import { HELP_EVENT, loadOnb, onboardingOff, updateOnb } from '../onboarding';

/**
 * 初めての人の案内の吹き出し（2026-11-08。requirements §10 Q-16）。
 * 案内する場所には data-tour="名前" を付け、ここからはその名前で指す（画面の部品の中身に依存しないため）。
 * dim = 周りを暗くして、その場所だけ明るくする（読むだけの案内）。dim なし = 青い枠で光らせ、画面はそのまま押せる（やってみる）
 */

export interface CoachAction { label: string; primary?: boolean; onClick: () => void }

const PAD = 6;

/** data-tour の場所を探す。配列なら後ろから探す（⚙ を押す → 開いた中の「QRラベル印刷」のように、先へ進むと深い方が見つかる） */
function findTarget(target: string | string[] | undefined): Element | null {
  const names = target === undefined ? [] : Array.isArray(target) ? target : [target];
  for (let i = names.length - 1; i >= 0; i--) {
    const el = document.querySelector(`[data-tour="${names[i]}"]`);
    if (el && el.getClientRects().length > 0) return el;
  }
  return null;
}

/** 場所の位置を毎フレーム追う（スクロール・開閉・読み込みで動くため）。変わったときだけ描き直す */
function useTargetRect(target: string | string[] | undefined): DOMRect | null {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const names = Array.isArray(target) ? target.join('|') : target ?? '';
  useEffect(() => {
    let raf = 0;
    let last = '';
    let scrolledTo: Element | null = null;
    const tick = () => {
      const el = findTarget(names ? names.split('|') : undefined);
      if (el && el !== scrolledTo) { scrolledTo = el; el.scrollIntoView({ block: 'nearest' }); }
      const r = el?.getBoundingClientRect() ?? null;
      const k = r ? `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)}` : '';
      if (k !== last) { last = k; setRect(r); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [names]);
  return rect;
}

export function Coach({ target, title, children, step, actions, dim = false, onClose, dots, hero }: {
  target?: string | string[]; title: string; children: ReactNode; step?: string; actions: CoachAction[];
  dim?: boolean; onClose?: () => void; dots?: [number, number]; hero?: string;
}) {
  const rect = useTargetRect(target);
  // 吹き出しの高さを測る（中身の長さで変わる。下にも上にも入らないときの置き場所を決めるため）
  const balRef = useRef<HTMLDivElement>(null);
  const hRef = useRef(0);
  const [h, setH] = useState(220);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const v = balRef.current?.offsetHeight ?? 0;
      if (v && v !== hRef.current) { hRef.current = v; setH(v); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const vw = window.innerWidth, vh = window.innerHeight;
  const w = Math.min(330, vw - 24);
  let style: CSSProperties = { width: w };
  let place = 'center';
  let ax = 0;
  if (rect) {
    const left = Math.min(Math.max(12, rect.left + rect.width / 2 - w / 2), vw - w - 12);
    ax = Math.min(Math.max(16, rect.left + rect.width / 2 - left - 8), w - 32);
    // 下に入らなければ上、どちらにも入らなければ画面の下端（押す場所を隠さないことを優先し、ボタンは必ず画面内に出す）
    const gap = PAD + 12;
    if (rect.bottom + gap + h <= vh - 12) { place = 'below'; style = { ...style, left, top: rect.bottom + gap }; }
    else if (rect.top - gap - h >= 12) { place = 'above'; style = { ...style, left, bottom: vh - rect.top + gap }; }
    else { place = 'float'; style = { ...style, left, top: Math.max(12, vh - h - 12) }; }
  }

  return createPortal(
    <>
      {dim && <div className={`coach-veil ${rect ? '' : 'dark'}`} aria-hidden="true" />}
      {rect && <div className={dim ? 'coach-spot' : 'coach-ring'} aria-hidden="true"
        style={{ left: rect.left - PAD, top: rect.top - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 }} />}
      <div ref={balRef} className={`coach-bal ${place}`} role="dialog" aria-label={title} style={{ ...style, ['--ax' as string]: `${ax}px` }}>
        {onClose && <button type="button" className="coach-x" onClick={onClose} aria-label="案内を閉じる">×</button>}
        {hero && <div className="coach-hero" aria-hidden="true">{hero}</div>}
        {step && <div className="coach-step">{step}</div>}
        <h2>{title}</h2>
        <div className="coach-body">{children}</div>
        <div className="coach-row">
          {dots && <span className="coach-dots" aria-label={`${dots[0] + 1} / ${dots[1]}`}>{Array.from({ length: dots[1] }, (_, i) => <i key={i} className={i === dots[0] ? 'on' : ''} />)}</span>}
          {actions.map((a) => <button key={a.label} type="button" className={`btn ${a.primary ? 'btn-primary' : ''}`} onClick={a.onClick}>{a.label}</button>)}
        </div>
      </div>
    </>,
    document.body,
  );
}

/** 作業者向けの、初めてのときだけの吹き出し（ホーム・点検表）。見終わる・とばすと二度と出ない（⚙ の「使い方を見る」で戻る） */
export function TipTour({ id, steps, ready = true }: {
  id: string; ready?: boolean;
  steps: { target?: string; title: string; body: ReactNode; hero?: string }[];
}) {
  const { me } = useAuth();
  const uid = me?.user.id ?? '';
  const [seen, setSeen] = useState(() => onboardingOff() || !uid || !!loadOnb(uid).tips?.[id]);
  const [i, setI] = useState(0);
  useEffect(() => {
    const on = () => { setSeen(onboardingOff()); setI(0); };
    window.addEventListener(HELP_EVENT, on);
    return () => window.removeEventListener(HELP_EVENT, on);
  }, []);
  if (seen || !ready || !uid) return null;
  const finish = () => { updateOnb(uid, (s) => ({ ...s, tips: { ...s.tips, [id]: true } })); setSeen(true); };
  const st = steps[i]!;
  const last = i === steps.length - 1;
  return (
    <Coach dim target={st.target} title={st.title} hero={st.hero} onClose={finish}
      dots={steps.length > 1 ? [i, steps.length] : undefined}
      actions={[
        ...(i === 0 && steps.length > 1 ? [{ label: 'とばす', onClick: finish }] : []),
        ...(i > 0 ? [{ label: '戻る', onClick: () => setI(i - 1) }] : []),
        { label: last ? 'わかった' : i === 0 && steps.length > 1 ? 'はじめる' : '次へ', primary: true, onClick: () => (last ? finish() : setI(i + 1)) },
      ]}>
      {st.body}
    </Coach>
  );
}

/**
 * 「？ 使い方」: 画面の各場所に名前と説明の札を付ける（C 案）。外を押す・Esc・もう一度押すで閉じる。
 * 札は重ならない置き場所を、下 → 下（右寄せ）→ 上 → 中の順に探す
 */
export function HelpTags({ tags, onClose }: { tags: { target: string; name: string; desc: string }[]; onClose: () => void }) {
  const [rects, setRects] = useState<(DOMRect | null)[]>([]);
  const keyRef = useRef('');
  const list = tags.map((t) => t.target).join('|');
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const rs = list.split('|').map((n) => findTarget(n)?.getBoundingClientRect() ?? null);
      const k = rs.map((r) => (r ? `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)}` : '-')).join(';');
      if (k !== keyRef.current) { keyRef.current = k; setRects(rs); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('keydown', onKey); };
  }, [list, onClose]);

  const vw = window.innerWidth, vh = window.innerHeight;
  const TW = Math.min(220, vw - 24), TH = 70;
  const placed: { x: number; y: number }[] = [];
  const hit = (x: number, y: number) => placed.some((p) => Math.abs(p.x - x) < TW && Math.abs(p.y - y) < TH);
  const items = tags.map((t, i) => {
    const r = rects[i];
    if (!r || r.bottom < 0 || r.top > vh) return null;
    // 下（左寄せ・右寄せ・左へずらす）を段を下げながら → 上 → 中の順に試す（右上はボタンが詰まっていて重なりやすい）
    const xs = [r.left, r.right - TW, r.left - TW - 8];
    const cands = [
      ...[0, 1, 2].flatMap((k) => xs.map((x) => ({ x, y: r.bottom + 8 + k * (TH + 6) }))),
      ...xs.map((x) => ({ x, y: r.top - TH - 8 })),
      { x: r.left + 8, y: r.top + 8 },
    ].map((c) => ({ x: Math.min(Math.max(8, c.x), vw - TW - 8), y: Math.min(Math.max(64, c.y), vh - TH - 8) }));
    const pos = cands.find((c) => !hit(c.x, c.y)) ?? cands[0]!;
    placed.push(pos);
    return { t, r, pos, n: i + 1 };
  });

  return createPortal(
    <div className="help-layer" onClick={onClose} role="dialog" aria-label="画面の使い方">
      {items.map((x) => x && (
        <div key={x.t.target}>
          <div className="help-outline" style={{ left: x.r.left - 4, top: x.r.top - 4, width: x.r.width + 8, height: x.r.height + 8 }} />
          <div className="help-tag" style={{ left: x.pos.x, top: x.pos.y, width: TW }}><b>{x.n}</b><strong>{x.t.name}</strong><br />{x.t.desc}</div>
        </div>
      ))}
      <button type="button" className="help-close btn btn-primary" onClick={onClose}>✕ 使い方を閉じる</button>
    </div>,
    document.body,
  );
}
