// 打刻QR一覧の取得API（GET）
// 旧 settings/qr/page.tsx（Server Component）が行っていたデータ取得をそのまま移植

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiPermission } from "@/lib/auth/api-guard";
import { getBaseUrl } from "@/components/qr/department-qr-panel";
import type { QrListResponse } from "@/app/(app)/settings/qr/types";

export async function GET(request: Request) {
  const auth = await requireApiPermission(request, "manageSettings");
  if (!auth.ok) return auth.response;

  const departments = await prisma.department.findMany({ orderBy: { name: "asc" } });
  const baseUrl = await getBaseUrl();

  const body: QrListResponse = {
    departments: departments.map((d) => ({ id: d.id, name: d.name, kioskKey: d.kioskKey })),
    baseUrl,
  };
  return NextResponse.json(body);
}
