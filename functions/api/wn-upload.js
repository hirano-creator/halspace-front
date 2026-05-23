// Cloudflare Pages Function — What'sNo アップロードプロキシ
// iOS Safari の CORS 制約を回避するため、同一オリジン経由で Railway に転送する
// formData を再エンコードせず request.body をストリームで直接転送する

const RAILWAY_API = 'https://halspace-api-production.up.railway.app/api';

export async function onRequestPost(context) {
  const { request } = context;

  const authHeader  = request.headers.get('Authorization') || '';
  const contentType = request.headers.get('Content-Type')  || '';

  const res = await fetch(`${RAILWAY_API}/wn/files`, {
    method:  'POST',
    headers: {
      'Authorization': authHeader,
      'Accept':        'application/json',
      'Content-Type':  contentType,   // multipart/form-data; boundary=... をそのまま転送
    },
    body: request.body,               // バイナリをそのままストリーム転送（再エンコードなし）
  });

  const body = await res.text();
  return new Response(body, {
    status:  res.status,
    headers: { 'Content-Type': 'application/json' },
  });
}
