// Cloudflare 向けビルド
//
// ★なぜ素直に `opennextjs-cloudflare build` を呼ばないか
//
// OpenNext は node_modules 内で見つけた **すべての .wasm** を列挙して
// 「パス → 動的 import」の巨大な switch を handler.mjs に埋め込む。
// prisma CLI（node_modules/prisma）は PostgreSQL / MySQL / CockroachDB /
// SQLServer 向けのクエリエンジンを 12 個以上同梱しているため、
// D1（SQLite）では 1 つも使わないのに全部がバンドルに入り、
// Worker が無料枠の 3 MiB 制限を超えてデプロイできなくなる（実際に踏んだ）。
//
// prisma CLI は generate / migrate diff にしか使わず、実行時には不要なので、
// ビルドの間だけ退避して OpenNext の目に触れないようにする。
// 失敗しても必ず元に戻す。

import { execSync } from "node:child_process";
import { existsSync, renameSync } from "node:fs";

const CLI_DIR = "node_modules/prisma";
const HIDDEN_DIR = "node_modules/.prisma-cli-hidden";

const run = (cmd) => execSync(cmd, { stdio: "inherit" });

// 前回のビルドが異常終了して退避したままなら、先に戻す
if (existsSync(HIDDEN_DIR) && !existsSync(CLI_DIR)) {
  renameSync(HIDDEN_DIR, CLI_DIR);
  console.log("前回の退避を戻しました");
}

// Prisma クライアントの生成には CLI が要るので、隠す前に済ませる
run("npx prisma generate");

let hidden = false;
if (existsSync(CLI_DIR)) {
  renameSync(CLI_DIR, HIDDEN_DIR);
  hidden = true;
  console.log("prisma CLI をビルド対象から退避しました");
}

try {
  run("npx opennextjs-cloudflare build");
} finally {
  if (hidden && existsSync(HIDDEN_DIR)) {
    renameSync(HIDDEN_DIR, CLI_DIR);
    console.log("prisma CLI を元に戻しました");
  }
}
