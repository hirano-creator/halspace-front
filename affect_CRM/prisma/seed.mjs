// 初期データ投入スクリプト
// 実行: npm run db:seed（package.json の prisma.seed 経由で tsx が走る。
// 生成済みクライアントが TypeScript のため、素の node ではなく tsx で実行する）
//
// 投入内容:
// - スタッフ（管理者・スタッフを 1 名ずつ。権限差の動作確認に使う）
// - 選択肢マスタ（来店目的・来店経路・未購入理由・顧客ランク・サーフィン系）
// - 顧客タグ・商品カテゴリ・店舗設定
//
// 何度流しても壊れないよう upsert（既存行は触らない）。
// 環境変数 SEED_MINIMAL=1 を付けると本番向けにサンプルのスタッフアカウントを投入しない。
//
// 接続先は DATABASE_URL（PostgreSQL）。アプリ本体（src/lib/db.ts）と同じく
// 生成済みクライアント（src/generated/prisma）＋ @prisma/adapter-pg で繋ぐ。

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const minimal = process.env.SEED_MINIMAL === "1";

async function main() {
  // ---------------------------------------------------------------
  // スタッフ
  // ---------------------------------------------------------------
  const staffs = [
    { id: "staff-admin", email: "admin@affect.local", name: "管理者", role: "ADMIN", password: "affect2026" },
    ...(minimal
      ? []
      : [{ id: "staff-hirano", email: "staff@affect.local", name: "平野 健太", role: "STAFF", password: "affect2026" }]),
  ];
  for (const s of staffs) {
    await prisma.staff.upsert({
      where: { id: s.id },
      update: {},
      create: {
        id: s.id,
        email: s.email,
        passwordHash: bcrypt.hashSync(s.password, 10),
        name: s.name,
        role: s.role,
      },
    });
  }

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
      ["INSTAGRAM", "Instagram"],
      ["REFERRAL", "紹介"],
      ["WALKIN", "通りがかり"],
      ["EXISTING", "既存客"],
      ["WEBSITE", "ホームページ"],
      ["GOOGLE", "Google"],
      ["YAHOO", "Yahoo!"],
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
    for (const [i, [code, label]] of items.entries()) {
      await prisma.masterOption.upsert({
        where: { id: `mo-${type}-${code}` },
        update: {},
        create: { id: `mo-${type}-${code}`, type, code, label, sortOrder: i },
      });
    }
  }

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
  for (const [i, [id, name, color]] of tags.entries()) {
    await prisma.tag.upsert({
      where: { id: `tag-${id}` },
      update: {},
      create: { id: `tag-${id}`, name, color, sortOrder: i },
    });
  }

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
  for (const [i, [id, name]] of categories.entries()) {
    await prisma.productCategory.upsert({
      where: { id: `cat-${id}` },
      update: {},
      create: { id: `cat-${id}`, name, sortOrder: i },
    });
  }

  // ---------------------------------------------------------------
  // 店舗設定
  // ---------------------------------------------------------------
  for (const [key, value] of [
    ["shopName", "affect"],
    ["customerCodePrefix", "A"],
  ]) {
    await prisma.setting.upsert({ where: { key }, update: {}, create: { key, value } });
  }

  console.log(`初期データを投入しました（${minimal ? "最小構成" : "サンプルスタッフ込み"}）`);
  console.log(
    minimal
      ? "ログイン: admin@affect.local  パスワード: affect2026"
      : "ログイン: admin@affect.local / staff@affect.local  パスワード: affect2026",
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
