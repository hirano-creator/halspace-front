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
      <div class="deck-search">${svg(ICON.search)}<span>会社・補助金・投稿を検索</span></div>
      <div class="panel"><h4>話題のニュース</h4><div id="asideNews"><div class="muted">読み込み中…</div></div></div>
      <div class="panel"><h4>話題の投稿</h4><div id="asidePosts"><div class="muted">読み込み中…</div></div></div>`;
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
    if (role === 'super_admin' || role === 'jp_admin') {
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
  function paintAside(data) {
    const news = data.filter(p => p.kind === 'news').slice(0, 4);
    const posts = data.filter(p => p.kind !== 'news')
      .sort((a, b) => ((b.reactions && b.reactions.helpful) || 0) - ((a.reactions && a.reactions.helpful) || 0))
      .slice(0, 3);
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

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
