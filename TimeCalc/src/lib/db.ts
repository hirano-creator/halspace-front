// PrismaClient の解決（PostgreSQL、driver adapter 経由）
//
// プロセス内で1つの PrismaClient を使い回す通常のシングルトン。
// `next dev` の HMR でモジュールが再評価されても接続プールが増殖しないよう
// globalThis に退避する（本番では1回しか評価されないので実質ただの定数）。
//
// 生成時点では DB に接続しない（最初のクエリで接続する）ので、DATABASE_URL が無い
// 環境（ユニットテスト等）でも import 自体は安全。未設定のまま実クエリを投げると
// pg 側の接続エラーになる。
//
// 呼び出し側（route / サービス層）は従来どおり `prisma` を import するだけでよい。

import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as { __timecalcPrisma?: PrismaClient };

function createPrisma(): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
}

export const prisma: PrismaClient = globalForPrisma.__timecalcPrisma ?? createPrisma();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.__timecalcPrisma = prisma;
}
