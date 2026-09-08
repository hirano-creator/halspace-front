// PrismaClient の解決
//
// Cloudflare D1（Workers/OpenNext）では、DB はリクエストごとに渡される
// バインディング（env.DB）経由でしか触れないため、`new PrismaClient()` を
// 1度だけ生成するシングルトンは使えない。
//
// Proxy にしているのは、prisma.xxx が実際にアクセスされた瞬間だけ context を
// 解決するため（モジュール読み込み時・ビルド時評価では context を触らない）。

import { PrismaClient } from "@/generated/prisma/client";
import { PrismaD1 } from "@prisma/adapter-d1";
import { getCloudflareContext } from "@opennextjs/cloudflare";

// ★重要: キャッシュのキーに env を使ってはいけない。
// env は同一 isolate 内でリクエスト間に共有されるため、PrismaClient が
// リクエストを跨いで使い回され、「A promise was resolved from a different
// request context」とともに継続がキャンセルされて応答がハングする（500 になる）。
//
// キーには getCloudflareContext() の戻り値そのもの（OpenNext が AsyncLocalStorage に
// 積む { env, ctx, cf } のストア）を使う。これはリクエストごとに必ず新規生成される。
const clientCache = new WeakMap<object, PrismaClient>();

function resolvePrisma(): PrismaClient {
  const context = getCloudflareContext();
  const key = context as unknown as object;
  let client = clientCache.get(key);
  if (!client) {
    // env.DB は wrangler.jsonc の d1_databases[].binding = "DB" に対応
    const adapter = new PrismaD1((context.env as unknown as { DB: D1Database }).DB);
    client = new PrismaClient({ adapter });
    clientCache.set(key, client);
  }
  return client;
}

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    const client = resolvePrisma();
    const value = Reflect.get(client, prop, receiver);
    return typeof value === "function"
      ? (value as (...args: unknown[]) => unknown).bind(client)
      : value;
  },
});
