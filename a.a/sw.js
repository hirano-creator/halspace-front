/* a.a Service Worker — アプリシェルをキャッシュしてインストール可能化＆高速起動 */
const CACHE = 'aa-shell-v10';
const SHELL = [
  './',
  './index.html',
  './assets/app.css',
  './assets/aa-api.js',
  './assets/aa-pdf.js',
  './assets/aa-video.js',
  './assets/aa-shell.js',
  './assets/icon.svg',
  './manifest.json',
  './app/feed.html',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  // API・メディアは常にネットワーク（キャッシュしない）
  if (req.method !== 'GET' || req.url.includes('/api/')) return;

  const url = new URL(req.url);
  // アプリのコード(HTML/CSS/JS)は network-first：常に最新を取りに行き、
  // オフライン時のみキャッシュへフォールバック（編集が「元に戻る」のを防ぐ）
  const isCode = req.mode === 'navigate' || /\.(html|css|js)$/.test(url.pathname);
  if (isCode) {
    e.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      }).catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html')))
    );
    return;
  }

  // それ以外の静的アセット（画像/アイコン/フォント等）は cache-first
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match('./index.html')))
  );
});

/* ── ブラウザPush通知 ── */
self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch (err) {}
  const title = data.title || 'a.a';
  const url = data.url || './notifications.html';
  e.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      icon: './assets/icon-192.png',
      badge: './assets/icon-192.png',
      data: { url },
    })
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data && e.notification.data.url || './notifications.html', self.location.href).href;
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const c of clients) {
        if (c.url === url && 'focus' in c) return c.focus();
      }
      return self.clients.openWindow(url);
    })
  );
});
