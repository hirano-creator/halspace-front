import { useEffect, useRef, useState } from 'react';
import { tokenFromQr } from '@tenq/shared';
import { Alert, Button } from '../components/ui';
import { navigate } from '../router';

/**
 * アプリ内の QR 読み取り。同じタブのまま続けて点検できる（カメラアプリ経由だと毎回タブが増える）。
 * ブラウザの BarcodeDetector があればそれを、なければ（iPhone の Safari など）jsQR をこの画面だけで読み込む。
 */

type Detector = (video: HTMLVideoElement, canvas: HTMLCanvasElement) => Promise<string | null>;

async function createDetector(): Promise<Detector> {
  const BD = (globalThis as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => { detect: (s: CanvasImageSource) => Promise<{ rawValue: string }[]> } }).BarcodeDetector;
  if (BD) {
    const d = new BD({ formats: ['qr_code'] });
    return async (video) => (await d.detect(video))[0]?.rawValue ?? null;
  }
  const jsQR = (await import('jsqr')).default;
  return async (video, canvas) => {
    const w = video.videoWidth, h = video.videoHeight;
    if (!w || !h) return null;
    // 処理を軽くするため、長辺 640px に縮めて読む
    const scale = Math.min(1, 640 / Math.max(w, h));
    canvas.width = Math.round(w * scale); canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })?.data ?? null;
  };
}

export function ScanPage() {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<'starting' | 'scanning' | 'error'>('starting');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer = 0;
    let stopped = false;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('このブラウザではカメラを使えません。');
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        const v = video.current;
        if (!v || stopped) return;
        v.srcObject = stream;
        await v.play();
        const detect = await createDetector();
        setState('scanning');
        const tick = async () => {
          if (stopped || !video.current || !canvas.current) return;
          try {
            const text = await detect(video.current, canvas.current);
            if (text) {
              const token = tokenFromQr(text);
              if (token) { navigate(`/q/${token}`, true); return; }
              setMessage('TENQ の QR コードではありません。設備に貼られた TENQ のラベルを読んでください。');
            }
          } catch { /* 1コマ失敗しても続ける */ }
          timer = window.setTimeout(() => void tick(), 250);
        };
        void tick();
      } catch (e) {
        setState('error');
        setMessage(e instanceof DOMException && e.name === 'NotAllowedError'
          ? 'カメラの使用が許可されていません。ブラウザの設定でカメラを許可するか、スマホのカメラアプリで QR を読んでください。'
          : e instanceof Error ? e.message : 'カメラを起動できませんでした。');
      }
    })();
    return () => { stopped = true; clearTimeout(timer); stream?.getTracks().forEach((t) => t.stop()); };
  }, []);

  return (
    <div className="scan">
      <h1 className="page-title">QR を読み取る</h1>
      <p className="page-sub">設備に貼られた TENQ のラベルにカメラを向けてください。</p>
      <div className="scan-view">
        <video ref={video} playsInline muted aria-label="カメラの映像" />
        <div className="scan-frame" aria-hidden="true" />
        {state === 'starting' && <p className="scan-status">カメラを起動しています…</p>}
      </div>
      <canvas ref={canvas} hidden />
      {message && <Alert kind={state === 'error' ? 'error' : 'warn'}>{message}</Alert>}
      <div className="button-row">
        <Button onClick={() => navigate('/equipment')}>設備台帳から選ぶ</Button>
        <Button onClick={() => navigate('/')}>ホームへ</Button>
      </div>
    </div>
  );
}
