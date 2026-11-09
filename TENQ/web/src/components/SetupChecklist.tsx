import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { HELP_EVENT, loadOnb, onboardingOff, updateOnb, type OnbState } from '../onboarding';
import { Coach } from './Coach';

/**
 * 「はじめにやること」（2026-11-08 B 案。requirements §10 Q-16）。工場長以上のホーム（見取り図）の右下に出す。
 * できたかどうかは見取り図のデータで判定する（建屋がある・設備がある・今日の点検がある）。
 * データで分からないもの（QR を印刷した・毎朝の見方を読んだ）は onboarding.ts に覚える。
 * 「やってみる」で押す場所を青く光らせ、そこが押されたら案内を消す（押した先の操作はそのまま進む）
 * 2026-11-09 A 案「見取り図を画面いっぱいに」: 1 つでもできていれば、最初から右下の小さなボタンにたたんでおく
 * （開いたままだと見取り図の右下の設備に重なるため）。まだ何もない工場では開いて出す。開け閉めはその人の選んだとおり
 */

type Key = 'area' | 'eq' | 'qr' | 'inspect' | 'daily';
interface Task {
  key: Key; label: string; sub: string; done: boolean;
  /** 光らせる場所（data-tour）。配列は先へ進むと出てくる場所の順 */
  target?: string[]; title: string; body: string;
}

export function SetupChecklist({ areas, items, inspectedToday, canQr }: { areas: number; items: number; inspectedToday: boolean; canQr: boolean }) {
  const { me } = useAuth();
  const uid = me?.user.id ?? '';
  const [st, setSt] = useState<OnbState>(() => loadOnb(uid));
  const [off, setOff] = useState(() => onboardingOff());
  const [guide, setGuide] = useState<Key | null>(null);
  const save = (f: (s: OnbState) => OnbState) => setSt(updateOnb(uid, f));

  // ⚙ の「使い方を見る」でもう一度出す
  useEffect(() => {
    const on = () => { setSt(loadOnb(uid)); setOff(onboardingOff()); };
    window.addEventListener(HELP_EVENT, on);
    return () => window.removeEventListener(HELP_EVENT, on);
  }, [uid]);

  const tasks: Task[] = [
    { key: 'area', label: '建屋をつくる', sub: areas ? `${areas} つできています` : '工場の建物・エリアを足す', done: areas > 0,
      target: ['map-lock', 'add-area'], title: '建屋をつくります', body: '「🔓 配置を動かす」を押すと、見取り図の下に「＋ 建屋を足す」が出ます。名前を入れて足したら、帯をつかんで好きな場所へ動かせます。' },
    { key: 'eq', label: '設備を登録する', sub: items ? `${items} 台登録しました` : '番号と名前だけで OK', done: items > 0,
      target: ['add-eq'], title: 'ここを押します', body: '「＋ 設備を足す」を押すと登録の画面が開きます。設備番号（例: W-01）と名前を入れて、置く建屋を選びます。' },
    ...(canQr ? [{ key: 'qr' as const, label: 'QR ラベルを印刷して貼る', sub: '設備ごとに 1 枚', done: !!st.done.qr,
      target: ['settings', 'qr-print'], title: '⚙ →「QRラベル印刷」', body: 'QR ラベルの印刷は ⚙ の中にあります。設備を選んで A4 に印刷し、設備の見やすい所に貼ります。QR には URL しか入っていないので、貼っても安全です。' }] : []),
    { key: 'inspect', label: 'スマホで点検してみる', sub: 'QR を読んで ○✕ → 送る', done: inspectedToday || !!st.done.inspect,
      target: ['scan'], title: 'スマホで QR を読みます', body: 'ふだんは作業者がスマホで、設備に貼った QR を読みます。試しにここから読んで、○ を付けて「送る」まで進めてみましょう。' },
    { key: 'daily', label: '毎朝の見方を知る', sub: '見取り図の色と数', done: !!st.done.daily,
      target: ['map-sum'], title: '毎朝はここを見るだけ', body: '点検した設備は ○ 緑、✕ が付くと赤、まだの設備は点線です。ここの数で、おかしい所とまだの台数が分かります。赤い設備を押すと「直した」が出ます。' },
  ];
  const doneCount = tasks.filter((t) => t.done).length;
  const allDone = doneCount === tasks.length;
  const now = tasks.find((t) => !t.done);
  const g = tasks.find((t) => t.key === guide && !t.done);

  // 光らせた場所（いちばん深いもの）が押されたら、案内を消す。押した先の操作（画面の移動など）はそのまま
  useEffect(() => {
    if (!g?.target) return;
    const last = g.target[g.target.length - 1];
    const onClick = (e: MouseEvent) => {
      const t = (e.target as Element).closest('[data-tour]')?.getAttribute('data-tour');
      if (t !== last) return;
      if (g.key === 'qr') updateOnb(uid, (s) => ({ ...s, done: { ...s.done, qr: true } }));
      if (g.key === 'inspect') updateOnb(uid, (s) => ({ ...s, done: { ...s.done, inspect: true } }));
      setGuide(null);
      setSt(loadOnb(uid));
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [g, uid]);

  if (off || !uid || st.finished) return null;

  if (st.collapsed ?? doneCount > 0) {
    return <button type="button" className="onb-pill" onClick={() => save((s) => ({ ...s, collapsed: false }))}>🚀 はじめにやること {doneCount}/{tasks.length}</button>;
  }

  return (
    <>
      <section className="onb" aria-label="はじめにやること">
        <h2>{allDone ? '🎉 準備ができました' : '🚀 はじめにやること'}
          {!allDone && <button type="button" onClick={() => { setGuide(null); save((s) => ({ ...s, collapsed: true })); }}>あとで</button>}
        </h2>
        <div className="onb-bar"><i style={{ width: `${(doneCount / tasks.length) * 100}%` }} /></div>
        {allDone ? (
          <>
            <p className="onb-done">これで使い始められます。毎朝はこの見取り図を開いて、赤い設備がないかを見るだけです。<br />この案内は ⚙ の「使い方を見る」でまた開けます。</p>
            <button type="button" className="btn btn-primary block" onClick={() => save((s) => ({ ...s, finished: true }))}>閉じる</button>
          </>
        ) : (
          <>
            <p className="onb-count">{doneCount} / {tasks.length} できました</p>
            <ol>
              {tasks.map((t, i) => (
                <li key={t.key} className={t.done ? 'is-done' : t === now ? 'is-now' : ''}>
                  <span className="m" aria-hidden="true">{t.done ? '✓' : i + 1}</span>
                  <span className="t">{t.label}{t.done && <span className="sr-only">（できました）</span>}<small>{t.sub}</small></span>
                  {!t.done && t === now && <button type="button" className="btn btn-primary" onClick={() => setGuide(t.key)}>やってみる</button>}
                </li>
              ))}
            </ol>
          </>
        )}
      </section>
      {g && (
        <Coach target={g.target} step={`${tasks.indexOf(g) + 1}. ${g.label}`} title={g.title} onClose={() => setGuide(null)}
          actions={g.key === 'daily'
            ? [{ label: 'わかった', primary: true, onClick: () => { save((s) => ({ ...s, done: { ...s.done, daily: true } })); setGuide(null); } }]
            : [{ label: 'やめる', onClick: () => setGuide(null) }]}>
          {g.body}
        </Coach>
      )}
    </>
  );
}
