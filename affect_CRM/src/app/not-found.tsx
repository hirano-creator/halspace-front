import Link from "next/link";
import { Logo } from "@/components/logo";
import { buttonPrimaryClass } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center px-5 py-10">
      <div className="w-full max-w-[420px] text-center">
        <div className="flex justify-center">
          <Logo size={24} />
        </div>
        <h1 className="mt-8 text-xl font-semibold tracking-tight">ページが見つかりません</h1>
        <p className="mt-3 text-[13px] leading-relaxed text-gray-soft">
          削除されたか、URL が変わった可能性があります。
        </p>
        <div className="mt-7">
          <Link href="/" className={`${buttonPrimaryClass} w-full`}>
            ダッシュボードへ戻る
          </Link>
        </div>
      </div>
    </div>
  );
}
