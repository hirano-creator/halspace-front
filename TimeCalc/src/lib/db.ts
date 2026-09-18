// PrismaClient の解決（PostgreSQL、driver adapter 経由）
//
// プロセス内で1つの PrismaClient（＝1つの pg 接続プール）を使い回すシングルトン。
// globalThis に退避するのは `next dev` のHMR対策だけでなく、本番ビルドでも
// このモジュールが複数のチャンク（API routes 用と Server Component 用）に別々に
// バンドルされて評価されるため。退避しないとプールがチャンクの数だけできる。
//
// 生成時点では DB に接続しない（最初のクエリで接続する）ので、DATABASE_URL が無い
// 環境（ユニットテスト等）でも import 自体は安全。未設定のまま実クエリを投げると
// pg 側の接続エラーになる。
//
// 呼び出し側（route / サービス層）は従来どおり `prisma` を import するだけでよい。

import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as { __timecalcPrisma?: PrismaClient };

/**
 * 接続プールの上限。pg の既定は 10 で、朝の出勤ラッシュ（100人が数分に集中）では
 * 並列クエリが待たされる。Railway Postgres の max_connections（既定100）に対して、
 * migrate deploy とバックアップ用サービスの分を残して 20 にしている。
 * レプリカを増やす場合は「レプリカ数 × この値」が上限を超えないよう DB_POOL_MAX で下げる。
 */
const POOL_MAX = Number(process.env.DB_POOL_MAX) || 20;

function createPrisma(): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({
      connectionString: process.env.DATABASE_URL,
      max: POOL_MAX,
      // 空きが無いときの待ち時間。無期限（pg の既定）だと DB が詰まった際にリクエストが
      // 永遠に応答せず、クライアント側のリトライまで積み上がるので、早めに失敗させる
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 30_000,
      // 1クエリの上限。集計系でも数百msで終わる想定なので、これを超えるのはロック待ちや異常系
      statement_timeout: 30_000,
    }),
  });
}

export const prisma: PrismaClient = globalForPrisma.__timecalcPrisma ?? createPrisma();
globalForPrisma.__timecalcPrisma = prisma;
