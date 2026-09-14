// timecalc-app.pages.dev → Railway（アプリ本体）への中継
//
// pages.dev のホスト名は Cloudflare 上のものにしか向けられないため、
// 全リクエストをこの Function で受けて Railway のオリジンへそのまま転送する。
// - メソッド・ヘッダ・ボディは透過（ボディはバッファせずストリームのまま）
// - Host は転送先のものにし、元のホストは X-Original-Host で渡す
//   （アプリ側の getBaseUrl() がこれを見て QR の URL を pages.dev で組み立てる。
//   X-Forwarded-Host は Railway のエッジが自分のホストで上書きするので使えない）
// - 応答の Location が転送先ホストなら pages.dev に書き戻す
// - /_next/static/*（ハッシュ付き・immutable）だけエッジでキャッシュする
//
// デプロイ: cloudflare-proxy ディレクトリで `npx wrangler@4 pages deploy public --project-name timecalc-app`

const ORIGIN = "https://timecalc-production.up.railway.app";

export async function onRequest({ request }) {
  const incoming = new URL(request.url);
  const target = new URL(incoming.pathname + incoming.search, ORIGIN);

  const headers = new Headers(request.headers);
  headers.set("X-Original-Host", incoming.host);
  headers.set("X-Forwarded-Proto", "https");
  // Host は fetch が転送先に合わせて付け直すので消しておく
  headers.delete("host");

  const isStatic = incoming.pathname.startsWith("/_next/static/");
  const init = {
    method: request.method,
    headers,
    body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
    redirect: "manual",
  };
  if (isStatic) {
    init.cf = { cacheEverything: true, cacheTtl: 31536000 };
  }

  const upstream = await fetch(target, init);

  const outHeaders = new Headers(upstream.headers);
  const location = outHeaders.get("location");
  if (location) {
    outHeaders.set("location", location.replace(ORIGIN, `https://${incoming.host}`));
  }
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: outHeaders,
  });
}
