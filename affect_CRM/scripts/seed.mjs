// 初期データ（管理者・選択肢マスタ・タグ・商品カテゴリ）の SQL を生成する。
//
// D1 には Prisma の seed をそのまま流せないため、ここで INSERT 文を組み立てて
// migrations/seed.sql に出力し、wrangler d1 execute で流す。
//
//   node scripts/seed.mjs
//   npx wrangler d1 execute affect-crm --local  --file migrations/seed.sql
//   npx wrangler d1 execute affect-crm --remote --file migrations/seed.sql
//
// 生成物にはパスワードハッシュが入るため .gitignore 済み。

import bcrypt from "bcryptjs";
import { writeFileSync, mkdirSync } from "node:fs";

// ★Prisma(D1) は DateTime を ISO 8601 文字列で読み書きする。
// epoch ミリ秒（数値）で入れると、Prisma が作った行（文字列）と型が混在し、
// 同じ列を読むときに「expected a either an i64 or a f64」で 500 になる。
// Prisma が書くのと同じ "+00:00" 表記に合わせること。
const now = new Date().toISOString().replace("Z", "+00:00");

const q = (v) => (v === null || v === undefined ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);

const lines = [
  "-- affect CRM 初期データ",
  "--",
  "-- 実行方法:",
  "--   node scripts/seed.mjs",
  "--   npx wrangler d1 execute affect-crm --local  --file migrations/seed.sql",
  "--   npx wrangler d1 execute affect-crm --remote --file migrations/seed.sql",
  "--",
  "-- 何度流しても壊れないよう INSERT OR IGNORE を使う。",
  "",
];

// ---------------------------------------------------------------
// スタッフ（管理者・スタッフを 1 名ずつ。権限差の動作確認に使う）
// ---------------------------------------------------------------
const staffs = [
  { id: "staff-admin", email: "admin@affect.local", name: "管理者", role: "ADMIN", password: "affect2026" },
  { id: "staff-hirano", email: "staff@affect.local", name: "平野 健太", role: "STAFF", password: "affect2026" },
];

for (const s of staffs) {
  const hash = bcrypt.hashSync(s.password, 10);
  lines.push(
    `INSERT OR IGNORE INTO "Staff" ("id","email","passwordHash","name","role","isActive","createdAt","updatedAt") ` +
      `VALUES (${q(s.id)},${q(s.email)},${q(hash)},${q(s.name)},${q(s.role)},1,${q(now)},${q(now)});`,
  );
}
lines.push("");

// ---------------------------------------------------------------
// 選択肢マスタ
//   code は分析の集計キー。一度決めたら変更しない。
//   label は設定画面から自由に変更してよい。
// ---------------------------------------------------------------
const masters = {
  VISIT_PURPOSE: [
    ["LOOK", "商品下見"],
    ["BUY", "購入"],
    ["FITTING", "試着"],
    ["REPAIR", "修理相談"],
    ["SCHOOL", "スクール"],
    ["BROWSE", "見るだけ"],
    ["OTHER", "その他"],
  ],
  VISIT_CHANNEL: [
    ["FIRST", "初めて"],
    ["INSTAGRAM", "Instagram"],
    ["REFERRAL", "紹介"],
    ["WALKIN", "通りがかり"],
    ["EXISTING", "既存客"],
    ["WEBSITE", "ホームページ"],
    ["OTHER", "その他"],
  ],
  REFERRER: [
    ["IG_POST", "Instagram 投稿"],
    ["IG_STORY", "Instagram ストーリー"],
    ["WEBSITE", "ホームページ"],
    ["SIGNBOARD", "店頭の看板"],
    ["WORD_OF_MOUTH", "口コミ"],
    ["FLYER", "チラシ"],
    ["OTHER", "その他"],
  ],
  NO_PURCHASE_REASON: [
    ["CONSIDERING", "検討中"],
    ["PRICE", "価格"],
    ["COMPARING", "他店比較"],
    ["NO_ITEM", "欲しい商品がない"],
    ["NO_SIZE", "サイズがない"],
    ["TIMING", "時期が合わない"],
    ["RESEARCH", "情報収集"],
    ["CONSULT_ONLY", "相談のみ"],
    ["OTHER", "その他"],
  ],
  CUSTOMER_RANK: [
    ["NEW", "新規"],
    ["REGULAR", "常連"],
    ["VIP", "VIP"],
  ],
  SURF_LEVEL: [
    ["NONE", "未経験"],
    ["BEGINNER", "初心者"],
    ["ELEMENTARY", "初級"],
    ["INTERMEDIATE", "中級"],
    ["ADVANCED", "上級"],
  ],
  BOARD_TYPE: [
    ["SHORT", "ショートボード"],
    ["LONG", "ロングボード"],
    ["FUN", "ファンボード"],
    ["MID", "ミッドレングス"],
    ["FISH", "フィッシュ"],
    ["NONE", "持っていない"],
  ],
  WETSUIT_SIZE: [
    ["XS", "XS"],
    ["S", "S"],
    ["M", "M"],
    ["L", "L"],
    ["XL", "XL"],
    ["ORDER", "オーダー"],
  ],
  SURF_FREQUENCY: [
    ["W2", "週 2 回以上"],
    ["W1", "週 1 回"],
    ["M23", "月 2〜3 回"],
    ["M1", "月 1 回"],
    ["Y", "年に数回"],
  ],
  // よく行くポイントは店舗の地域に依存するため、設定画面から登録してもらう
  SURF_POINT: [],
};

for (const [type, items] of Object.entries(masters)) {
  items.forEach(([code, label], i) => {
    lines.push(
      `INSERT OR IGNORE INTO "MasterOption" ("id","type","code","label","sortOrder","isActive","createdAt","updatedAt") ` +
        `VALUES (${q(`mo-${type}-${code}`)},${q(type)},${q(code)},${q(label)},${i},1,${q(now)},${q(now)});`,
    );
  });
}
lines.push("");

// ---------------------------------------------------------------
// 顧客タグ
// ---------------------------------------------------------------
const tags = [
  ["beginner", "初心者", "#0b86ab"],
  ["intermediate", "中級", "#0b86ab"],
  ["advanced", "上級", "#08536f"],
  ["shortboard", "ショートボード", null],
  ["longboard", "ロングボード", null],
  ["wetsuit-lead", "ウェット検討", "#bd8a35"],
  ["board-lead", "ボード検討", "#bd8a35"],
  ["instagram", "Instagram", null],
  ["repeater", "リピーター", "#17794f"],
  ["vip", "VIP", "#c2481a"],
  ["kids", "キッズ", null],
];

tags.forEach(([id, name, color], i) => {
  lines.push(
    `INSERT OR IGNORE INTO "Tag" ("id","name","color","sortOrder","isActive","createdAt") ` +
      `VALUES (${q(`tag-${id}`)},${q(name)},${q(color)},${i},1,${q(now)});`,
  );
});
lines.push("");

// ---------------------------------------------------------------
// 商品カテゴリ（来店時の「興味のある商品」の選択肢にもなる）
// ---------------------------------------------------------------
const categories = [
  ["board", "サーフボード"],
  ["wetsuit", "ウェットスーツ"],
  ["leash", "リーシュコード"],
  ["fin", "フィン"],
  ["deckpad", "デッキパッド"],
  ["wax", "ワックス"],
  ["apparel", "アパレル"],
  ["accessory", "アクセサリー"],
  ["other", "その他"],
];

categories.forEach(([id, name], i) => {
  lines.push(
    `INSERT OR IGNORE INTO "ProductCategory" ("id","name","sortOrder","isActive") ` +
      `VALUES (${q(`cat-${id}`)},${q(name)},${i},1);`,
  );
});
lines.push("");

// ---------------------------------------------------------------
// 店舗設定
// ---------------------------------------------------------------
lines.push(
  `INSERT OR IGNORE INTO "Setting" ("key","value","updatedAt") VALUES ('shopName','affect',${q(now)});`,
  `INSERT OR IGNORE INTO "Setting" ("key","value","updatedAt") VALUES ('customerCodePrefix','A',${q(now)});`,
  "",
);

mkdirSync("migrations", { recursive: true });
writeFileSync("migrations/seed.sql", lines.join("\n"), "utf8");

console.log(`migrations/seed.sql を生成しました（${lines.length} 行）`);
console.log("ログイン: admin@affect.local / staff@affect.local  パスワード: affect2026");
