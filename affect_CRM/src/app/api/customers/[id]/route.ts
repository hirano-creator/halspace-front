import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiPermission, requireApiUser } from "@/lib/auth/api-guard";
import { findDuplicateCandidates, parseCustomerForm } from "../_shared";

// Next.js 16 では params は Promise で渡ってくる
type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Ctx) {
  const auth = await requireApiUser(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const form = await request.formData();
  const input = parseCustomerForm(form);
  if (typeof input === "string") {
    return NextResponse.json({ error: input }, { status: 400 });
  }

  const existing = await prisma.customer.findFirst({ where: { id, deletedAt: null } });
  if (!existing) {
    return NextResponse.json({ error: "顧客が見つかりません" }, { status: 404 });
  }

  if (form.get("confirmDuplicate") !== "1") {
    const candidates = await findDuplicateCandidates(input.phoneDigits, input.emailLower, id);
    if (candidates.length > 0) {
      return NextResponse.json({ duplicates: candidates }, { status: 409 });
    }
  }

  await prisma.customer.update({
    where: { id },
    data: {
      name: input.name,
      nameKana: input.nameKana,
      nickname: input.nickname,
      gender: input.gender,
      birthday: input.birthday,
      phone: input.phone,
      phoneDigits: input.phoneDigits,
      email: input.email,
      emailLower: input.emailLower,
      prefecture: input.prefecture,
      city: input.city,
      addressLine: input.addressLine,
      lineId: input.lineId,
      instagram: input.instagram,
      rank: input.rank,
      note: input.note,
      tags: {
        deleteMany: {},
        create: input.tagIds.map((tagId) => ({ tagId })),
      },
      surfProfile: {
        upsert: { create: input.surf, update: input.surf },
      },
    },
  });

  return NextResponse.json({ ok: true });
}

/** 顧客の削除は論理削除。管理者のみ */
export async function DELETE(request: Request, { params }: Ctx) {
  const auth = await requireApiPermission(request, "customer.delete");
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const existing = await prisma.customer.findFirst({ where: { id, deletedAt: null } });
  if (!existing) {
    return NextResponse.json({ error: "顧客が見つかりません" }, { status: 404 });
  }

  await prisma.customer.update({ where: { id }, data: { deletedAt: new Date() } });
  // 個人情報はログに残さない。誰が何をしたかだけ記録する
  await prisma.auditLog.create({
    data: {
      staffId: auth.user.id,
      action: "customer.delete",
      targetType: "Customer",
      targetId: id,
    },
  });

  return NextResponse.json({ ok: true });
}
