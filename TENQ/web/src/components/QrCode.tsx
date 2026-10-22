import { useEffect, useState } from 'react';

/**
 * QR コードを SVG で描く。ライブラリ（qrcode-generator）はこの部品を使う画面でだけ読み込む。
 * innerHTML を使わず、黒いマスを1本の path にして描く。
 */

type Factory = typeof import('qrcode-generator');
let factory: Promise<Factory> | null = null;
const loadFactory = () => (factory ??= import('qrcode-generator').then((m) => (m as unknown as { default: Factory }).default ?? m));

export function qrUrl(base: string, token: string): string {
  return `${base.endsWith('/') ? base : base + '/'}#${token}`;
}

export function QrCode({ value, size, label }: { value: string; size: number | string; label?: string }) {
  const [shape, setShape] = useState<{ n: number; d: string } | null>(null);
  useEffect(() => {
    let alive = true;
    void loadFactory().then((qrcode) => {
      // 誤り訂正レベル M（汚れ・傷に少し強い）。URL が短いので小さく印刷しても読める
      const qr = qrcode(0, 'M');
      qr.addData(value);
      qr.make();
      const n = qr.getModuleCount();
      let d = '';
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
      if (alive) setShape({ n, d });
    });
    return () => { alive = false; };
  }, [value]);

  const q = 4; // 読み取りに必要な周囲の余白（クワイエットゾーン）
  return (
    <svg className="qr" width={size} height={size} viewBox={shape ? `${-q} ${-q} ${shape.n + q * 2} ${shape.n + q * 2}` : '0 0 1 1'}
      role="img" aria-label={label ?? 'QRコード'} shapeRendering="crispEdges">
      {shape && <><rect x={-q} y={-q} width={shape.n + q * 2} height={shape.n + q * 2} fill="#fff" /><path d={shape.d} fill="#000" /></>}
    </svg>
  );
}
