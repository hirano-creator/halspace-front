// 初期データ投入スクリプト
// 実行: npx prisma db seed
//
// 投入内容:
// - 部署（製造部・総務部）
// - 初期ユーザー4名（管理者・店長・一般社員×2）
// - 動作確認用のサンプル勤怠データ（2026年7月）
//
// 環境変数 SEED_MINIMAL=1 を付けると本番向けに
// 部署と管理者アカウントのみ投入する（ダミー社員・サンプル勤怠なし）

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  // 部署
  const manufacturing = await prisma.department.upsert({
    where: { name: "製造部" },
    update: {},
    create: { name: "製造部" },
  });
  const general = await prisma.department.upsert({
    where: { name: "総務部" },
    update: {},
    create: { name: "総務部" },
  });

  const minimal = process.env.SEED_MINIMAL === "1";

  // 初期ユーザー（パスワードは初回ログイン後に変更すること）
  const allUsers = [
    {
      employeeCode: "0001",
      name: "管理者",
      email: "admin@example.com",
      role: "ADMIN",
      hourlyWage: 0,
      departmentId: general.id,
      password: "admin123",
    },
    {
      employeeCode: "0002",
      name: "店長 花子",
      email: "tencho@example.com",
      role: "MANAGER",
      hourlyWage: 1500,
      departmentId: manufacturing.id,
      password: "password123",
    },
    {
      employeeCode: "0003",
      name: "工場 太郎",
      email: "kojo@example.com",
      role: "EMPLOYEE",
      hourlyWage: 1300,
      departmentId: manufacturing.id,
      password: "password123",
    },
    {
      employeeCode: "0004",
      name: "平野 次郎",
      email: null,
      role: "PART_TIME",
      hourlyWage: 1200,
      departmentId: manufacturing.id,
      password: "password123",
    },
  ];

  const users = minimal ? allUsers.filter((u) => u.role === "ADMIN") : allUsers;

  for (const u of users) {
    const passwordHash = await bcrypt.hash(u.password, 10);
    await prisma.user.upsert({
      where: { employeeCode: u.employeeCode },
      update: {},
      create: {
        employeeCode: u.employeeCode,
        name: u.name,
        email: u.email,
        role: u.role,
        hourlyWage: u.hourlyWage ?? 0,
        departmentId: u.departmentId,
        passwordHash,
      },
    });
  }

  if (minimal) {
    console.log("シード完了（最小構成）: 部署2件・管理者アカウント1件");
    console.log("ログイン: 社員番号 0001 / パスワード admin123 ※必ず変更すること");
    return;
  }

  // サンプル勤怠（2026年7月第1週・製造部の2名）
  const kojo = await prisma.user.findUnique({ where: { employeeCode: "0003" } });
  const jiro = await prisma.user.findUnique({ where: { employeeCode: "0004" } });
  const samples = [
    { user: kojo, date: "2026-07-01", clockIn: "07:45", clockOut: "18:32" },
    { user: kojo, date: "2026-07-02", clockIn: "08:00", clockOut: "19:35" },
    { user: kojo, date: "2026-07-03", clockIn: "07:58", clockOut: "18:01" },
    { user: jiro, date: "2026-07-01", clockIn: "06:30", clockOut: "18:00" },
    { user: jiro, date: "2026-07-02", clockIn: "08:01", clockOut: "20:05" },
    { user: jiro, date: "2026-07-03", clockIn: "07:55", clockOut: "17:59" },
  ];
  for (const s of samples) {
    if (!s.user) continue;
    await prisma.attendance.upsert({
      where: { userId_date: { userId: s.user.id, date: s.date } },
      update: {},
      create: {
        userId: s.user.id,
        date: s.date,
        clockIn: s.clockIn,
        clockOut: s.clockOut,
        breakMinutes: 60,
      },
    });
  }

  console.log("シード完了: 部署2件・ユーザー4件・サンプル勤怠6件");
  console.log("ログイン例: 社員番号 0001 / パスワード admin123（管理者）");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
