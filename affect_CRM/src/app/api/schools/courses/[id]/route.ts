import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiPermission } from "@/lib/auth/api-guard";
import { parseCourseForm } from "../route";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Ctx) {
  const auth = await requireApiPermission(request, "master.edit");
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const form = await request.formData();
  const parsed = parseCourseForm(form);
  if (typeof parsed === "string") {
    return NextResponse.json({ error: parsed }, { status: 400 });
  }

  await prisma.schoolCourse.update({
    where: { id },
    data: {
      ...parsed.data,
      staffs: {
        deleteMany: {},
        create: parsed.staffIds.map((staffId) => ({ staffId })),
      },
    },
  });

  return NextResponse.json({ ok: true });
}

/** コースは削除せず無効化する（過去の開催枠・参加履歴の表示を壊さないため） */
export async function DELETE(request: Request, { params }: Ctx) {
  const auth = await requireApiPermission(request, "master.edit");
  if (!auth.ok) return auth.response;
  const { id } = await params;

  await prisma.schoolCourse.update({ where: { id }, data: { isActive: false } });
  return NextResponse.json({ ok: true });
}
