import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiPermission, requireApiUser } from "@/lib/auth/api-guard";
import { FOLLOW_UP_STATUSES, toEnum } from "@/lib/constants";
import { trimOrNull } from "@/lib/normalize";
import { parseJstDateTime } from "@/lib/utils/time";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Ctx) {
  const auth = await requireApiUser(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const form = await request.formData();
  const status = toEnum(FOLLOW_UP_STATUSES, form.get("status"));

  const dueRaw = trimOrNull(form.get("dueDate"));
  let dueDate: Date | undefined;
  if (dueRaw) {
    const parsed = parseJstDateTime(dueRaw);
    if (!parsed) {
      return NextResponse.json({ error: "フォロー予定日の形式が正しくありません" }, { status: 400 });
    }
    dueDate = parsed;
  }

  await prisma.followUp.update({
    where: { id },
    data: {
      ...(status ? { status } : {}),
      ...(dueDate ? { dueDate } : {}),
      ...(form.has("content") ? { content: String(form.get("content") ?? "").trim() } : {}),
      ...(form.has("memo") ? { memo: trimOrNull(form.get("memo")) } : {}),
      ...(form.has("assigneeId") ? { assigneeId: trimOrNull(form.get("assigneeId")) } : {}),
      // 完了・不要にした時点を記録しておく（対応にかかった日数の分析に使えるように）
      ...(status === "DONE" || status === "UNNECESSARY"
        ? { completedAt: new Date() }
        : status
          ? { completedAt: null }
          : {}),
    },
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request, { params }: Ctx) {
  const auth = await requireApiPermission(request, "data.delete");
  if (!auth.ok) return auth.response;
  const { id } = await params;

  await prisma.followUp.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
