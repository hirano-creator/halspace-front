// 公開キオスク表示ページ（ログイン不要）※管理者ログイン必須の /settings/qr との違い
// 店舗タブレット・モニタに常時表示させる用途。kioskKeyは推測不能な32文字hexで、
// URLを知っている端末だけが表示できる（発行・再発行・無効化は /settings/qr で行う）。

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { DepartmentQrPanel } from "@/components/qr/department-qr-panel";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

const KIOSK_KEY_RE = /^[0-9a-f]{32}$/;

export default async function KioskQrPage({
  params,
}: {
  params: Promise<{ kioskKey: string }>;
}) {
  const { kioskKey } = await params;
  if (!KIOSK_KEY_RE.test(kioskKey)) notFound();

  // 不一致・未発行は notFound() でキーの存在を秘匿する（認証系は一切呼ばない）
  const department = await prisma.department.findUnique({ where: { kioskKey } });
  if (!department) notFound();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-8">
      <h1 className="mb-6 text-center text-xl font-semibold tracking-tight">
        {department.name} の打刻QR
      </h1>
      <DepartmentQrPanel department={department} variant="kiosk" />
    </main>
  );
}
