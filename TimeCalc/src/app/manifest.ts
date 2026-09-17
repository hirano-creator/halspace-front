import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    // idを明示し、キオスク表示用アプリ（/qr/[kioskKey]/manifest.webmanifest）と
    // 別アプリとしてインストールされるようにする
    id: "/",
    name: "TimeCalc | 勤怠時間計算システム",
    short_name: "TimeCalc",
    description: "勤怠時間計算システム",
    // iOS 18 のホーム画面アプリは、起動直後にアプリ内遷移した画面でキーボードが出なくなるため、
    // "/" → /login の遷移を挟まず最初からログイン画面を開く（ログイン済みなら /login 側が振り分ける）
    start_url: "/login",
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
