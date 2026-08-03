"use client";

// ルートアクセスは本人の「起動時の画面」設定（featureOverrides.homeScreen）に従って振り分ける
// AppShell（親レイアウト）が認証済みであることを保証してから children としてこれを描画するため、
// ここでは useAuth() で取得できる user をそのまま使ってよい。

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/client";
import { DEFAULT_FEATURES, HOME_SCREEN_PATHS } from "@/lib/auth/features";

export default function RootPage() {
  const { user } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!user) return;
    router.replace(
      HOME_SCREEN_PATHS[user.homeScreen] ?? HOME_SCREEN_PATHS[DEFAULT_FEATURES.homeScreen],
    );
  }, [user, router]);

  return null;
}
