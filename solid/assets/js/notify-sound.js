/* ===== 通知音（SOLID専用） =====
   未読が増えたとき・見ている画面に他の人の新着が来たときに短いチャイムを鳴らす。
   効果音の種類（とOFF）はサイドバーのボタンで選び、端末（ブラウザ）ごとに覚える。
   好みの設定で認証情報ではないのでlocalStorageに置く（ログイン情報はsessionStorageのまま）。

   - 社内側・モデラー: /chat/unread（チャット＋全物件のコメント未読）を30秒ごとに確認する。
     音が要るのは画面を見ていないときなので、startAutoRefreshと違いタブが裏でも確認する
     （裏のタブはブラウザ側で1分程度に間引かれる）。
   - 発注者: チャットが無いので、案件一覧（dashboard.js）と案件詳細（project-detail.js）が
     それぞれの自動更新の中で SolidSound.watch / play を呼ぶ。
   音はファイルを持たずWeb Audioで合成する。ブラウザは操作前の音を止めるので、
   最初のクリック・キー操作で鳴らせる状態にしておく。 */
const SolidSound = (() => {
  const PREF_KEY = 'solid_notify_sound';
  const SEEN_KEY = 'solid_notify_seen_';   // + 種類。前回見た未読数（タブごと・画面移動しても引き継ぐ）
  const POLL_MS  = 30000;
  const MIN_GAP  = 8000;                    // 同じ新着を複数の経路で拾っても続けて鳴らさない

  /* 選べる効果音。音はすべてWeb Audioで合成する（音声ファイルを持たない）。
     n = [周波数Hz, 開始秒, 長さ秒, 波形, 音量, 終わりの周波数(省略時は一定)] */
  const SOUNDS = [
    { id: 'chime',  label: 'ピンポン',   n: [[880, 0, .45, 'sine', .18], [1318.5, .16, .45, 'sine', .18]] },
    { id: 'bell',   label: 'ベル',       n: [[1046.5, 0, 1.2, 'sine', .16], [2093, 0, .6, 'sine', .05], [3136, 0, .3, 'sine', .03]] },
    { id: 'pop',    label: 'ポップ',     n: [[600, 0, .12, 'sine', .22, 1400]] },
    { id: 'melody', label: 'ドミソ',     n: [[523.3, 0, .25, 'triangle', .18], [659.3, .11, .25, 'triangle', .18], [784, .22, .4, 'triangle', .18]] },
    { id: 'marimba', label: 'マリンバ',  n: [[392, 0, .35, 'triangle', .22], [587.3, .14, .45, 'triangle', .2]] },
    { id: 'digital', label: 'デジタル',  n: [[1760, 0, .07, 'square', .05], [1760, .12, .07, 'square', .05]] },
  ];
  const DEFAULT_SOUND = 'chime';

  let ctx = null;
  let lastPlayed = 0;

  /* 保存値は 'off' か効果音のid（旧版の 'on' や消えたidは既定の音として扱う） */
  function soundId() {
    let v = null;
    try { v = localStorage.getItem(PREF_KEY); } catch { /* 無視 */ }
    if (v === 'off') return 'off';
    return SOUNDS.some(x => x.id === v) ? v : DEFAULT_SOUND;
  }
  function enabled() { return soundId() !== 'off'; }
  function setSound(id) {
    try { localStorage.setItem(PREF_KEY, id); } catch { /* 保存できなくてもこの画面では効く */ }
    renderToggle();
  }

  function audio() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { ctx = new AC(); } catch { ctx = null; }
    return ctx;
  }
  function unlock() {
    const c = audio();
    if (c && c.state === 'suspended') c.resume().catch(() => {});
  }
  ['pointerdown', 'keydown', 'touchend'].forEach(ev =>
    document.addEventListener(ev, unlock, { capture: true, passive: true }));

  function playNotes(def) {
    const c = audio();
    if (!c) return;
    if (c.state === 'suspended') c.resume().catch(() => {});
    const t0 = c.currentTime + 0.02;
    def.n.forEach(([freq, delay, dur, type, vol, toFreq]) => {
      const osc  = c.createOscillator();
      const gain = c.createGain();
      osc.type = type;
      const t = t0 + delay;
      osc.frequency.setValueAtTime(freq, t);
      if (toFreq) osc.frequency.exponentialRampToValueAtTime(toFreq, t + dur);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(vol, t + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(gain).connect(c.destination);
      osc.start(t);
      osc.stop(t + dur + 0.05);
    });
  }

  /* 選んでいる効果音を鳴らす。previewは設定画面での試し鳴らし（OFFや連続抑止を無視） */
  function play(preview = null) {
    const id = preview || soundId();
    if (id === 'off') return;
    if (!preview) {   // 試し鳴らしは数えない（直後の本物の着信が抑止されないように）
      const now = Date.now();
      if (now - lastPlayed < MIN_GAP) return;
      lastPlayed = now;
    }
    playNotes(SOUNDS.find(x => x.id === id) ?? SOUNDS[0]);
  }

  /* 未読数を渡すと、前回より増えたときだけ鳴らす。
     タブを開いて最初の1回は基準を覚えるだけ（開いた瞬間に鳴らない） */
  function watch(kind, count) {
    const n = Number(count) || 0;
    let prev = null;
    try { prev = sessionStorage.getItem(SEEN_KEY + kind); } catch { /* 無視 */ }
    try { sessionStorage.setItem(SEEN_KEY + kind, String(n)); } catch { /* 無視 */ }
    if (prev !== null && n > Number(prev)) play();
  }

  /* ── サイドバーの通知音ボタン ──
     押すと下に選択肢が開く（サイドバーはスクロール領域なので浮かせずに縦に差し込む）。
     選ぶとその場で試し鳴らしし、開いたまま聞き比べられる */
  function injectStyle() {
    if (document.getElementById('notifySoundStyle')) return;
    const st = document.createElement('style');
    st.id = 'notifySoundStyle';
    st.textContent = `
      .ns-menu { display:none; margin:4px 0 0; padding:4px; border-radius:8px; background:rgba(255,255,255,.06); }
      .ns-menu.open { display:block; }
      .ns-opt { display:flex; align-items:center; gap:8px; width:100%; padding:7px 10px; border-radius:6px;
                font-size:12px; color:rgba(255,255,255,.6); text-align:left; }
      .ns-opt:hover { background:rgba(255,255,255,.08); color:#fff; }
      .ns-opt.on { color:var(--primary); font-weight:600; }
      .ns-opt i { width:14px; text-align:center; }`;
    document.head.appendChild(st);
  }

  function renderToggle() {
    const bottom = document.querySelector('.sidebar-bottom');
    if (!bottom) return;
    injectStyle();
    let btn  = document.getElementById('btnNotifySound');
    let menu = document.getElementById('notifySoundMenu');
    if (!btn) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.id = 'btnNotifySound';
      btn.className = 'btn-sidebar-copylink';
      btn.setAttribute('aria-expanded', 'false');
      menu = document.createElement('div');
      menu.id = 'notifySoundMenu';
      menu.className = 'ns-menu';
      btn.addEventListener('click', () => {
        const open = menu.classList.toggle('open');
        btn.setAttribute('aria-expanded', String(open));
      });
      menu.addEventListener('click', e => {
        const opt = e.target.closest('.ns-opt');
        if (!opt) return;
        const id = opt.dataset.id;
        setSound(id);
        if (id !== 'off') play(id);
      });
      const user = document.getElementById('sidebarUser');
      user ? user.after(btn) : bottom.prepend(btn);
      btn.after(menu);
    }
    const cur = soundId();
    const label = cur === 'off' ? 'OFF' : (SOUNDS.find(x => x.id === cur)?.label ?? '');
    btn.title = '新着メッセージのときの効果音を選びます';
    btn.innerHTML = `<i class="fa-solid ${cur === 'off' ? 'fa-bell-slash' : 'fa-bell'}"></i> 通知音: ${label}`
      + ` <i class="fa-solid fa-chevron-down" style="margin-left:auto;font-size:10px;"></i>`;
    menu.innerHTML = [...SOUNDS.map(x => ({ id: x.id, label: x.label, icon: 'fa-volume-high' })),
                      { id: 'off', label: 'OFF（鳴らさない）', icon: 'fa-bell-slash' }]
      .map(o => `<button type="button" class="ns-opt${o.id === cur ? ' on' : ''}" data-id="${o.id}">
          <i class="fa-solid ${o.id === cur ? 'fa-check' : o.icon}"></i>${o.label}</button>`).join('');
  }

  /* ── 社内側・モデラーの未読確認 ── */
  function startChatPolling() {
    const user = typeof getSpaceUser === 'function' ? getSpaceUser() : null;
    if (!user || typeof canUseChat !== 'function' || !canUseChat(user) || typeof api === 'undefined') return;
    const onChatPage = document.body.classList.contains('chat-page');
    let running = false;
    const tick = async () => {
      if (running || navigator.onLine === false) return;
      running = true;
      try {
        const d = await api.get('/chat/unread');
        if (!d) return;
        const n = d.unread ?? 0;
        watch('chat', n);
        // チャット画面は自前でバッジを更新している
        const badge = document.getElementById('navChatBadge');
        if (badge && !onChatPage) {
          badge.textContent = n > 99 ? '99+' : n;
          badge.style.display = n > 0 ? 'grid' : 'none';
        }
      } catch { /* 次の回で取り直す */ }
      finally { running = false; }
    };
    // 読み込み直後は各画面の取得と重なるので少しずらす（applyChatNavも同じAPIを1回取っている）
    setTimeout(tick, 3000);
    setInterval(tick, POLL_MS);
  }

  document.addEventListener('DOMContentLoaded', () => {
    renderToggle();
    startChatPolling();
  });
  if (document.readyState !== 'loading') {
    renderToggle();
    startChatPolling();
  }

  return { play, watch, enabled };
})();
