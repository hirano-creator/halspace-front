// Cloudflare Pages Function — What'sNo アップロードプロキシ
// iOS Safari の CORS 制約を回避するため、同一オリジン経由で Railway に転送する
// multipart を使わずバイナリストリームで送ることで PHP の upload_max_filesize を迂回する

const RAILWAY_API = 'https://halspace-api-production.up.railway.app/api';

export async function onRequestPost(context) {
  const { request } = context;
  const authHeader = request.headers.get('Authorization') || '';

  // multipart から File オブジェクトを取り出してバイナリストリームで送信
  const formData = await request.formData();
  const file     = formData.get('file');

  if (!file || typeof file.arrayBuffer !== 'function') {
    return new Response(JSON.stringify({ message: 'ファイルが見つかりません' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const buffer = await file.arrayBuffer();

  const res = await fetch(`${RAILWAY_API}/wn/files`, {
    method:  'POST',
    headers: {
      'Authorization': authHeader,
      'Accept':        'application/json',
      'Content-Type':  file.type || 'application/octet-stream',
      'X-File-Name':   encodeURIComponent(file.name),
    },
    body: buffer,  // multipart ではなく raw バイナリで送信
  });

  const body = await res.text();
  return new Response(body, {
    status:  res.status,
    headers: { 'Content-Type': 'application/json' },
  });
}
