'use strict';
/* What'sNo Service Worker — /whatsno/sw.js */

const CACHE_NAME  = 'whatsno-v34';
const SHARE_CACHE = 'wn-share';   /* Web Share Target で受け取ったファイルの一時退避先 */
const SHELL_URLS = [
  '/whatsno/app/dashboard.html',
  '/whatsno/app/save.html',
  '/whatsno/app/file-detail.html',
  '/whatsno/app/admin.html',
  '/whatsno/app/diff.html',
  '/whatsno/assets/css/wn-app.css?v=20260530f',
  '/whatsno/assets/js/wn-api.js',
  '/whatsno/assets/js/pages/wn-dashboard.js',
  '/whatsno/assets/js/pages/wn-file-detail.js',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => Promise.all(
        SHELL_URLS.map(u => cache.add(u).catch(() => {}))
      ))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME && k !== SHARE_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  /* Web Share Target: save.html への共有POSTを傍受してファイルを退避し、
     303でsave.html(GET)へ渡す（OS共有メニュー「What'sNo」経由の保存） */
  if (event.request.method === 'POST' && url.pathname === '/whatsno/app/save.html') {
    event.respondWith((async () => {
      try {
        const formData = await event.request.formData();
        const files = formData.getAll('files').filter(f => f && f.size > 0);
        const cache = await caches.open(SHARE_CACHE);
        for (const k of await cache.keys()) await cache.delete(k); /* 前回分を掃除 */
        const index = [];
        let i = 0;
        for (const f of files) {
          const key = `/whatsno/__share__/${i}`;
          await cache.put(key, new Response(f, {
            headers: { 'Content-Type': f.type || 'application/octet-stream' },
          }));
          index.push({ key, name: f.name || `shared-${i}`, type: f.type, size: f.size });
          i++;
        }
        await cache.put('/whatsno/__share__/index',
          new Response(JSON.stringify(index), { headers: { 'Content-Type': 'application/json' } }));
      } catch (e) { /* 失敗してもsave.htmlへ遷移して手動アップロードに誘導 */ }
      return Response.redirect('/whatsno/app/save.html?shared=1', 303);
    })());
    return;
  }

  /* GET以外（POST/PATCH/DELETE等）はService Worker不介入 → ネットワーク直通 */
  if (event.request.method !== 'GET') return;

  /* 外部API（Railway等）はSW不介入 → 動的データをキャッシュしない */
  if (url.hostname !== self.location.hostname) {
    return;
  }

  /* アプリシェル → ネットワーク優先 + キャッシュフォールバック */
  event.respondWith(
    fetch(event.request).then(res => {
      if (res.ok) {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
      }
      return res;
    }).catch(() =>
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        if (event.request.destination === 'document') {
          return caches.match('/whatsno/app/dashboard.html');
        }
        return new Response('Offline', { status: 503 });
      })
    )
  );
});

/* プッシュ通知 */
self.addEventListener('push', event => {
  if (!event.data) return;
  const data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title || "What'sNo", {
      body:  data.body || '',
      icon:  '/whatsno/assets/icons/icon.svg',
      badge: '/whatsno/assets/icons/icon.svg',
      data:  { url: data.url || '/whatsno/app/dashboard.html' },
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then(wins => {
      const url = event.notification.data?.url || '/whatsno/app/dashboard.html';
      for (const w of wins) {
        if (w.url === url && 'focus' in w) return w.focus();
      }
      return clients.openWindow(url);
    })
  );
});
