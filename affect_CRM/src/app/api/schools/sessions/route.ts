import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiUser } from "@/lib/auth/api-guard";
import { trimOrNull } from "@/lib/normalize";
import { parseJstDateTime } from "@/lib/utils/time";

/** 開催枠を作る。ここで作った枠がそのままホームページの予約枠になる */
export async function POST(request: Request) {
  const auth = await requireApiUser(request);
  if (!auth.ok) return auth.response;

  const form = await request.formData();
  const parsed = await parseSessionForm(form);
  if (typeof parsed === "string") {
    return NextResponse.json({ error: parsed }, { status: 400 });
  }

  const session = await prisma.schoolSession.create({ data: parsed, select: { id: true } });
  return NextResponse.json({ session });
}

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export async function parseSessionForm(form: FormData) {
  const courseId = trimOrNull(form.get("courseId"));
  if (!courseId) return "コースを選んでください";

  const course = await prisma.schoolCourse.findFirst({
    where: { id: courseId, isActive: true },
    select: { capacity: true, durationMinutes: true },
  });
  if (!course) return "コースが見つかりません";

  const dateRaw = trimOrNull(form.get("date"));
  const date = dateRaw ? parseJstDateTime(dateRaw) : null;
  if (!date) return "開催日を選んでください";

  const startTime = trimOrNull(form.get("startTime")) ?? "";
  if (!TIME_PATTERN.test(startTime)) return "開始時間を「09:00」の形式で入力してください";

  let endTime = trimOrNull(form.get("endTime")) ?? "";
  if (!endTime) {
    // 未入力ならコースの所要時間から埋める（入力の手間を減らす）
    const [h, m] = startTime.split(":").map(Number);
    const end = h * 60 + m + course.durationMinutes;
    endTime = `${String(Math.floor(end / 60) % 24).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`;
  }
  if (!TIME_PATTERN.test(endTime)) return "終了時間を「10:30」の形式で入力してください";
  if (endTime <= startTime) return "終了時間は開始時間より後にしてください";

  const capacityRaw = trimOrNull(form.get("capacity"));
  const capacity = capacityRaw ? Number(capacityRaw) : course.capacity;
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 100) {
    return "定員は 1〜100 の数字で入力してください";
  }

  return {
    courseId,
    date,
    startTime,
    endTime,
    capacity,
    staffId: trimOrNull(form.get("staffId")),
    isPublished: form.get("isPublished") !== "0",
    note: trimOrNull(form.get("note")),
  };
}
