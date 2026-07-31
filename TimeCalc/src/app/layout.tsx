import type { Metadata, Viewport } from "next";
import { AuthProvider } from "@/lib/auth/client";
import { ServiceWorkerCleanup } from "@/components/service-worker-cleanup";
import "./globals.css";

export const metadata: Metadata = {
  title: "TimeCalc | 勤怠時間計算システム",
  description: "株式会社ヒラノ 勤怠時間計算システム",
  appleWebApp: {
    title: "TimeCalc",
    statusBarStyle: "default",
  },
  icons: {
    icon: "/favicon.ico",
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#635bff",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" className="h-full">
      <body className="flex min-h-full flex-col antialiased">
        <ServiceWorkerCleanup />
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
