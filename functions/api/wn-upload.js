// Cloudflare Pages Function — What'sNo アップロードプロキシ
// iOS Safari の CORS 制約を回避するため、同一オリジン経由で Railway に転送する
// 81MB級の動画でも Worker メモリ(128MB)を使い切らないよう、body はバッファせず
// request.body をそのままストリームで Railway に透過転送する

const RAILWAY_API = 'https://halspace-api-production.up.railway.app/api';

export async function onRequestPost(context) {
  const { request } = context;

  const url = new URL(request.url);
  const overwriteId = url.searchParams.get('overwrite');

  const targetUrl = overwriteId
    ? `${RAILWAY_API}/wn/files/${overwriteId}/overwrite`
    : `${RAILWAY_API}/wn/files`;

  const res = await fetch(targetUrl, {
    method: 'POST',
    headers: {
      'Authorization':  request.headers.get('Authorization') || '',
      'Accept':         'application/json',
      'Content-Type':   request.headers.get('Content-Type') || 'application/octet-stream',
      'X-File-Name':    request.headers.get('X-File-Name') || '',
    },
    // ArrayBuffer に展開せずストリームのまま流す（メモリ枯渇回避）
    body: request.body,
  });

  const body = await res.text();
  return new Response(body, {
    status:  res.status,
    headers: { 'Content-Type': 'application/json' },
  });
}
