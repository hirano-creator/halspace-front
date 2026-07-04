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
  // What'sNoファイル実体のURL（マスク編集でcanvasに読み込む用）。wn/files/{id}/viewはR2署名URLを直接返すため
  // 別ドメイン(a.a)からのfetchはR2バケットのCORS許可外で失敗する→APIが中継するrawエンドポイントを使う
  const wnFileRawUrl = (id) => apiBase() + '/aa/wn-files/' + id + '/raw?token=' + encodeURIComponent(token());
  const updatePost = (id, payload) => aaFetch('/aa/posts/' + id, { method: 'PATCH', body: payload || {} });
  // メディア追加/削除込みの編集：multipartはPATCH不可のため POST + _method=PATCH で送る
  const updatePostMedia = (id, formData) => {
    formData.append('_method', 'PATCH');
    return aaFetch('/aa/posts/' + id, { method: 'POST', body: formData });
  };
  const deletePost = (id) => aaFetch('/aa/posts/' + id, { method: 'DELETE' });

  // ── コメント / リアクション ──
  const comments      = (id) => aaFetch('/aa/posts/' + id + '/comments');
  const postComment   = (id, body) => aaFetch('/aa/posts/' + id + '/comments', { method: 'POST', body: { body } });
  const react         = (id, kind) => aaFetch('/aa/posts/' + id + '/reactions', { method: 'POST', body: { kind: kind || 'helpful' } });
  const reactionUsers = (id, kind) => aaFetch('/aa/posts/' + id + '/reactions/users?kind=' + encodeURIComponent(kind || 'helpful'));
  const reactComment  = (commentId) => aaFetch('/aa/comments/' + commentId + '/react', { method: 'POST' });
  const commentReactionUsers = (commentId) => aaFetch('/aa/comments/' + commentId + '/react/users');
  const shareLink     = (id) => aaFetch('/aa/posts/' + id + '/share-link', { method: 'POST' });

  // X(旧twitter)風の相対時刻表示（秒→分→時間→日→月日）
  function relTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const sec = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
    if (sec < 60) return 'たった今';
    const min = Math.floor(sec / 60);
    if (min < 60) return min + '分';
    const hour = Math.floor(min / 60);
    if (hour < 24) return hour + '時間';
    const day = Math.floor(hour / 24);
    if (day < 7) return day + '日';
    const now = new Date();
    const m = d.getMonth() + 1, dd = d.getDate();
    return d.getFullYear() === now.getFullYear() ? `${m}月${dd}日` : `${d.getFullYear()}/${m}/${dd}`;
  }

  // 会社ロゴ画像があれば円形<img>、無ければ頭文字divを返す（フィード/投稿詳細/コメントで共用）
  // opts.cls で.avaに追加するクラス（例: 'alt ccard-ava'）を指定できる
  function avatarHtml(name, company, logoUrl, opts) {
    opts = opts || {};
    const esc = (s) => (s || '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
    const cls = 'ava' + (opts.cls ? ' ' + opts.cls : '');
    if (logoUrl) {
      return `<div class="${cls}" style="overflow:hidden;padding:0"><img src="${esc(logoUrl)}" alt="" style="width:100%;height:100%;object-fit:cover"></div>`;
    }
    const initial = (name || company || '?').trim().charAt(0);
    return `<div class="${cls}">${esc(initial)}</div>`;
  }

  // フィードのコメントプレビュー／投稿詳細のコメント一覧で共用するカードHTML（X風：アバター+名前+時刻→本文→いいね）
  // opts.linkToPost を渡すとカード本体(いいね以外)を投稿詳細へのリンクにする（フィードのプレビュー用）
  function commentCardHtml(c, opts) {
    opts = opts || {};
    const esc = (s) => (s || '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
    const name = c.user_name || '—';
    const meta = [c.company_name, relTime(c.created_at)].filter(Boolean).join(' · ');
    const liked = !!c.liked;
    const thumb = liked
      ? '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M2 11h3.2v10H2z"/><path d="M7 21V11l4.2-8.1a1.7 1.7 0 0 1 3.2 1l-.2 4.2h5a2 2 0 0 1 2 2.4l-1.4 7a2 2 0 0 1-2 1.6H7z"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M2 11h3.2v10H2z"/><path d="M7 21V11l4.2-8.1a1.7 1.7 0 0 1 3.2 1l-.2 4.2h5a2 2 0 0 1 2 2.4l-1.4 7a2 2 0 0 1-2 1.6H7z"/></svg>';
    const linkOpen  = opts.linkToPost ? `<a class="ccard-link" href="./post.html?id=${opts.linkToPost}">` : '';
    const linkClose = opts.linkToPost ? '</a>' : '';
    return `<div class="ccard" data-cid="${c.id}">
        ${avatarHtml(name, c.company_name, c.company_logo_url, { cls: 'alt ccard-ava' })}
        <div class="ccard-main">
          ${linkOpen}<div class="ccard-head"><b>${esc(name)}</b>${meta ? `<span class="ctime">${esc(meta)}</span>` : ''}</div>
          <div class="ccard-text">${esc(c.body)}</div>${linkClose}
          <button class="ccard-like${liked ? ' on' : ''}" data-creact="${c.id}">${thumb}<span class="n">${c.like_count || 0}</span></button>
        </div>
      </div>`;
  }

  // ── メディアサムネイル（サーバー保存・全端末共有） ──
  // <img> で直接読めるトークン付きURL。404 = 未生成（クライアントで生成して storeMediaThumb）
  // v= はブラウザキャッシュのバスター（immutable配信のため、生成ロジック修正時に上げる。v2=EXIF回転対応）
  const AA_THUMB_VER = 2;
  const mediaThumbUrl = (mediaId) => apiBase() + '/aa/media/' + mediaId + '/thumb?v=' + AA_THUMB_VER + '&token=' + encodeURIComponent(token());
  const storeMediaThumb = (mediaId, blob) => {
    const fd = new FormData();
    fd.append('thumb', blob, 'thumb.jpg');
    return aaFetch('/aa/media/' + mediaId + '/thumb', { method: 'POST', body: fd });
  };

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
  const updateLogo     = (file) => { const fd = new FormData(); fd.append('logo', file); return aaFetch('/aa/profile/logo', { method: 'POST', body: fd }); };
  const addSkill       = (label) => aaFetch('/aa/profile/skills', { method: 'POST', body: { label } });
  const deleteSkill    = (id) => aaFetch('/aa/profile/skills/' + id, { method: 'DELETE' });

  // ── 通知 ──
  const notifications = () => aaFetch('/aa/notifications');
  const readNotif     = (id) => aaFetch('/aa/notifications/' + id + '/read', { method: 'POST' });
  const readAllNotif  = () => aaFetch('/aa/notifications/read-all', { method: 'POST' });

  // ── ブラウザPush通知（Web Push / VAPID） ──
  // 公開鍵は秘密情報ではない（ブラウザのPushManager.subscribeにそのまま渡す値）ため静的に埋め込む
  const VAPID_PUBLIC_KEY = 'BJYiqGgSFkoxQbdRS1MlLH3mq89SwZV6o86T7jVBEKiZtyXjG4Pd4Y7XZZGbGzFg7puSvUXOTK03_gbaV4_XsRE';

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
  }

  function pushSupported() {
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  }

  // iOS SafariはPWAをホーム画面に追加していないとPush通知を購読できない
  function iosNeedsHomeScreenInstall() {
    const ua = navigator.userAgent;
    const isIos = /iPad|iPhone|iPod/.test(ua) && !global.MSStream;
    const isStandalone = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
    return isIos && !isStandalone;
  }

  // 'unsupported' | 'ios-needs-install' | 'denied' | 'subscribed' | 'unsubscribed'
  async function pushState() {
    if (!pushSupported()) return 'unsupported';
    if (iosNeedsHomeScreenInstall()) return 'ios-needs-install';
    if (Notification.permission === 'denied') return 'denied';
    const reg = await navigator.serviceWorker.ready.catch(() => null);
    if (!reg) return 'unsupported';
    const sub = await reg.pushManager.getSubscription();
    return sub ? 'subscribed' : 'unsubscribed';
  }

  async function enablePush() {
    if (!pushSupported()) throw new Error('この端末・ブラウザはブラウザ通知に対応していません');
    if (iosNeedsHomeScreenInstall()) throw new Error('iPhoneでは「ホーム画面に追加」してから有効化できます');
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') throw new Error('通知が許可されませんでした');
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }
    await aaFetch('/aa/push-subscriptions', { method: 'POST', body: sub.toJSON() });
  }

  async function disablePush() {
    if (!('serviceWorker' in navigator)) return;
    const reg = await navigator.serviceWorker.ready.catch(() => null);
    if (!reg) return;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return;
    await aaFetch('/aa/push-subscriptions', { method: 'DELETE', body: { endpoint: sub.endpoint } });
    await sub.unsubscribe();
  }

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

  // ── 手動更新（Service Worker/キャッシュを破棄して強制的に最新を取り直す） ──
  // PWA(ホーム画面起動)はリロードUIが無く、開きっぱなしだと新しいコードに切り替わらないため、
  // 「アプリを更新」ボタンから明示的にSW登録解除→キャッシュ全消去→キャッシュバスター付きで再読込する。
  async function forceUpdateApp() {
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      }
    } catch (e) {}
    try {
      if (global.caches) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
    } catch (e) {}
    const url = new URL(location.href);
    url.searchParams.set('_r', Date.now()); // HTTPキャッシュを確実に迂回させる
    location.href = url.toString();
  }

  // ── 招待参加 ──
  const inviteValidate = (code) => aaFetch('/aa/invite/validate', { method: 'POST', body: { code } });
  const inviteRegister = (payload) => aaFetch('/aa/invite/register', { method: 'POST', body: payload });

  // ── SSO（Space.appからの引き換え） ──
  const ssoRedeem = (ticket) => aaFetch('/aa/sso/redeem', { method: 'POST', body: { ticket } });

  global.AA = {
    apiBase, token, setToken, isAuthed, aaFetch,
    login, logout, me, forceUpdateApp,
    feed, getPost, createPost, publishFromWn, wnFiles, wnFileRawUrl, updatePost, updatePostMedia, deletePost,
    comments, postComment, react, reactionUsers, reactComment, commentReactionUsers, relTime, commentCardHtml, avatarHtml, shareLink, mediaUrl, mediaThumbUrl, storeMediaThumb,
    profile, updateProfile, updateLogo, addSkill, deleteSkill,
    notifications, readNotif, readAllNotif,
    pushState, enablePush, disablePush,
    admin,
    inviteValidate, inviteRegister, ssoRedeem,
  };
})(window);
