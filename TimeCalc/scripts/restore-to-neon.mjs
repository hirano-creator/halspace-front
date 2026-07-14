// scripts/local-data-dump.json を本番Neonに投入する（一回限りの補助スクリプト）
// 実行前に DATABASE_URL を Neon の接続文字列にして、
// Postgres用クライアント（npx prisma generate --schema prisma/schema.postgres.prisma）を生成しておくこと
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";

const prisma = new PrismaClient();
const data = JSON.parse(readFileSync("scripts/local-data-dump.json", "utf8"));

// 投入前にNeon側の既存データ（最小構成シード）を一掃する（依存関係の逆順で削除）
await prisma.attendance.deleteMany({});
await prisma.importHistory.deleteMany({});
await prisma.user.deleteMany({});
await prisma.department.deleteMany({});
await prisma.setting.deleteMany({});
console.log("Neon既存データをクリアしました");

// 依存関係の順番で投入する（部署→社員→勤怠/取込履歴、設定は独立）
for (const d of data.departments) {
  await prisma.department.upsert({ where: { id: d.id }, update: d, create: d });
}
for (const u of data.users) {
  await prisma.user.upsert({ where: { id: u.id }, update: u, create: u });
}
for (const a of data.attendances) {
  await prisma.attendance.upsert({ where: { id: a.id }, update: a, create: a });
}
for (const h of data.importHistories) {
  await prisma.importHistory.upsert({ where: { id: h.id }, update: h, create: h });
}
for (const s of data.settings) {
  await prisma.setting.upsert({ where: { key: s.key }, update: s, create: s });
}

console.log(
  `投入完了: 部署${data.departments.length}件・社員${data.users.length}件・勤怠${data.attendances.length}件・取込履歴${data.importHistories.length}件・設定${data.settings.length}件`,
);

await prisma.$disconnect();
