/* a.a デスクトップ用シェル — PC幅で「左メニュー＋中央(.wrap)＋右の話題」3カラムに。
   モバイルでは nav/aside はCSSで非表示、従来の単一カラム＋下部タブのまま。 */
(function () {
  'use strict';
  const path = location.pathname;
  const page = path.endsWith('/feed.html') ? 'home'
    : path.endsWith('/notifications.html') ? 'notif'
    : path.endsWith('/profile.html') ? 'me' : '';
  const esc = (s) => (s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const ICON = {
    home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/>',
    bell: '<path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    cog: '<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.3l2-1.5-2-3.5-2.4 1a7 7 0 0 0-2.2-1.3L14 2h-4l-.3 2.6a7 7 0 0 0-2.2 1.3l-2.4-1-2 3.5 2 1.5A7 7 0 0 0 5 12a7 7 0 0 0 .1 1.3l-2 1.5 2 3.5 2.4-1a7 7 0 0 0 2.2 1.3L10 22h4l.3-2.6a7 7 0 0 0 2.2-1.3l2.4 1 2-3.5-2-1.5A7 7 0 0 0 19 12z"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/>'
  };
  const svg = (d, sw) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw || 1.7}">${d}</svg>`;

  function buildNav() {
    const n = document.createElement('nav');
    n.className = 'deck-nav';
    n.innerHTML = `
      <div class="deck-brand">a<span>.</span>a</div>
      <a class="navi ${page === 'home' ? 'on' : ''}" href="./feed.html">${svg(ICON.home)}ホーム</a>
      <a class="navi" href="#">${svg(ICON.search)}さがす</a>
      <a class="navi ${page === 'notif' ? 'on' : ''}" href="./notifications.html">${svg(ICON.bell)}通知</a>
      <a class="navi ${page === 'me' ? 'on' : ''}" href="./profile.html">${svg(ICON.user)}プロフィール</a>
      <a class="deck-post" href="./compose.html">${svg(ICON.plus, 2.1)}投稿する</a>
      <div class="deck-me">
        <a class="deck-me-link" href="./profile.html"><span class="ava" id="deckAva">…</span><span class="deck-me-t"><b id="deckName">…</b><span>プロフィール</span></span></a>
        <button class="deck-logout" id="deckLogout" title="ログアウト">${svg(ICON.logout)}</button>
      </div>`;
    n.querySelector('#deckLogout').addEventListener('click', () => { AA.logout(); location.href = '../index.html'; });
    return n;
  }
  function buildAside() {
    const a = document.createElement('aside');
    a.className = 'deck-aside';
    a.innerHTML = `
      <label class="deck-search">${svg(ICON.search)}<input id="asideSearchInput" type="search" placeholder="会社・補助金・投稿を検索" autocomplete="off"></label>
      <div class="panel"><h4 id="asideNewsTitle">話題のニュース</h4><div id="asideNews"><div class="muted">読み込み中…</div></div></div>
      <div class="panel"><h4 id="asidePostsTitle">話題の投稿</h4><div id="asidePosts"><div class="muted">読み込み中…</div></div></div>`;
    const input = a.querySelector('#asideSearchInput');
    let t = null;
    input.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => {
        const q = input.value.trim();
        paintAside(feedDataCache, q);
        document.dispatchEvent(new CustomEvent('aa:search', { detail: q }));
      }, 150);
    });
    return a;
  }

  function mount() {
    const wrap = document.querySelector('.wrap');
    if (!wrap || document.querySelector('.deck')) return;
    const deck = document.createElement('div');
    deck.className = 'deck';
    wrap.parentNode.insertBefore(deck, wrap);
    deck.appendChild(buildNav());
    deck.appendChild(wrap);
    deck.appendChild(buildAside());
    if (window.matchMedia('(min-width:1024px)').matches && window.AA && AA.isAuthed()) populate();
  }

  function paintMe(u) {
    const name = (u.company && u.company.name) || u.name || '';
    const el = document.getElementById('deckName'); if (el) el.textContent = name;
    const av = document.getElementById('deckAva'); if (av) av.textContent = (name || '?').trim().charAt(0);
    // 管理者には「管理」リンクを左ナビに追加
    const role = u.role || '';
    if (role === 'super_admin' || role === 'admin') {
      const nav = document.querySelector('.deck-nav');
      const postBtn = nav && nav.querySelector('.deck-post');
      if (nav && postBtn && !nav.querySelector('.navi-admin')) {
        const a = document.createElement('a');
        a.className = 'navi navi-admin';
        a.href = './admin.html';
        a.innerHTML = svg(ICON.cog) + '管理';
        nav.insertBefore(a, postBtn);
      }
    }
  }
  let feedDataCache = [];
  function paintAside(data, query) {
    feedDataCache = data;
    const q = (query || '').toLowerCase();
    const matches = (p) => !q || [p.news_title, p.body, p.category, p.company_name].some(s => (s || '').toLowerCase().indexOf(q) >= 0);
    const filtered = data.filter(matches);
    const news = filtered.filter(p => p.kind === 'news').slice(0, 4);
    const posts = filtered.filter(p => p.kind !== 'news')
      .sort((a, b) => ((b.reactions && b.reactions.helpful) || 0) - ((a.reactions && a.reactions.helpful) || 0))
      .slice(0, 3);
    const nt = document.getElementById('asideNewsTitle'); if (nt) nt.textContent = q ? '検索結果（ニュース）' : '話題のニュース';
    const pt = document.getElementById('asidePostsTitle'); if (pt) pt.textContent = q ? '検索結果（投稿）' : '話題の投稿';
    const nEl = document.getElementById('asideNews');
    if (nEl) nEl.innerHTML = news.map(p =>
      `<a class="aitem" href="${esc(p.news_url)}" target="_blank" rel="noopener"><span class="atag">${esc(p.category || 'ニュース')}</span><b>${esc(p.news_title)}</b></a>`
    ).join('') || '<div class="muted">なし</div>';
    const pEl = document.getElementById('asidePosts');
    if (pEl) pEl.innerHTML = posts.map(p =>
      `<a class="aitem col" href="./post.html?id=${p.id}"><b>${esc((p.body || '').slice(0, 42)) || '（メディア投稿）'}</b><span class="muted">${esc(p.company_name || '')} ・ 👍${(p.reactions && p.reactions.helpful) || 0}</span></a>`
    ).join('') || '<div class="muted">なし</div>';
  }

  async function populate() {
    // 前回取得分を即描画→裏で最新取得（stale-while-revalidate）
    try { const c = localStorage.getItem('aa_me_cache'); if (c) paintMe(JSON.parse(c)); } catch (e) {}
    try { const c = localStorage.getItem('aa_feed_cache:'); if (c) paintAside(JSON.parse(c)); } catch (e) {}
    try {
      const me = await AA.aaFetch('/auth/me');
      const u = me.user || me.data || me;
      try { localStorage.setItem('aa_me_cache', JSON.stringify(u)); } catch (e) {}
      paintMe(u);
    } catch (e) {}
    try {
      const r = await AA.feed();
      const data = r.data || [];
      try { localStorage.setItem('aa_feed_cache:', JSON.stringify(data)); } catch (e) {}
      paintAside(data);
    } catch (e) {}
  }

  // 「いいねした人」ボトムシート（投稿の👍・コメントのいいね、どちらの一覧表示からも呼ぶ共通UI）
  async function openLikers(fetchPromise) {
    const esc = (s) => (s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const initial = (s) => (s || '?').trim().charAt(0);

    const overlay = document.createElement('div');
    overlay.className = 'likers-overlay';
    overlay.innerHTML = `
      <div class="likers-sheet">
        <div class="likers-head"><b>いいねした人</b><button class="likers-close" aria-label="閉じる">×</button></div>
        <div class="likers-list"><div class="center" style="padding:24px">読み込み中…</div></div>
      </div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.querySelector('.likers-close').onclick = close;

    try {
      const { data } = await fetchPromise;
      const list = overlay.querySelector('.likers-list');
      list.innerHTML = (data && data.length) ? data.map(u => `
          <div class="likers-row">
            <div class="ava alt" style="width:32px;height:32px;flex:0 0 32px;font-size:14px">${esc(initial(u.name))}</div>
            <div class="likers-who"><b>${esc(u.name || '—')}</b><span>${esc(u.company_name || '')}</span></div>
          </div>`).join('') : '<div class="center" style="padding:24px">まだいいねがありません</div>';
    } catch (e) {
      overlay.querySelector('.likers-list').innerHTML = `<div class="center" style="padding:24px">${esc(e.message || '読み込みに失敗しました')}</div>`;
    }
  }
  window.AA_openLikers = openLikers;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
