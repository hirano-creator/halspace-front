import type { Metadata } from "next";
import { AuthProvider } from "@/lib/auth/client";
import "./globals.css";

export const metadata: Metadata = {
  title: "TimeCalc | 勤怠時間計算システム",
  description: "株式会社ヒラノ 勤怠時間計算システム",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" className="h-full">
      <body className="flex min-h-full flex-col antialiased">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
