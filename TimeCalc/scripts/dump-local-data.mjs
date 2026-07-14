// ローカルSQLiteの全データをJSONに書き出す（本番Neonへの移行用・一回限りの補助スクリプト）
import { PrismaClient } from "@prisma/client";
import { writeFileSync } from "node:fs";

const prisma = new PrismaClient();

const [departments, users, attendances, importHistories, settings] = await Promise.all([
  prisma.department.findMany(),
  prisma.user.findMany(),
  prisma.attendance.findMany(),
  prisma.importHistory.findMany(),
  prisma.setting.findMany(),
]);

writeFileSync(
  "scripts/local-data-dump.json",
  JSON.stringify({ departments, users, attendances, importHistories, settings }, null, 2),
);

console.log(
  `書き出し完了: 部署${departments.length}件・社員${users.length}件・勤怠${attendances.length}件・取込履歴${importHistories.length}件・設定${settings.length}件`,
);

await prisma.$disconnect();
