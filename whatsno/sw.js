'use strict';
/* What'sNo Service Worker — /whatsno/sw.js */

const CACHE_NAME = 'whatsno-v2';
const SHELL_URLS = [
  '/whatsno/app/dashboard.html',
  '/whatsno/app/file-detail.html',
  '/whatsno/app/admin.html',
  '/whatsno/app/diff.html',
  '/whatsno/assets/css/wn-app.css',
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
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  /* API → ネットワーク優先（キャッシュしない） */
  if (url.hostname.includes('solid-api') || url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
    return;
  }

  /* CDNリソース → キャッシュ優先 */
  if (url.hostname !== self.location.hostname) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(res => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
          }
          return res;
        });
      })
    );
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
