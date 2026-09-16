// PrismaClient の解決
//
// Railway 上の常駐 Node.js プロセスで動くので、通常のシングルトンでよい。
// 接続先は DATABASE_URL（PostgreSQL）。engineType="client" のため Rust エンジンは不要で、
// driver adapter（@prisma/adapter-pg）が pg のコネクションプールを持つ。
//
// globalThis に退避するのは Next.js の開発サーバー（HMR）でモジュールが
// 再評価されるたびに新しいプールが作られ、接続が増え続けるのを防ぐため。

import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as { __affectCrmPrisma?: PrismaClient };

function createPrisma(): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
}

export const prisma: PrismaClient = globalForPrisma.__affectCrmPrisma ?? createPrisma();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.__affectCrmPrisma = prisma;
}
