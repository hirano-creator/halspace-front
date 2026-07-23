// PrismaClient の解決
//
// Cloudflare D1（Workers/OpenNext）では、DB はリクエストごとに渡される
// バインディング（env.DB）経由でしか触れないため、従来の
// `new PrismaClient()` を1度だけ生成するシングルトンは使えない。
//
// そこで getCloudflareContext() から env.DB を取り出して PrismaClient を作る。
// 呼び出し側（約49ファイルの route/サービス層）を書き換えずに済むよう、
// 既存の `prisma` エクスポート名を Proxy で温存する。
//   - Proxy なので実際に prisma.xxx がアクセスされた瞬間だけ context を解決する
//     → モジュール読み込み・ビルド時評価では context を触らず安全。
//   - リクエストごとに1つの PrismaClient を env をキーにキャッシュ（WeakMap）。
//     同一リクエスト内では env は同一参照なので使い回され、$transaction も
//     同一クライアント上で完結する。

import { PrismaClient } from "@/generated/prisma/client";
import { PrismaD1 } from "@prisma/adapter-d1";
import { getCloudflareContext } from "@opennextjs/cloudflare";

// リクエストごとに一意な ExecutionContext(ctx) を鍵にした PrismaClient キャッシュ。
// ctx はリクエスト終了で参照が消えるため WeakMap なら自動で解放される。
//
// 重要: env をキーにしてはいけない。env は同一 isolate 内でリクエスト間に
// 共有されるため、PrismaClient がリクエストを跨いで使い回され、
// 「A promise was resolved from a different request context」警告とともに
// 継続がキャンセルされ、応答がハングする（編集画面が「読み込み中」のまま開かない）。
// ctx をキーにすればリクエストスコープに閉じ、この問題が起きない。
const clientCache = new WeakMap<object, PrismaClient>();

function resolvePrisma(): PrismaClient {
  const { env, ctx } = getCloudflareContext();
  // ctx はリクエストごとに新規。取れない実行時（静的レンダリング等）は env で代替。
  const key = (ctx ?? env) as unknown as object;
  let client = clientCache.get(key);
  if (!client) {
    // env.DB は wrangler.jsonc の d1_databases[].binding = "DB" に対応
    const adapter = new PrismaD1((env as unknown as { DB: D1Database }).DB);
    client = new PrismaClient({ adapter });
    clientCache.set(key, client);
  }
  return client;
}

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    const client = resolvePrisma();
    const value = Reflect.get(client, prop, receiver);
    return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(client) : value;
  },
});
