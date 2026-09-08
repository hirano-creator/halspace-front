import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiPermission } from "@/lib/auth/api-guard";
import { hashPassword } from "@/lib/auth/password";
import { toRole } from "@/lib/auth/roles";
import { normalizeEmail, trimOrNull } from "@/lib/normalize";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Ctx) {
  const auth = await requireApiPermission(request, "staff.manage");
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const target = await prisma.staff.findUnique({ where: { id } });
  if (!target) return NextResponse.json({ error: "スタッフが見つかりません" }, { status: 404 });

  const form = await request.formData();
  const data: Record<string, unknown> = {};

  if (form.has("name")) {
    const name = String(form.get("name") ?? "").trim();
    if (!name) return NextResponse.json({ error: "氏名を入力してください" }, { status: 400 });
    data.name = name;
  }

  if (form.has("nameKana")) {
    data.nameKana = trimOrNull(form.get("nameKana"));
  }

  if (form.has("email")) {
    const email = normalizeEmail(String(form.get("email") ?? ""));
    if (!email) return NextResponse.json({ error: "メールアドレスを入力してください" }, { status: 400 });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "メールアドレスの形式が正しくありません" }, { status: 400 });
    }
    if (email !== target.email) {
      const exists = await prisma.staff.findUnique({ where: { email }, select: { id: true } });
      if (exists) {
        return NextResponse.json({ error: "このメールアドレスはすでに使われています" }, { status: 400 });
      }
    }
    data.email = email;
  }

  if (form.has("role")) {
    const role = toRole(form.get("role"));
    // 自分自身を管理者から降格させて、管理者が 0 人になる事故を防ぐ
    if (target.id === auth.user.id && role !== "ADMIN") {
      return NextResponse.json(
        { error: "自分の権限は変更できません。他の管理者に依頼してください" },
        { status: 400 },
      );
    }
    data.role = role;
  }

  if (form.has("isActive")) {
    const isActive = form.get("isActive") === "1";
    if (target.id === auth.user.id && !isActive) {
      return NextResponse.json({ error: "自分自身は無効にできません" }, { status: 400 });
    }
    data.isActive = isActive;
  }

  if (form.has("password")) {
    const password = String(form.get("password") ?? "");
    if (password.length < 8) {
      return NextResponse.json(
        { error: "パスワードは 8 文字以上で設定してください" },
        { status: 400 },
      );
    }
    data.passwordHash = await hashPassword(password);
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "変更する項目がありません" }, { status: 400 });
  }

  await prisma.staff.update({ where: { id }, data });

  // パスワード等の値そのものは記録しない
  await prisma.auditLog.create({
    data: {
      staffId: auth.user.id,
      action: "staff.update",
      targetType: "Staff",
      targetId: id,
      detail: Object.keys(data).join(","),
    },
  });

  return NextResponse.json({ ok: true });
}

/**
 * 退職者は原則「無効」で運用する（過去の記録の担当者表示を守るため）。
 * 削除は、来店・購入・予約などの記録が一件もないスタッフ（登録ミス等）に限って許可する。
 */
export async function DELETE(request: Request, { params }: Ctx) {
  const auth = await requireApiPermission(request, "staff.manage");
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const target = await prisma.staff.findUnique({ where: { id }, select: { id: true } });
  if (!target) return NextResponse.json({ error: "スタッフが見つかりません" }, { status: 404 });

  if (target.id === auth.user.id) {
    return NextResponse.json({ error: "自分自身は削除できません" }, { status: 400 });
  }

  const [visits, purchases, reservations, attendances, notes, followUps, sessions, courseAssigns] =
    await Promise.all([
      prisma.visit.count({ where: { staffId: id } }),
      prisma.purchase.count({ where: { staffId: id } }),
      prisma.reservation.count({ where: { staffId: id } }),
      prisma.schoolAttendance.count({ where: { staffId: id } }),
      prisma.customerNote.count({ where: { staffId: id } }),
      prisma.followUp.count({ where: { assigneeId: id } }),
      prisma.schoolSession.count({ where: { staffId: id } }),
      prisma.schoolCourseStaff.count({ where: { staffId: id } }),
    ]);

  const hasHistory =
    visits + purchases + reservations + attendances + notes + followUps + sessions + courseAssigns > 0;
  if (hasHistory) {
    return NextResponse.json(
      {
        error:
          "来店・購入・予約などの記録が残っているため削除できません。「無効にする」をご利用ください",
      },
      { status: 400 },
    );
  }

  await prisma.staff.delete({ where: { id } });

  await prisma.auditLog.create({
    data: { staffId: auth.user.id, action: "staff.delete", targetType: "Staff", targetId: id },
  });

  return NextResponse.json({ ok: true });
}
