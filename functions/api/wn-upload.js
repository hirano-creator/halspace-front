// Cloudflare Pages Function — What'sNo アップロードプロキシ
// iOS Safari の CORS 制約を回避するため、同一オリジン経由で Railway に転送する
// body は ArrayBuffer に一度だけ展開する（Content-Length が確実に付き、Railway/PHP が安定してパースできる）

const RAILWAY_API = 'https://halspace-api-production.up.railway.app/api';

export async function onRequestPost(context) {
  const { request } = context;

  const url = new URL(request.url);
  const overwriteId = url.searchParams.get('overwrite');

  const targetUrl = overwriteId
    ? `${RAILWAY_API}/wn/files/${overwriteId}/overwrite`
    : `${RAILWAY_API}/wn/files`;

  // 1回だけ ArrayBuffer に展開（Workers の 128MB メモリに収まる範囲）
  const buffer = await request.arrayBuffer();

  const res = await fetch(targetUrl, {
    method: 'POST',
    headers: {
      'Authorization': request.headers.get('Authorization') || '',
      'Accept':        'application/json',
      'Content-Type':  request.headers.get('Content-Type') || 'application/octet-stream',
      'X-File-Name':   request.headers.get('X-File-Name') || '',
    },
    body: buffer,
  });

  const body = await res.text();
  return new Response(body, {
    status:  res.status,
    headers: { 'Content-Type': 'application/json' },
  });
}
