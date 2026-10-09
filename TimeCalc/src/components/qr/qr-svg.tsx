// 打刻QRをSVGで描画する（データ部は角丸、3隅の切り出しシンボルは状態の色）
//
// 掲示画面では今どのQRかを色で見分けられるよう、切り出しシンボルだけ状態色にする。
// 読み取りやすさを保つため色は濃いめ（白地とのコントラストを確保）を渡すこと。
// 誤り訂正レベルはサーバーのPNG生成（generateQrDataUrl・qrcodeの既定）と同じ M。

import { useMemo } from "react";
import QRCode from "qrcode";

export function QrSvg({
  value,
  finderColor = "#111827",
  label,
  className,
}: {
  value: string;
  finderColor?: string;
  label: string;
  className?: string;
}) {
  const { size, body } = useMemo(() => {
    const qr = QRCode.create(value, { errorCorrectionLevel: "M" });
    const n = qr.modules.size;
    const inFinder = (r: number, c: number) => (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);
    let d = "";
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (!qr.modules.get(r, c) || inFinder(r, c)) continue;
        // 0.94角・角丸0.25のモジュールをパスで描く（rect要素を並べるより軽い）。
        // すき間を広げる（0.88角など）と、マスの粗い短いURL（標準QR）がデコーダで読めなくなる（jsQRで確認済み）
        const x = (c + 0.28).toFixed(2);
        const y = (r + 0.03).toFixed(2);
        d += `M${x} ${y}h0.44a0.25 0.25 0 0 1 0.25 0.25v0.44a0.25 0.25 0 0 1 -0.25 0.25h-0.44a0.25 0.25 0 0 1 -0.25 -0.25v-0.44a0.25 0.25 0 0 1 0.25 -0.25z`;
      }
    }
    return { size: n, body: d };
  }, [value]);

  const quiet = 2;
  const full = size + quiet * 2;
  const finder = (x: number, y: number) => (
    <g key={`${x}-${y}`}>
      <rect x={x} y={y} width={7} height={7} rx={1.6} fill={finderColor} />
      <rect x={x + 1} y={y + 1} width={5} height={5} rx={0.9} fill="#fff" />
      <rect x={x + 2} y={y + 2} width={3} height={3} rx={0.8} fill={finderColor} />
    </g>
  );

  return (
    <svg
      viewBox={`${-quiet} ${-quiet} ${full} ${full}`}
      role="img"
      aria-label={`${label}のQRコード`}
      className={className}
    >
      <rect x={-quiet} y={-quiet} width={full} height={full} fill="#fff" />
      <path d={body} fill="#111827" />
      {finder(0, 0)}
      {finder(size - 7, 0)}
      {finder(0, size - 7)}
    </svg>
  );
}
