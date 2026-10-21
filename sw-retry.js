'use strict';
/* 再試行専用 Service Worker — /sw-retry.js（SOLID・Space が各自のスコープで登録する）
   Cloudflare Pages は main へ push してデプロイが切り替わる数十秒の間、
   "Something went wrong / An internal error occurred" の 5xx 画面を返すことがある
   （2026-10-21 実例: push の19秒後に発生）。
   ページ遷移だけを見て、5xx なら少し待って再試行し、だめなら自動再読み込みの案内を出す。
   キャッシュは一切しない（古い画面が残る問題を持ち込まない）。What'sNo は自前の sw.js で同じことをしている */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', event => {
  if (event.request.mode !== 'navigate') return;
  event.respondWith(
    fetchRetry5xx(event.request)
      .then(res => (res.status >= 500 ? retryPage() : res))
      .catch(() => retryPage())
  );
});

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchRetry5xx(req) {
  let res = await fetch(req);
  for (const wait of [1500, 3000]) {
    if (res.status < 500) break;
    await sleep(wait);
    res = await fetch(req);
  }
  return res;
}

function retryPage() {
  return new Response(
    '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>読み込み中</title><body style="font-family:sans-serif;text-align:center;padding:64px 16px;color:#333">' +
    '<p style="font-size:18px">ただいま更新中、または接続が不安定です。</p><p>数秒後に自動で読み込み直します。</p>' +
    '<button onclick="location.reload()" style="font-size:16px;padding:10px 24px;margin-top:16px">今すぐ読み込む</button>' +
    '<script>setTimeout(function(){location.reload()},5000)</script>',
    { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}
