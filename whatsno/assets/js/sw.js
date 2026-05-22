'use strict';
/* What'sNo Service Worker */

const CACHE_NAME = 'whatsno-v2';
const SHELL_URLS = [
  '/whatsno/app/dashboard.html',
  '/whatsno/app/file-detail.html',
  '/whatsno/app/admin.html',
  '/whatsno/assets/css/wn-app.css',
  '/whatsno/assets/js/wn-api.js',
  '/whatsno/assets/js/pages/wn-dashboard.js',
  '/whatsno/assets/js/pages/wn-file-detail.js',
  'https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;700;900&family=Poppins:wght@700;800&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css',
];

/* インストール: アプリシェルをキャッシュ */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      cache.addAll(SHELL_URLS.map(u => new Request(u, { mode: 'no-cors' })))
    ).then(() => self.skipWaiting())
  );
});

/* アクティベート: 旧キャッシュ削除 */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

/* フェッチ戦略 */
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  /* GET以外（POST/PATCH/DELETE等）はService Worker不介入 → ネットワーク直通 */
  if (event.request.method !== 'GET') return;

  /* 外部API・CDN → ネットワーク直通（クロスオリジンのGETのみキャッシュ） */
  if (url.hostname !== self.location.hostname) {
    event.respondWith(
      caches.match(event.request).then(cached => cached || fetch(event.request).then(res => {
        if (res.ok) {
          const cloned = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, cloned));
        }
        return res;
      }))
    );
    return;
  }

  /* アプリシェル（HTML/CSS/JS）→ ネットワーク優先 + キャッシュフォールバック */
  event.respondWith(
    fetch(event.request).then(res => {
      if (res.ok) {
        const cloned = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, cloned));
      }
      return res;
    }).catch(() => caches.match(event.request).then(cached => {
      if (cached) return cached;
      if (event.request.destination === 'document') {
        return caches.match('/whatsno/app/dashboard.html');
      }
      return new Response('Offline', { status: 503 });
    }))
  );
});

/* プッシュ通知（将来拡張用） */
self.addEventListener('push', event => {
  if (!event.data) return;
  const data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title || "What'sNo", {
      body: data.body || '',
      icon: '/whatsno/assets/icons/icon-192.png',
      badge: '/whatsno/assets/icons/icon-192.png',
      data: { url: data.url || '/whatsno/app/dashboard.html' },
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then(windowClients => {
      const url = event.notification.data?.url || '/whatsno/app/dashboard.html';
      for (const client of windowClients) {
        if (client.url === url && 'focus' in client) return client.focus();
      }
      return clients.openWindow(url);
    })
  );
});
