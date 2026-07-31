"use client";

// ルートアクセスは本人の「起動時の画面」設定（featureOverrides.homeScreen）に従って振り分ける
// AppShell（親レイアウト）が認証済みであることを保証してから children としてこれを描画するため、
// ここでは useAuth() で取得できる user をそのまま使ってよい。

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/client";

export default function RootPage() {
  const { user } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!user) return;
    router.replace(user.homeScreen === "scan" ? "/clock/scan" : "/my");
  }, [user, router]);

  return null;
}
