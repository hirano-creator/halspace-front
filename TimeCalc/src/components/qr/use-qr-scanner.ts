"use client";

// カメラ映像からQRコードを読み取るフック
//
// デコードは2段構え:
// - BarcodeDetector（Android Chrome等）が使える環境ではそれを使う（ネイティブ・高速）
// - 使えない環境（iOS Safari等）は jsQR に動的importでフォールバックする

import { useCallback, useEffect, useRef, useState } from "react";

export type QrScannerState = "idle" | "starting" | "scanning" | "denied" | "unsupported" | "error";

const SCAN_INTERVAL_MS = 100; // 約10fps
const DOWNSCALE_MAX_WIDTH = 480; // jsQRフォールバック時に低スペック端末でも重くならないようにする

export function useQrScanner(onDetect: (text: string) => void) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const detectedRef = useRef(false);
  const barcodeDetectorRef = useRef<BarcodeDetector | null>(null);
  const jsQrRef = useRef<((data: Uint8ClampedArray, width: number, height: number) => { data: string } | null) | null>(
    null,
  );

  const [state, setState] = useState<QrScannerState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const stop = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) track.stop();
      streamRef.current = null;
    }
  }, []);

  /** 検出済みフラグだけ解除してスキャンを再開する（カメラの再起動はしない） */
  const resume = useCallback(() => {
    detectedRef.current = false;
  }, []);

  const scanTick = useCallback(async () => {
    if (detectedRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < video.HAVE_CURRENT_DATA) return;
    if (video.videoWidth === 0 || video.videoHeight === 0) return;

    const scale = Math.min(1, DOWNSCALE_MAX_WIDTH / video.videoWidth);
    const width = Math.round(video.videoWidth * scale);
    const height = Math.round(video.videoHeight * scale);
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, width, height);

    if (barcodeDetectorRef.current) {
      try {
        const results = await barcodeDetectorRef.current.detect(canvas);
        if (results.length > 0 && !detectedRef.current) {
          detectedRef.current = true;
          onDetect(results[0].rawValue);
        }
      } catch {
        // 1フレームの検出失敗は無視して次フレームへ
      }
      return;
    }

    if (jsQrRef.current) {
      const imageData = ctx.getImageData(0, 0, width, height);
      const result = jsQrRef.current(imageData.data, width, height);
      if (result && !detectedRef.current) {
        detectedRef.current = true;
        onDetect(result.data);
      }
    }
  }, [onDetect]);

  const start = useCallback(async () => {
    detectedRef.current = false;
    setErrorMessage(null);
    setState("starting");

    if (!navigator.mediaDevices?.getUserMedia) {
      setState("unsupported");
      return;
    }

    if (typeof BarcodeDetector !== "undefined") {
      try {
        const formats = await BarcodeDetector.getSupportedFormats();
        if (formats.includes("qr_code")) {
          barcodeDetectorRef.current = new BarcodeDetector({ formats: ["qr_code"] });
        }
      } catch {
        barcodeDetectorRef.current = null;
      }
    }

    if (!barcodeDetectorRef.current && !jsQrRef.current) {
      try {
        const mod = await import("jsqr");
        jsQrRef.current = mod.default;
      } catch {
        setState("error");
        setErrorMessage("QRコードの読み取り機能を読み込めませんでした");
        return;
      }
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setState("scanning");
      intervalRef.current = setInterval(() => {
        void scanTick();
      }, SCAN_INTERVAL_MS);
    } catch (e) {
      const name = e instanceof DOMException ? e.name : "";
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        setState("denied");
      } else if (name === "NotFoundError" || name === "OverconstrainedError") {
        setState("unsupported");
      } else {
        setState("error");
        setErrorMessage("カメラを起動できませんでした");
      }
    }
  }, [scanTick]);

  useEffect(() => {
    function onVisibilityChange() {
      if (document.visibilityState === "hidden") stop();
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      stop();
    };
  }, [stop]);

  return { videoRef, canvasRef, state, errorMessage, start, resume };
}
