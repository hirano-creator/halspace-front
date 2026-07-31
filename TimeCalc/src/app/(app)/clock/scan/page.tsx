"use client";

// QR読取り画面（アプリ内カメラで店舗の打刻QRを読み取る）
//
// マウント時に自動でカメラを起動する。読み取ったQRは既存の /clock の打刻フローへそのまま渡すだけで、
// 打刻ロジック自体（AutoPunch / ClockButtons / /api/clock/*）は一切変更しない。

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useRequireAuth } from "@/lib/auth/client";
import { useQrScanner } from "@/components/qr/use-qr-scanner";
import { parseClockQrText, buildScannedClockPath } from "@/lib/qr-scan";
import { Card, buttonPrimaryClass, buttonSecondaryClass } from "@/components/ui";

const INVALID_QR_RETRY_MS = 1500;

export default function ClockScanPage() {
  const { status: authStatus } = useRequireAuth();
  const router = useRouter();
  const startedRef = useRef(false);
  const [invalidQr, setInvalidQr] = useState(false);

  const handleDetect = useCallback(
    (text: string) => {
      const target = parseClockQrText(text, window.location.origin);
      if (!target) {
        setInvalidQr(true);
        return;
      }
      router.replace(buildScannedClockPath(target));
    },
    [router],
  );

  const { videoRef, canvasRef, state, errorMessage, start, resume } = useQrScanner(handleDetect);

  useEffect(() => {
    if (authStatus !== "authenticated" || startedRef.current) return;
    startedRef.current = true;
    void start();
  }, [authStatus, start]);

  useEffect(() => {
    if (!invalidQr) return;
    const timer = setTimeout(() => {
      setInvalidQr(false);
      resume();
    }, INVALID_QR_RETRY_MS);
    return () => clearTimeout(timer);
  }, [invalidQr, resume]);

  if (authStatus === "unauthenticated") return null;
  if (authStatus === "loading") {
    return <p className="py-8 text-center text-sm text-muted">読み込み中...</p>;
  }

  return (
    <div className="mx-auto max-w-md">
      <Card className="space-y-4">
        <h1 className="text-center text-lg font-semibold">QRコードを読み取ってください</h1>

        <div className="relative aspect-square overflow-hidden rounded-lg bg-black">
          <video ref={videoRef} autoPlay muted playsInline className="h-full w-full object-cover" />
          <canvas ref={canvasRef} className="hidden" />
          {(state === "scanning" || state === "starting") && (
            <div className="pointer-events-none absolute inset-8 rounded-lg border-4 border-white/70" />
          )}
        </div>

        {state === "starting" && (
          <p className="text-center text-sm text-muted">カメラを起動しています...</p>
        )}

        {invalidQr && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-center text-sm text-red-600">
            TimeCalcの打刻用QRコードではありません
          </p>
        )}

        {(state === "denied" || state === "unsupported" || state === "error") && (
          <div className="space-y-3 rounded-lg bg-amber-50 px-4 py-3 text-center">
            <p className="text-sm text-amber-800">
              {state === "denied"
                ? "カメラの使用が許可されていません。ブラウザの設定でカメラを許可してください"
                : (errorMessage ?? "カメラを利用できませんでした")}
            </p>
            <button type="button" onClick={() => void start()} className={buttonPrimaryClass}>
              カメラを起動
            </button>
          </div>
        )}

        <p className="text-center text-xs text-muted">
          スマホの標準カメラアプリでQRコードを読み取っても打刻できます
        </p>

        <button
          type="button"
          onClick={() => router.push("/clock")}
          className={`${buttonSecondaryClass} w-full`}
        >
          打刻画面に戻る
        </button>
      </Card>
    </div>
  );
}
