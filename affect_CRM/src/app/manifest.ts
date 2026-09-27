import type { MetadataRoute } from "next";

// ホーム画面に「インストール」できるようにする。manifest が無いと、ホーム画面や
// デスクトップのショートカットにブラウザのロゴが重なって表示される。
// アイコンは src/components/logo.tsx のマーク（白地に朱色）。
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "affect CRM",
    short_name: "affect CRM",
    description: "サーフショップ affect の顧客・予約・スクール・販売を一元管理するシステム",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#0b86ab",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
