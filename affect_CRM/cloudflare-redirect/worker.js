// 旧URL（affect-crm.space-app.workers.dev）を新URL（Pages 中継）へ転送するだけの Worker。
// アプリ本体は Railway に移したが、スタッフのスマホのホーム画面ショートカットや
// ブックマークに旧URLが残っているため、同じパス・クエリで新URLへ 301 する。
// デプロイ: このディレクトリで `npx wrangler@4 deploy`（Worker 名 "affect-crm" を上書きする）
// ★本番切替（ユーザーの合図）まではデプロイしないこと。上書きした時点で旧環境は動かなくなる。

const worker = {
  fetch(request, env) {
    const url = new URL(request.url);
    url.protocol = "https:";
    url.host = env.REDIRECT_HOST;
    return Response.redirect(url.toString(), 301);
  },
};

export default worker;
