import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiPermission } from "@/lib/auth/api-guard";
import { hashPassword } from "@/lib/auth/password";
import { ROLES, toRole } from "@/lib/auth/roles";
import { normalizeEmail, trimOrNull } from "@/lib/normalize";
import { formatJstDate } from "@/lib/utils/time";
import type { StaffListResponse } from "@/app/(app)/staff/types";

export async function GET(request: Request) {
  const auth = await requireApiPermission(request, "staff.manage");
  if (!auth.ok) return auth.response;

  const rows = await prisma.staff.findMany({
    orderBy: [{ isActive: "desc" }, { createdAt: "asc" }],
    select: {
      id: true,
      email: true,
      name: true,
      nameKana: true,
      role: true,
      isActive: true,
      createdAt: true,
    },
  });

  const body: StaffListResponse = {
    staffs: rows.map((s) => ({
      id: s.id,
      email: s.email,
      name: s.name,
      nameKana: s.nameKana,
      role: s.role,
      isActive: s.isActive,
      createdAt: formatJstDate(s.createdAt),
      isSelf: s.id === auth.user.id,
    })),
  };

  return NextResponse.json(body);
}

export async function POST(request: Request) {
  const auth = await requireApiPermission(request, "staff.manage");
  if (!auth.ok) return auth.response;

  const form = await request.formData();
  const name = String(form.get("name") ?? "").trim();
  if (!name) return NextResponse.json({ error: "氏名を入力してください" }, { status: 400 });

  const nameKana = trimOrNull(form.get("nameKana"));

  const email = normalizeEmail(String(form.get("email") ?? ""));
  if (!email) return NextResponse.json({ error: "メールアドレスを入力してください" }, { status: 400 });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "メールアドレスの形式が正しくありません" }, { status: 400 });
  }

  const password = String(form.get("password") ?? "");
  if (password.length < 8) {
    return NextResponse.json({ error: "パスワードは 8 文字以上で設定してください" }, { status: 400 });
  }

  const exists = await prisma.staff.findUnique({ where: { email }, select: { id: true } });
  if (exists) {
    return NextResponse.json({ error: "このメールアドレスはすでに使われています" }, { status: 400 });
  }

  const role = toRole(form.get("role"));
  const staff = await prisma.staff.create({
    data: { name, nameKana, email, role, passwordHash: await hashPassword(password) },
    select: { id: true },
  });

  await prisma.auditLog.create({
    data: { staffId: auth.user.id, action: "staff.create", targetType: "Staff", targetId: staff.id },
  });

  return NextResponse.json({ staff });
}

export { ROLES };
