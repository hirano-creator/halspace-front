// Netlifyビルド用: schema.prisma から PostgreSQL 用スキーマを生成する
//
// ローカル開発は SQLite、本番（Netlify + Neon/Railway等）は PostgreSQL を使う。
// Prisma は provider を環境変数で切り替えられないため、ビルド時に
// provider だけを差し替えた schema.postgres.prisma を生成して使う。
// （手書きの複製を持たないことでスキーマの二重管理を防ぐ）

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "prisma", "schema.prisma");
const dest = path.join(root, "prisma", "schema.postgres.prisma");

const schema = readFileSync(src, "utf8");

if (!schema.includes('provider = "sqlite"')) {
  console.error("schema.prisma に provider = \"sqlite\" が見つかりません。構成を確認してください。");
  process.exit(1);
}

const converted = schema.replace('provider = "sqlite"', 'provider = "postgresql"');
writeFileSync(dest, converted);
console.log(`生成完了: ${dest}（provider: sqlite → postgresql）`);

const url = process.env.DATABASE_URL ?? "";
if (url.startsWith("file:")) {
  console.warn(
    "警告: DATABASE_URL が SQLite のままです。Netlify の環境変数に PostgreSQL の接続文字列を設定してください。",
  );
}
