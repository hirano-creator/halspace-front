// キオスク表示ページ（/qr/配下）専用の最小Service Worker。
//
// なぜ必要か: Chromeは「fetchハンドラを持つService Workerに制御されていること」を
// beforeinstallprompt発火の条件にしているため、これが無いと「ホーム画面に追加」ボタンが機能しない。
//
// なぜ /qr/ 配下に置くか: ルート（/sw.js）に置くとスコープが全ページに及び、
// 管理画面やログイン画面まで巻き込んでしまう。実際にそれが原因で
// /settings/qr のナビゲーションが "Failed to fetch" になり画面が真っ白になる不具合を出した。
// このファイルの位置により、スコープは自動的に /qr/ に限定される。
//
// 中身は意図的に空。respondWithを呼ばなければブラウザ既定のネットワーク処理になり、
// 通信を一切妨げない（勤怠・QRデータは常に最新である必要があるためキャッシュも持たせない）。
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", () => {
  // 意図的に何もしない（respondWithを呼ばない＝既定のネットワーク処理）
});
