// 旧URL（timecalc.space-app.workers.dev）を Railway の新URLへ転送するだけの Worker。
// アプリ本体は Railway に移したが、店舗タブレットのホーム画面ショートカットや
// ブックマークに旧URLが残っているため、同じパス・クエリで新URLへ 301 する。
// デプロイ: このディレクトリで `npx wrangler@4 deploy`（Worker 名 "timecalc" を上書きする）

export default {
  fetch(request, env) {
    const url = new URL(request.url);
    url.protocol = "https:";
    url.host = env.REDIRECT_HOST;
    return Response.redirect(url.toString(), 301);
  },
};
