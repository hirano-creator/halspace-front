import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiPermission, requireApiUser } from "@/lib/auth/api-guard";
import { trimOrNull } from "@/lib/normalize";
import type { CourseListResponse } from "@/app/(app)/schools/types";

export async function GET(request: Request) {
  const auth = await requireApiUser(request);
  if (!auth.ok) return auth.response;

  const [courses, staffs, masters] = await Promise.all([
    prisma.schoolCourse.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      include: { staffs: { include: { staff: { select: { id: true, name: true } } } } },
    }),
    prisma.staff.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.masterOption.findMany({
      where: { type: "SURF_LEVEL", isActive: true },
      orderBy: { sortOrder: "asc" },
      select: { code: true, label: true },
    }),
  ]);

  const body: CourseListResponse = {
    courses: courses.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      durationMinutes: c.durationMinutes,
      price: c.price,
      capacity: c.capacity,
      level: c.level,
      levelLabel: masters.find((m) => m.code === c.level)?.label ?? null,
      isPublished: c.isPublished,
      staffIds: c.staffs.map((s) => s.staff.id),
      staffNames: c.staffs.map((s) => s.staff.name),
    })),
    staffs,
    levels: masters,
  };

  return NextResponse.json(body);
}

/** コースの登録はマスタ編集なので管理者のみ */
export async function POST(request: Request) {
  const auth = await requireApiPermission(request, "master.edit");
  if (!auth.ok) return auth.response;

  const form = await request.formData();
  const parsed = parseCourseForm(form);
  if (typeof parsed === "string") {
    return NextResponse.json({ error: parsed }, { status: 400 });
  }

  const course = await prisma.schoolCourse.create({
    data: {
      ...parsed.data,
      staffs: { create: parsed.staffIds.map((staffId) => ({ staffId })) },
    },
    select: { id: true },
  });

  return NextResponse.json({ course });
}

export function parseCourseForm(form: FormData) {
  const name = String(form.get("name") ?? "").trim();
  if (!name) return "コース名を入力してください";

  const duration = Number(form.get("durationMinutes") ?? "90");
  if (!Number.isInteger(duration) || duration < 15 || duration > 600) {
    return "所要時間は 15〜600 分の数字で入力してください";
  }

  const price = Number(form.get("price") ?? "0");
  if (!Number.isFinite(price) || price < 0) {
    return "料金を 0 以上の数字で入力してください";
  }

  const capacity = Number(form.get("capacity") ?? "5");
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 100) {
    return "定員は 1〜100 の数字で入力してください";
  }

  return {
    data: {
      name,
      description: trimOrNull(form.get("description")),
      durationMinutes: duration,
      price: Math.round(price),
      capacity,
      level: trimOrNull(form.get("level")),
      isPublished: form.get("isPublished") === "1",
      sortOrder: Number(form.get("sortOrder") ?? "0") || 0,
    },
    staffIds: form.getAll("staffIds").map(String).filter(Boolean),
  };
}
