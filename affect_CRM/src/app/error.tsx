"use client";

// 想定外のエラーが起きたときの画面。
// 店舗の作業を止めないよう、まず「やり直す」を大きく出す。
// エラーの中身は顧客情報を含む可能性があるので画面には出さない。

import { useEffect } from "react";
import Link from "next/link";
import { Logo } from "@/components/logo";
import { buttonPrimaryClass, buttonSecondaryClass } from "@/components/ui";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // 本番の詳細は wrangler tail で追う。ここでは digest（識別子）だけ残す
    if (error.digest) {
      console.error(`[affect-crm] error digest: ${error.digest}`);
    }
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center px-5 py-10">
      <div className="w-full max-w-[420px] text-center">
        <div className="flex justify-center">
          <Logo size={24} />
        </div>
        <h1 className="mt-8 text-xl font-semibold tracking-tight">画面を表示できませんでした</h1>
        <p className="mt-3 text-[13px] leading-relaxed text-gray-soft">
          通信が一時的に不安定になった可能性があります。
          <br />
          もう一度お試しください。入力中だった内容は保存されていません。
        </p>
        <div className="mt-7 flex flex-col gap-2.5">
          <button type="button" onClick={reset} className={buttonPrimaryClass}>
            もう一度読み込む
          </button>
          <Link href="/" className={buttonSecondaryClass}>
            ダッシュボードへ戻る
          </Link>
        </div>
        {error.digest && (
          <p className="mt-6 text-[11px] text-gray-faint">エラー識別子: {error.digest}</p>
        )}
      </div>
    </div>
  );
}
