// Cloudflare D1（SQLite）のエクスポートを PostgreSQL（Prisma）へ投入する一回限りの移行スクリプト
//
// 使い方:
//   1. npx wrangler@4 d1 export timecalc --remote --output=d1.sql   （wrangler ログイン済みの端末で）
//   2. DATABASE_URL を移行先の PostgreSQL にして（.env から読む場合は --env-file=.env）
//      node --env-file=.env --import tsx scripts/migrate-d1-to-postgres.mjs d1.sql          → 件数の事前確認だけ（書き込まない）
//      node --env-file=.env --import tsx scripts/migrate-d1-to-postgres.mjs d1.sql --write  → 投入（移行先の既存データは全消去してから）
//
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
  console.log("\n--write を付けると上記を投入します（移行先の既存データは全消去）。");
  process.exit(0);
}

// ── 2. PostgreSQL へ投入 ──
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

try {
  await prisma.$transaction(async (tx) => {
    for (const [, model] of [...TABLES].reverse()) {
      await tx[model].deleteMany({});
    }
    for (const [table, model] of TABLES) {
      const rows = source.get(table);
      if (rows.length > 0) await tx[model].createMany({ data: rows });
    }
  });

  console.log("\n投入後の件数（PostgreSQL）:");
  let mismatch = false;
  for (const [table, model] of TABLES) {
    const count = await prisma[model].count();
    const expected = source.get(table).length;
    const ok = count === expected;
    if (!ok) mismatch = true;
    console.log(`  ${table.padEnd(18)} ${count}${ok ? "" : `  ← 不一致（期待 ${expected}）`}`);
  }
  console.log(mismatch ? "\n件数に不一致があります。" : "\n完了: すべてのテーブルで件数が一致しました。");
  process.exitCode = mismatch ? 1 : 0;
} finally {
  await prisma.$disconnect();
}
