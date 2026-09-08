import type { Metadata, Viewport } from "next";
import { AuthProvider } from "@/lib/auth/client";
import "./globals.css";

export const metadata: Metadata = {
  title: "affect CRM",
  description: "サーフショップ affect の顧客・予約・スクール・販売を一元管理するシステム",
};

// themeColor は Next.js 15 以降 metadata から分離されている
export const viewport: Viewport = {
  themeColor: "#0b86ab",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" className="h-full">
      <body className="flex min-h-full flex-col antialiased">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
