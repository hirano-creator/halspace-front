// 公開キオスク表示ページ（ログイン不要）※管理者ログイン必須の /settings/qr との違い
// 店舗タブレット・モニタに常時表示させる用途。kioskKeyは推測不能な32文字hexで、
// URLを知っている端末だけが表示できる（発行・再発行・無効化は /settings/qr で行う）。

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { prisma } from "@/lib/db";
import { isPhotoStorageReady } from "@/lib/storage/photo-storage";
import { DepartmentQrPanel } from "@/components/qr/department-qr-panel";
import { InstallShortcutButton } from "@/components/qr/install-shortcut-button";
import { INSTALL_PROMPT_EVENT, INSTALL_PROMPT_KEY } from "@/components/qr/install-prompt-shared";

export const dynamic = "force-dynamic";

const KIOSK_KEY_RE = /^[0-9a-f]{32}$/;

// beforeinstallprompt はページ読み込み直後に一度だけ発火する。Reactのハイドレーションを待つと
// 再訪時（Service Workerが有効でインストール判定が即座に済む状態）に取りこぼし、
// 「ホーム画面に追加」ボタンが出なくなるため、ハイドレーション前のインラインスクリプトで捕捉する。
// Service Workerもここで登録し、インストール判定が早く済むようにしておく。
const EARLY_INSTALL_CAPTURE = `
(function () {
  window[${JSON.stringify(INSTALL_PROMPT_KEY)}] = null;
  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    window[${JSON.stringify(INSTALL_PROMPT_KEY)}] = e;
    window.dispatchEvent(new Event(${JSON.stringify(INSTALL_PROMPT_EVENT)}));
  });
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/qr/sw.js", { scope: "/qr/" }).catch(function () {});
  }
})();
`;

// generateMetadataとページ本体の両方から呼ぶため、同一リクエスト内では1回だけDBを引く
const getDepartment = cache(async (kioskKey: string) => {
  if (!KIOSK_KEY_RE.test(kioskKey)) return null;
  return prisma.department.findUnique({ where: { kioskKey } });
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ kioskKey: string }>;
}): Promise<Metadata> {
  const { kioskKey } = await params;
  const department = await getDepartment(kioskKey);

  return {
    title: department ? `${department.name} の打刻QR` : "打刻QR",
    robots: { index: false, follow: false },
    // ルートの共通manifest（start_url="/"）ではなく、このキオスクURL専用のmanifestに差し替える
    // （ホーム画面アイコンからログインなしで直接このQR表示に入れるようにするため）
    manifest: `/qr/${kioskKey}/manifest.webmanifest`,
    appleWebApp: department ? { title: department.name, statusBarStyle: "default" } : undefined,
  };
}

export default async function KioskQrPage({
  params,
}: {
  params: Promise<{ kioskKey: string }>;
}) {
  const { kioskKey } = await params;
  // 不一致・未発行は notFound() でキーの存在を秘匿する（認証系は一切呼ばない）
  const department = await getDepartment(kioskKey);
  if (!department) notFound();

  return (
    <main className="min-h-dvh">
      <script dangerouslySetInnerHTML={{ __html: EARLY_INSTALL_CAPTURE }} />
      {/* 部署名は色面に出すので、見出しは読み上げ用だけにする */}
      <h1 className="sr-only">{department.name} の打刻QR</h1>
      <DepartmentQrPanel
        department={department}
        variant="kiosk"
        forgotHref={department.kioskPunchEnabled && isPhotoStorageReady() ? `/qr/${kioskKey}/punch` : undefined}
        footer={<InstallShortcutButton />}
      />
    </main>
  );
}
