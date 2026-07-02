/* a.a API ラッパー — What'sNo の wnFetch / WN_API_BASE / トークン規約を踏襲。
   独自fetchは使わず、必ず aaFetch 経由で叩く（認証ヘッダ・ベースURLを一元化）。 */
(function (global) {
  'use strict';

  // APIベースURL：①window.AA_API_BASE ②localStorage ③ホスト名で本番/ローカルを自動判定
  // （What'sNo の WN_API_BASE と同じ解決。本番フロント=Cloudflare Pages → Railway API）
  function apiBase() {
    if (global.AA_API_BASE) return String(global.AA_API_BASE).replace(/\/+$/, '');
    const ls = localStorage.getItem('aa_api_base');
    if (ls) return ls.replace(/\/+$/, '');
    const h = location.hostname;
    if (h === 'localhost' || h === '127.0.0.1' || h.endsWith('.test')) return 'http://127.0.0.1:8000/api';
    if (/^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(h)) return `http://${h}:8000/api`;
    return 'https://halspace-api-production.up.railway.app/api';
  }

  function token() { return localStorage.getItem('aa_token') || ''; }
  function setToken(t) {
    if (t) { localStorage.setItem('aa_token', t); return; }
    localStorage.removeItem('aa_token');
    clearDataCaches(); // ログアウト/認証切れで前ユーザーの表示キャッシュを残さない
  }
  function isAuthed() { return !!token(); }

  // 各画面の即時表示用キャッシュ（stale-while-revalidate）を全消しする
  function clearDataCaches() {
    try {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && (k.indexOf('aa_feed_cache') === 0 || k === 'aa_notif_cache' || k === 'aa_profile_cache' || k === 'aa_me_cache')) keys.push(k);
      }
      keys.forEach((k) => localStorage.removeItem(k));
    } catch (e) {}
  }

  async function aaFetch(path, opts) {
    opts = opts || {};
    const headers = Object.assign({ 'Accept': 'application/json' }, opts.headers || {});
    if (token()) headers['Authorization'] = 'Bearer ' + token();
    // FormData のときは Content-Type をブラウザに任せる
    if (opts.body && !(opts.body instanceof FormData) && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
      if (typeof opts.body !== 'string') opts.body = JSON.stringify(opts.body);
    }
    const res = await fetch(apiBase() + path, Object.assign({}, opts, { headers }));
    if (res.status === 401) { setToken(null); throw new Error('認証が必要です'); }
    const text = await res.text();
    let json;
    try { json = text ? JSON.parse(text) : {}; }
    catch (e) { throw new Error('レスポンスの解析に失敗しました'); } // indexが返る系のエラー対策
    if (!res.ok) throw new Error(json.message || ('エラー ' + res.status));
    return json;
  }

  // ── 認証 ──
  async function login(email, password) {
    const r = await aaFetch('/auth/login', { method: 'POST', body: { email, password } });
    if (r.token) setToken(r.token);
    return r;
  }
  function logout() { setToken(null); }

  // ── 投稿 / フィード ──
  const feed   = (category) => aaFetch('/aa/feed' + (category ? ('?category=' + encodeURIComponent(category)) : ''));
  const getPost= (id) => aaFetch('/aa/posts/' + id);
  const createPost = (formData) => aaFetch('/aa/posts', { method: 'POST', body: formData }); // FormData(media[], category, body, is_masked)
  const publishFromWn = (wnFileId, payload) => aaFetch('/aa/posts/from-wn/' + wnFileId, { method: 'POST', body: payload || {} });
  const wnFiles = () => aaFetch('/wn/files'); // What'sNo取り込み用の自社ファイル一覧
  const updatePost = (id, payload) => aaFetch('/aa/posts/' + id, { method: 'PATCH', body: payload || {} });
  // メディア追加/削除込みの編集：multipartはPATCH不可のため POST + _method=PATCH で送る
  const updatePostMedia = (id, formData) => {
    formData.append('_method', 'PATCH');
    return aaFetch('/aa/posts/' + id, { method: 'POST', body: formData });
  };
  const deletePost = (id) => aaFetch('/aa/posts/' + id, { method: 'DELETE' });

  // ── コメント / リアクション ──
  const comments    = (id) => aaFetch('/aa/posts/' + id + '/comments');
  const postComment = (id, body) => aaFetch('/aa/posts/' + id + '/comments', { method: 'POST', body: { body } });
  const react       = (id, kind) => aaFetch('/aa/posts/' + id + '/reactions', { method: 'POST', body: { kind: kind || 'helpful' } });
  const shareLink   = (id) => aaFetch('/aa/posts/' + id + '/share-link', { method: 'POST' });

  // ── メディア（view→{url} を取得してから表示） ──
  const mediaUrl = async (mediaViewEndpoint) => {
    // formatPost が返す media.view は絶対URL。トークン付きで叩いて {url} を得る
    const res = await fetch(mediaViewEndpoint, { headers: { 'Authorization': 'Bearer ' + token() } });
    if (!res.ok) throw new Error('メディアを取得できませんでした (' + res.status + ')');
    const j = await res.json();
    if (!j.url) throw new Error('メディアURLが取得できませんでした');
    return j.url;
  };

  // ── プロフィール（会社紹介bio・対応領域タグ・自分の投稿・統計） ──
  const profile        = () => aaFetch('/aa/profile');
  const updateProfile  = (bio) => aaFetch('/aa/profile', { method: 'PATCH', body: { bio } });
  const addSkill       = (label) => aaFetch('/aa/profile/skills', { method: 'POST', body: { label } });
  const deleteSkill    = (id) => aaFetch('/aa/profile/skills/' + id, { method: 'DELETE' });

  // ── 通知 ──
  const notifications = () => aaFetch('/aa/notifications');
  const readNotif     = (id) => aaFetch('/aa/notifications/' + id + '/read', { method: 'POST' });
  const readAllNotif  = () => aaFetch('/aa/notifications/read-all', { method: 'POST' });

  // ── 管理者 ──
  const admin = {
    stats:        () => aaFetch('/aa/admin/stats'),
    posts:        (status) => aaFetch('/aa/admin/posts' + (status ? ('?status=' + status) : '')),
    setPostStatus:(id, status) => aaFetch('/aa/admin/posts/' + id + '/status', { method: 'PATCH', body: { status } }),
    deletePost:   (id) => aaFetch('/aa/admin/posts/' + id, { method: 'DELETE' }),
    news:         (status) => aaFetch('/aa/admin/news' + (status ? ('?status=' + status) : '')),
    runImport:    () => aaFetch('/aa/admin/news/import', { method: 'POST' }),
    feeds:        () => aaFetch('/aa/admin/feeds'),
    addFeed:      (p) => aaFetch('/aa/admin/feeds', { method: 'POST', body: p }),
    toggleFeed:   (id) => aaFetch('/aa/admin/feeds/' + id + '/toggle', { method: 'PATCH' }),
    deleteFeed:   (id) => aaFetch('/aa/admin/feeds/' + id, { method: 'DELETE' }),
    members:      () => aaFetch('/aa/admin/members'),
    toggleUser:   (id) => aaFetch('/aa/admin/users/' + id + '/toggle', { method: 'PATCH' }),
    invites:      () => aaFetch('/aa/admin/invites'),
    createInvite: (note) => aaFetch('/aa/admin/invites', { method: 'POST', body: { note } }),
    revokeInvite: (id) => aaFetch('/aa/admin/invites/' + id + '/revoke', { method: 'PATCH' }),
  };
  const me = () => aaFetch('/auth/me');

  // ── 招待参加 ──
  const inviteValidate = (code) => aaFetch('/aa/invite/validate', { method: 'POST', body: { code } });
  const inviteRegister = (payload) => aaFetch('/aa/invite/register', { method: 'POST', body: payload });

  // ── SSO（Space.appからの引き換え） ──
  const ssoRedeem = (ticket) => aaFetch('/aa/sso/redeem', { method: 'POST', body: { ticket } });

  global.AA = {
    apiBase, token, setToken, isAuthed, aaFetch,
    login, logout, me,
    feed, getPost, createPost, publishFromWn, wnFiles, updatePost, updatePostMedia, deletePost,
    comments, postComment, react, shareLink, mediaUrl,
    profile, updateProfile, addSkill, deleteSkill,
    notifications, readNotif, readAllNotif,
    admin,
    inviteValidate, inviteRegister, ssoRedeem,
  };
})(window);
