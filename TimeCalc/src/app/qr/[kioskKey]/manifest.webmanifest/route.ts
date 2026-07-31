// キオスク表示ページ専用のWeb App Manifest。
// ルートのmanifest.ts（start_url="/"）をそのまま使うと、ホーム画面アイコンから起動しても
// ログイン必須の"/"に飛んでしまう。start_url/scopeをこのキオスクURL自身に固定することで、
// アイコンからログインなしで直接QR表示に入れるようにする。

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

const KIOSK_KEY_RE = /^[0-9a-f]{32}$/;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ kioskKey: string }> },
) {
  const { kioskKey } = await params;
  const department = KIOSK_KEY_RE.test(kioskKey)
    ? await prisma.department.findUnique({ where: { kioskKey }, select: { name: true } })
    : null;

  return NextResponse.json(
    {
      // idをキオスクURLごとに分けることで、ルートのTimeCalcアプリや他部署のキオスクと
      // 別アプリとしてインストールされる（同じアプリの上書き扱いにならない）
      id: `/qr/${kioskKey}`,
      name: department ? `${department.name} の打刻QR` : "打刻QR",
      short_name: department?.name ?? "打刻QR",
      description: "店舗の打刻用QR表示（ログイン不要）",
      start_url: `/qr/${kioskKey}`,
      scope: `/qr/${kioskKey}`,
      display: "standalone",
      background_color: "#f6f8fa",
      theme_color: "#635bff",
      icons: [
        { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      ],
    },
    { headers: { "Content-Type": "application/manifest+json" } },
  );
}
