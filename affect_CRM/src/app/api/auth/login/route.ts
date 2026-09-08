import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { createSessionToken, type SessionUser } from "@/lib/auth/session";
import { toRole } from "@/lib/auth/roles";
import { clearRateLimit, clientIp, countAttempts, recordAttempt } from "@/lib/rate-limit";

// 総当たり対策。失敗したときだけ数える（正常なログインは何回でも通す）。
// IP とメールアドレスの両方で制限する。IP だけだと特定アカウントへの
// 分散した総当たりを止められず、メールだけだと IP を変えられて意味がないため。
const WINDOW_MS = 15 * 60 * 1000;
const MAX_PER_IP = 20;
const MAX_PER_EMAIL = 10;

export async function POST(request: Request) {
  const form = await request.formData();
  const email = String(form.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(form.get("password") ?? "");

  if (!email) return NextResponse.json({ error: "メールアドレスを入力してください" }, { status: 400 });
  if (!password) return NextResponse.json({ error: "パスワードを入力してください" }, { status: 400 });

  const ipKey = `login:ip:${clientIp(request)}`;
  const emailKey = `login:email:${email}`;

  const [ipFails, emailFails] = await Promise.all([
    countAttempts(ipKey, WINDOW_MS),
    countAttempts(emailKey, WINDOW_MS),
  ]);
  if (ipFails >= MAX_PER_IP || emailFails >= MAX_PER_EMAIL) {
    return NextResponse.json(
      { error: "ログインの試行が続いたため、しばらくお待ちください（15 分ほど）" },
      { status: 429 },
    );
  }

  const staff = await prisma.staff.findUnique({ where: { email } });

  // ユーザー不存在・パスワード不一致・無効アカウントでメッセージを変えない
  // （どのメールアドレスが登録されているかを推測されないようにするため）
  const ok = staff && staff.isActive && (await verifyPassword(password, staff.passwordHash));
  if (!ok) {
    await Promise.all([recordAttempt(ipKey), recordAttempt(emailKey)]);
    return NextResponse.json(
      { error: "メールアドレスまたはパスワードが違います" },
      { status: 401 },
    );
  }

  // 正常にログインできたら失敗記録を消す（普段使いで制限にかからないように）
  await clearRateLimit(emailKey);

  const user: SessionUser = {
    id: staff.id,
    email: staff.email,
    name: staff.name,
    role: toRole(staff.role),
  };
  const token = await createSessionToken(user);

  return NextResponse.json({ token, user });
}
