// Cloudflare D1（SQLite）のエクスポートを PostgreSQL（Prisma）へ投入する一回限りの移行スクリプト
//
// 使い方:
//   1. npx wrangler@4 d1 export timecalc --remote --output=d1.sql   （wrangler ログイン済みの端末で）
//   2. DATABASE_URL を移行先の PostgreSQL にして（.env から読む場合は --env-file=.env）
//      node --env-file=.env --import tsx scripts/migrate-d1-to-postgres.mjs d1.sql          → 件数の事前確認だけ（書き込まない）
//      node --env-file=.env --import tsx scripts/migrate-d1-to-postgres.mjs d1.sql --write  → 投入（主キーで upsert。移行先の行は消さない）
//
// D1 側には一切書き込まない（エクスポートを読むだけ）。
// エクスポートSQLは node:sqlite のインメモリDBにそのまま流して読み出す（SQL文の変換はしない）。
// SQLite → PostgreSQL で表現が変わる列だけ型を直す:
//   - Boolean: 0/1 → false/true
//   - DateTime: ISO-8601 文字列 → Date
// 投入は FK の依存順。id は元の値をそのまま使う（社員番号・打刻ログの関連を保つため）。

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
  Department: ["dailyQrEnabled", "standardQrEnabled", "attendQrEnabled", "outingQrEnabled"],
  User: ["isActive", "gpsCheckEnabled"],
};
const DATETIME_COLUMNS = {
  Company: ["createdAt", "updatedAt"],
  CompanySetting: ["updatedAt"],
  Department: ["createdAt", "updatedAt"],
  User: ["createdAt", "updatedAt"],
  Attendance: ["createdAt", "updatedAt"],
  ClockEvent: ["timestamp", "createdAt"],
  ImportHistory: ["createdAt"],
  CorrectionRequest: ["createdAt", "updatedAt"],
  AttendanceLog: ["createdAt"],
  Setting: ["updatedAt"],
};

// FK の依存順（親 → 子）。削除はこの逆順
const TABLES = [
  ["Company", "company"],
  ["CompanySetting", "companySetting"],
  ["Department", "department"],
  ["User", "user"],
  ["Attendance", "attendance"],
  ["ClockEvent", "clockEvent"],
  ["ImportHistory", "importHistory"],
  ["CorrectionRequest", "correctionRequest"],
  ["AttendanceLog", "attendanceLog"],
  ["Setting", "setting"],
];

// ── 1. エクスポートSQLをインメモリ SQLite に流す ──
const sqlite = new DatabaseSync(":memory:");
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
for (const [table] of TABLES) console.log(`  ${table.padEnd(18)} ${source.get(table).length}`);

if (!write) {
  console.log("\n--write を付けると上記を投入します（主キーで upsert。移行先の行は消しません）。");
  process.exit(0);
}

// ── 2. PostgreSQL へ投入（削除なし・upsert） ──
// 行は主キーで upsert する: 既存行は D1 の値で更新、無い行は追加。移行先にしかない行はそのまま残す。
// 同じエクスポートを何度流しても結果が変わらない（冪等）ので、切替の前後で2回流せる。
// Attendance は (userId, date) の一意制約があるため、id 違いで同じ日の行が両側にあると
// 一意制約違反になる。その行は移行先（新しい方）を優先してスキップし、最後に一覧を出す。
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

/** 主キー列名（Setting だけ key、他は id） */
const keyOf = (table) => (table === "Setting" ? "key" : "id");

const skipped = [];
try {
  let upserted = 0;
  for (const [table, model] of TABLES) {
    const pk = keyOf(table);
    for (const row of source.get(table)) {
      const { [pk]: keyValue, ...rest } = row;
      try {
        await prisma[model].upsert({
          where: { [pk]: keyValue },
          create: row,
          update: rest,
        });
        upserted++;
      } catch (e) {
        // P2002 = 一意制約違反（Attendance の userId+date など）。新側を優先して飛ばす
        if (e?.code === "P2002") {
          skipped.push({ table, key: keyValue, detail: JSON.stringify(e.meta ?? {}) });
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
      `  ${table.padEnd(18)} ${count}${count === expected ? "" : `  （エクスポート側 ${expected}）`}${ok ? "" : "  ← 不足"}`,
    );
  }

  if (skipped.length > 0) {
    console.log(`\nスキップ ${skipped.length} 行（一意制約違反。移行先の行を優先しました）:`);
    for (const s of skipped) console.log(`  ${s.table} ${s.key} ${s.detail}`);
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
