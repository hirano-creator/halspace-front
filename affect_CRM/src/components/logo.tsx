// affect ロゴ
//
// ★暫定: いただいたロゴ画像を見て CSS + SVG で近似再現したもの。
// 本物のロゴデータ（SVG / PNG）を public/ に置いたら、このコンポーネントの
// 中身を <img> に差し替える。字形とマークの角度が原本と細部で異なる。

export function Logo({ size = 21, white = false }: { size?: number; white?: boolean }) {
  const markSize = Math.round(size * 0.71);
  const stroke = white ? "#fff" : "url(#affectLogoGradient)";
  return (
    <span className="flex items-baseline gap-px">
      <span
        style={{
          fontFamily: '"Arial Black", "Arial Bold", Arial, Helvetica, sans-serif',
          fontSize: size,
          fontWeight: 900,
          letterSpacing: "-0.045em",
          lineHeight: 1,
          color: white ? "#fff" : "#1a1a1a",
        }}
      >
        affect
      </span>
      <svg
        viewBox="2.5 10 31.5 31.5"
        fill="none"
        width={markSize}
        height={markSize}
        style={{ flex: "none" }}
        aria-hidden
      >
        <defs>
          <linearGradient id="affectLogoGradient" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stopColor="#e8402a" />
            <stop offset="0.55" stopColor="#ee5b26" />
            <stop offset="1" stopColor="#f7941e" />
          </linearGradient>
        </defs>
        <circle cx="9" cy="35" r="6.5" fill={stroke} />
        <path d="M9 22A13 13 0 0 1 22 35" stroke={stroke} strokeWidth="6" />
        <path d="M9 13A22 22 0 0 1 31 35" stroke={stroke} strokeWidth="6" />
      </svg>
    </span>
  );
}
