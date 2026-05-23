// Cloudflare Pages Function — What'sNo アップロードプロキシ
// iOS Safari の CORS 制約を回避するため、同一オリジン経由で Railway に転送する

const RAILWAY_API = 'https://halspace-api-production.up.railway.app/api';

export async function onRequestPost(context) {
  const { request } = context;

  const authHeader = request.headers.get('Authorization') || '';
  const formData   = await request.formData();

  const res = await fetch(`${RAILWAY_API}/wn/files`, {
    method:  'POST',
    headers: {
      'Authorization': authHeader,
      'Accept':        'application/json',
    },
    body: formData,
  });

  const body = await res.text();
  return new Response(body, {
    status:  res.status,
    headers: { 'Content-Type': 'application/json' },
  });
}
