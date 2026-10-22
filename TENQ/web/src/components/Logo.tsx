/** TENQ のロゴ。角丸の枠＋チェック。画像ファイルや画像ライブラリを使わずに SVG で描く */
export function Logo({ size = 26, tagline = true }: { size?: number; tagline?: boolean }) {
  return (
    <span className="logo" aria-label="TENQ — Smart Inspection System">
      <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
        <rect x="3" y="3" width="26" height="26" rx="6" fill="none" stroke="currentColor" strokeWidth="3" />
        <path d="M9.5 16.5l4.5 4.5 8.5-9.5" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M22 22.5l4 4" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
      <span className="logo-text">
        TENQ
        {tagline && <small>SMART INSPECTION</small>}
      </span>
    </span>
  );
}
