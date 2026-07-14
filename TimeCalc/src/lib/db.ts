// PrismaClient のシングルトン
// 開発時のホットリロードで接続が増殖しないよう、また本番のサーバーレス環境で
// ウォームコンテナ間に同一クライアント（＝接続）を使い回せるよう globalThis に保持する

import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

globalForPrisma.prisma = prisma;
