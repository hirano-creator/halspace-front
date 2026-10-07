// スマホ忘れ打刻：キオスクで選べるスタッフ一覧（GET、ログイン不要・kioskKeyで認可）

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { kioskStaffWhere, resolveKioskDepartment } from "../../_shared";
import type { KioskStaffResponse } from "@/app/qr/[kioskKey]/punch/types";

export async function GET(_request: Request, { params }: { params: Promise<{ kioskKey: string }> }) {
  const { kioskKey } = await params;
  const ctx = await resolveKioskDepartment(kioskKey);
  if (!ctx.ok) return ctx.response;
  const { department } = ctx;

  const users = await prisma.user.findMany({
    where: kioskStaffWhere(department),
    select: { id: true, name: true, employeeCode: true, departmentId: true, department: { select: { name: true } } },
    orderBy: { employeeCode: "asc" },
  });

  const body: KioskStaffResponse = {
    departmentName: department.name,
    // 返すのは選択に必要な最小限（id・氏名・社員番号・所属部署名）だけ
    staff: users.map((u) => ({
      id: u.id,
      name: u.name,
      employeeCode: u.employeeCode,
      departmentName: u.department?.name ?? null,
      home: u.departmentId === department.id,
    })),
  };
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}
