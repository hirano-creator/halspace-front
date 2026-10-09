// スマホを忘れたスタッフ向けの打刻画面（ログイン不要・店舗タブレット用）
// キオスクQR画面（/qr/[kioskKey]）の「スマホを忘れた方はこちら」から入る。
// スタッフ一覧から名前を選び、前面カメラで撮影して打刻する（写真は管理者が後から確認できる）。

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { isPhotoStorageReady } from "@/lib/storage/photo-storage";
import { KioskPunch } from "./kiosk-punch";

export const dynamic = "force-dynamic";

const KIOSK_KEY_RE = /^[0-9a-f]{32}$/;

export const metadata: Metadata = {
  title: "スマホを忘れた方の打刻",
  robots: { index: false, follow: false },
};

export default async function KioskPunchPage({ params }: { params: Promise<{ kioskKey: string }> }) {
  const { kioskKey } = await params;
  const department = KIOSK_KEY_RE.test(kioskKey)
    ? await prisma.department.findUnique({ where: { kioskKey } })
    : null;
  // 未知のキーは既存のキオスク画面と同じく notFound() で存在を秘匿する
  if (!department) notFound();

  const enabled = department.kioskPunchEnabled && isPhotoStorageReady();

  return (
    <main className="flex min-h-dvh flex-col">
      {enabled ? (
        <KioskPunch kioskKey={kioskKey} departmentName={department.name} />
      ) : (
        <div className="mt-16 px-4 text-center">
          <p className="text-lg font-semibold">この店舗ではスマホを忘れた方の打刻は利用できません</p>
          <p className="mt-2 text-sm text-muted">打刻を忘れた日は、後日マイページから修正申請をしてください。</p>
          <a href={`/qr/${kioskKey}`} className="mt-6 inline-block text-sm text-primary underline">
            打刻QRの画面に戻る
          </a>
        </div>
      )}
    </main>
  );
}
