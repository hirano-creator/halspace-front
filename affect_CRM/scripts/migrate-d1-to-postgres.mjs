// Cloudflare D1（SQLite）のエクスポートを PostgreSQL（Prisma）へ投入する一回限りの移行スクリプト
// （TimeCalc の scripts/migrate-d1-to-postgres.mjs と同じ構造）
//
// 使い方:
//   1. npx wrangler@4 d1 export affect-crm --remote --output=d1.sql   （wrangler ログイン済みの端末で）
//   2. DATABASE_URL を移行先の PostgreSQL にして（.env から読む場合は --env-file=.env）
//      node --env-file=.env --import tsx scripts/migrate-d1-to-postgres.mjs d1.sql          → 件数の事前確認だけ（書き込まない）
//      node --env-file=.env --import tsx scripts/migrate-d1-to-postgres.mjs d1.sql --write  → 投入（主キーで upsert。移行先の行は消さない）
//
// D1 側には一切書き込まない（エクスポートを読むだけ）。
// エクスポートSQLは node:sqlite のインメモリDBにそのまま流して読み出す（SQL文の変換はしない）。
// SQLite → PostgreSQL で表現が変わる列だけ型を直す:
//   - Boolean: 0/1 → false/true
//   - DateTime: ISO-8601 文字列 → Date
// 投入は FK の依存順。id は元の値をそのまま使う（顧客番号・来店・購入の関連を保つため）。
// RateLimit は連打防止の一時記録なので移行しない。

import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const [, , dumpPath, flag] = process.argv;
if (!dumpPath) {
  console.error("使い方: tsx scripts/migrate-d1-to-postgres.mjs <d1-export.sql> [--write]");
  process.exit(1);
}
const write = flag === "--write";

// モデルごとの型変換が必要な列（prisma/schema.prisma と同期させること）
const BOOLEAN_COLUMNS = {
  Staff: ["isActive"],
  Tag: ["isActive"],
  Visit: ["purchased", "isFirstVisit"],
  ProductCategory: ["isActive"],
  Product: ["isActive"],
  SchoolCourse: ["isPublished", "isActive"],
  SchoolSession: ["isPublished"],
  MasterOption: ["isActive"],
};
const DATETIME_COLUMNS = {
  Staff: ["createdAt", "updatedAt"],
  Customer: ["birthday", "firstVisitAt", "lastVisitAt", "lastPurchaseAt", "deletedAt", "createdAt", "updatedAt"],
  CustomerSurfProfile: ["updatedAt"],
  Tag: ["createdAt"],
  CustomerTag: ["createdAt"],
  Visit: ["visitedAt", "followUpDate", "createdAt", "updatedAt"],
  Product: ["createdAt", "updatedAt"],
  Purchase: ["purchasedAt", "createdAt", "updatedAt"],
  SchoolCourse: ["createdAt", "updatedAt"],
  SchoolSession: ["date", "createdAt", "updatedAt"],
  Reservation: ["cancelledAt", "createdAt", "updatedAt"],
  SchoolAttendance: ["attendedAt", "createdAt", "updatedAt"],
  FollowUp: ["dueDate", "completedAt", "createdAt", "updatedAt"],
  CustomerNote: ["createdAt"],
  MasterOption: ["createdAt", "updatedAt"],
  Setting: ["updatedAt"],
  AuditLog: ["createdAt"],
};

// FK の依存順（親 → 子）: [テーブル名, Prisma のモデルアクセサ, 主キー列]
// 主キーが複合のものは列名の配列（Prisma の where は customerId_tagId の形になる）
const TABLES = [
  ["Staff", "staff", "id"],
  ["ProductCategory", "productCategory", "id"],
  ["Product", "product", "id"],
  ["Tag", "tag", "id"],
  ["MasterOption", "masterOption", "id"],
  ["Setting", "setting", "key"],
  ["SchoolCourse", "schoolCourse", "id"],
  ["Customer", "customer", "id"],
  ["CustomerSurfProfile", "customerSurfProfile", "id"],
  ["CustomerTag", "customerTag", ["customerId", "tagId"]],
  ["SchoolCourseStaff", "schoolCourseStaff", ["courseId", "staffId"]],
  ["SchoolSession", "schoolSession", "id"],
  ["Visit", "visit", "id"],
  ["VisitGuest", "visitGuest", "id"],
  ["VisitInterest", "visitInterest", "id"],
  ["Purchase", "purchase", "id"],
  ["PurchaseItem", "purchaseItem", "id"],
  ["Reservation", "reservation", "id"],
  ["SchoolAttendance", "schoolAttendance", "id"],
  ["FollowUp", "followUp", "id"],
  ["CustomerNote", "customerNote", "id"],
  ["AuditLog", "auditLog", "id"],
];

// ── 1. エクスポートSQLをインメモリ SQLite に流す ──
// D1 のエクスポートは CREATE TABLE の順が FK の依存順になっていない（VisitInterest の
// INSERT が Product の CREATE より前に出る）ので、読み込み時は FK 制約を切っておく。
const sqlite = new DatabaseSync(":memory:", { enableForeignKeyConstraints: false });
const dump = readFileSync(dumpPath, "utf8");
sqlite.exec(dump);

function convertRow(table, row) {
  const out = { ...row };
  for (const col of BOOLEAN_COLUMNS[table] ?? []) {
    if (col in out && out[col] !== null) out[col] = out[col] === 1 || out[col] === true;
  }
  for (const col of DATETIME_COLUMNS[table] ?? []) {
    if (col in out && out[col] !== null) out[col] = new Date(out[col]);
  }
  return out;
}

const source = new Map();
for (const [table] of TABLES) {
  const exists = sqlite
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table);
  const rows = exists ? sqlite.prepare(`SELECT * FROM "${table}"`).all() : [];
  source.set(table, rows.map((r) => convertRow(table, { ...r })));
}

console.log("エクスポート側の件数:");
let total = 0;
for (const [table] of TABLES) {
  const n = source.get(table).length;
  total += n;
  console.log(`  ${table.padEnd(20)} ${n}`);
}
console.log(`  ${"合計".padEnd(20)} ${total}`);

if (!write) {
  console.log("\n--write を付けると上記を投入します（主キーで upsert。移行先の行は消しません）。");
  process.exit(0);
}

// ── 2. PostgreSQL へ投入（削除なし・upsert） ──
// 行は主キーで upsert する: 既存行は D1 の値で更新、無い行は追加。移行先にしかない行はそのまま残す。
// 同じエクスポートを何度流しても結果が変わらない（冪等）ので、切替の前後で2回流せる。
// seed で入れた MasterOption / Tag / ProductCategory / Setting / Staff は同じ id なので
// D1 側の値（label・sortOrder・isActive・passwordHash 等）で上書きされる。
// 一意制約違反（Customer.code や Staff.email が id 違いで両側にある等）は
// 移行先（新しい方）を優先してスキップし、最後に一覧を出す。
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

/** 主キー列の where 句と、update に使う残りの列を作る */
function splitKey(pk, row) {
  if (Array.isArray(pk)) {
    const where = { [pk.join("_")]: Object.fromEntries(pk.map((c) => [c, row[c]])) };
    const rest = { ...row };
    for (const c of pk) delete rest[c];
    return { where, rest, label: pk.map((c) => row[c]).join("/") };
  }
  const { [pk]: keyValue, ...rest } = row;
  return { where: { [pk]: keyValue }, rest, label: keyValue };
}

const skipped = [];
try {
  let upserted = 0;
  for (const [table, model, pk] of TABLES) {
    for (const row of source.get(table)) {
      const { where, rest, label } = splitKey(pk, row);
      try {
        await prisma[model].upsert({ where, create: row, update: rest });
        upserted++;
      } catch (e) {
        // P2002 = 一意制約違反。新側を優先して飛ばす。
        // P2003 = 参照先が無い（親行が P2002 で飛ばされた場合など）。同じく飛ばして一覧に出す
        if (e?.code === "P2002" || e?.code === "P2003") {
          const meta = e.meta ?? {};
          const detail = e.code === "P2003" ? `FK: ${meta.constraint ?? meta.field_name ?? ""}` : JSON.stringify(meta);
          skipped.push({ table, key: label, code: e.code, detail });
          continue;
        }
        throw e;
      }
    }
  }
  console.log(`\nupsert 完了: ${upserted} 行`);

  console.log("\n投入後の件数（PostgreSQL）※移行先にしかない行がある場合はその分多くなります:");
  let short = false;
  for (const [table, model] of TABLES) {
    const count = await prisma[model].count();
    const expected = source.get(table).length;
    const ok = count >= expected;
    if (!ok) short = true;
    console.log(
      `  ${table.padEnd(20)} ${count}${count === expected ? "" : `  （エクスポート側 ${expected}）`}${ok ? "" : "  ← 不足"}`,
    );
  }

  if (skipped.length > 0) {
    console.log(`\nスキップ ${skipped.length} 行（一意制約違反は移行先の行を優先。FK 違反は親行が無い）:`);
    for (const s of skipped) console.log(`  ${s.code} ${s.table} ${s.key} ${s.detail}`);
  }
  console.log(
    short
      ? "\n件数が不足しているテーブルがあります。"
      : skipped.length > 0
        ? "\n完了（スキップ行あり。上の一覧を確認してください）。"
        : "\n完了: すべてのテーブルでエクスポート側の件数以上になりました。",
  );
  process.exitCode = short ? 1 : 0;
} finally {
  await prisma.$disconnect();
}
