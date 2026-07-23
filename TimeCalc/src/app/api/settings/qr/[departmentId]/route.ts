// 店舗ごとの打刻用QRコード表示データ取得API（GET、管理者用）
// 旧 settings/qr/[departmentId]/page.tsx + components/qr/department-qr-panel.tsx の
// admin variant 部分をそのまま移植（QRコード画像生成・日替わりトークンはサーバー専用のため）

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiPermission } from "@/lib/auth/api-guard";
import { getBaseUrl } from "@/components/qr/department-qr-panel";
import { buildClockUrl, dailyQrToken, generateQrDataUrl, type QrKind } from "@/lib/qr";
import { todayString } from "@/lib/utils/time";
import type { DepartmentQrDetailResponse, QrCodeData } from "@/app/(app)/settings/qr/types";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ departmentId: string }> },
) {
  const auth = await requireApiPermission(request, "manageSettings");
  if (!auth.ok) return auth.response;

  const { departmentId } = await params;
  const department = await prisma.department.findUnique({ where: { id: departmentId } });
  if (!department) return NextResponse.json({ error: "対象の部署が見つかりません" }, { status: 404 });

  const baseUrl = await getBaseUrl();
  const today = todayString();
  const token = department.dailyQrEnabled ? dailyQrToken(department.id, today) : undefined;

  async function buildQr(label: string, description: string, kind?: QrKind): Promise<QrCodeData> {
    const url = buildClockUrl(baseUrl, department!.id, token, kind);
    return { label, description, url, dataUrl: await generateQrDataUrl(url) };
  }

  const noneEnabled =
    !department.standardQrEnabled && !department.attendQrEnabled && !department.outingQrEnabled;
  const gpsUnset =
    department.latitude == null || department.longitude == null || department.allowedRadiusMeters == null;

  const [standard, attend, outing] = await Promise.all([
    department.standardQrEnabled
      ? buildQr("標準QR", "タップ打刻用（出勤・退勤・外出・戻りの4ボタンから選んで打刻）")
      : null,
    department.attendQrEnabled
      ? buildQr(
          "出勤・退勤QR",
          "「スキャン即打刻」設定のスタッフは読み取った瞬間に自動打刻されます",
          "attend",
        )
      : null,
    department.outingQrEnabled
      ? buildQr("外出・戻りQR", "外出・戻りはこのQRを読み取ってからボタンで打刻します", "outing")
      : null,
  ]);

  const body: DepartmentQrDetailResponse = {
    departmentName: department.name,
    dailyQrEnabled: department.dailyQrEnabled,
    today,
    gpsUnset,
    noneEnabled,
    standard,
    attend,
    outing,
  };
  return NextResponse.json(body);
}
