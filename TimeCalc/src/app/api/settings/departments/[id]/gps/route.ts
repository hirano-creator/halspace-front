// 部署のGPS座標・許容半径の設定API（PATCH）
// 旧 settings/actions.ts の updateDepartmentGpsAction をそのまま移植

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiPermission } from "@/lib/auth/api-guard";
import type { SettingsFormState } from "@/app/(app)/settings/types";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiPermission(request, "manageSettings");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const formData = await request.formData();
  const latRaw = String(formData.get("latitude") ?? "").trim();
  const lngRaw = String(formData.get("longitude") ?? "").trim();
  const radiusRaw = String(formData.get("allowedRadiusMeters") ?? "").trim();

  if (!latRaw && !lngRaw && !radiusRaw) {
    try {
      await prisma.department.update({
        where: { id },
        data: { latitude: null, longitude: null, allowedRadiusMeters: null },
      });
    } catch (e) {
      console.error("部署GPS設定エラー:", e);
      return NextResponse.json<SettingsFormState>({ error: "GPS設定の保存に失敗しました", success: false });
    }
    return NextResponse.json<SettingsFormState>({ error: null, success: true });
  }

  if (!latRaw || !lngRaw || !radiusRaw) {
    return NextResponse.json<SettingsFormState>({
      error: "緯度・経度・半径はすべて入力するか、すべて空欄にしてください",
      success: false,
    });
  }

  const latitude = Number(latRaw);
  const longitude = Number(lngRaw);
  const allowedRadiusMeters = Number(radiusRaw);

  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    return NextResponse.json<SettingsFormState>({
      error: "緯度は-90〜90の範囲で入力してください",
      success: false,
    });
  }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    return NextResponse.json<SettingsFormState>({
      error: "経度は-180〜180の範囲で入力してください",
      success: false,
    });
  }
  if (!Number.isInteger(allowedRadiusMeters) || allowedRadiusMeters < 10 || allowedRadiusMeters > 5000) {
    return NextResponse.json<SettingsFormState>({
      error: "許容半径は10〜5000mの範囲で入力してください",
      success: false,
    });
  }

  try {
    await prisma.department.update({ where: { id }, data: { latitude, longitude, allowedRadiusMeters } });
  } catch (e) {
    console.error("部署GPS設定エラー:", e);
    return NextResponse.json<SettingsFormState>({ error: "GPS設定の保存に失敗しました", success: false });
  }

  return NextResponse.json<SettingsFormState>({ error: null, success: true });
}
