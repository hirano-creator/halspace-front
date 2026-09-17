import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    // idを明示し、キオスク表示用アプリ（/qr/[kioskKey]/manifest.webmanifest）と
    // 別アプリとしてインストールされるようにする
    id: "/",
    name: "TimeCalc | 勤怠時間計算システム",
    short_name: "TimeCalc",
    description: "勤怠時間計算システム",
    start_url: "/",
    display: "standalone",
    background_color: "#f6f8fa",
    theme_color: "#635bff",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
