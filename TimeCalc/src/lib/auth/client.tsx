"use client";

// タブごとに独立した認証状態を管理するContext
//
// トークンは sessionStorage に保存する（タブ・ウィンドウごとに独立しており、
// 他タブでの再ログインや閉じたタブの情報が引き継がれないため、これがそのまま
// 「タブごとに別アカウントでログインできる」仕組みになる）。

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import type { SessionUser } from "./session";

export const TOKEN_STORAGE_KEY = "timecalc_token";

/** ホーム画面に追加したアプリ（standalone表示）で開いているか */
export function isStandaloneDisplay(): boolean {
  if (typeof window === "undefined") return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
}

/**
 * ログイン前後の画面切り替え。
 * iOS 18 のホーム画面アプリは、起動直後にアプリ内遷移（history API）で移った画面で
 * キーボードが出なくなる不具合があるため、standalone 表示のときだけ通常のページ読み込みで移る。
 */
export function navigateAcrossLogin(
  router: { replace: (href: string) => void },
  href: string,
): void {
  if (isStandaloneDisplay()) window.location.replace(href);
  else router.replace(href);
}

type AuthStatus = "loading" | "authenticated" | "unauthenticated";

interface AuthContextValue {
  user: SessionUser | null;
  token: string | null;
  status: AuthStatus;
  login: (token: string, user: SessionUser) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");

  useEffect(() => {
    const stored = sessionStorage.getItem(TOKEN_STORAGE_KEY);
    if (!stored) {
      setStatus("unauthenticated");
      return;
    }

    let cancelled = false;
    fetch("/api/auth/me", { headers: { Authorization: `Bearer ${stored}` } })
      .then((res) => (res.ok ? (res.json() as Promise<{ user: SessionUser }>) : Promise.reject(res)))
      .then((data) => {
        if (cancelled) return;
        setToken(stored);
        setUser(data.user);
        setStatus("authenticated");
      })
      .catch(() => {
        if (cancelled) return;
        sessionStorage.removeItem(TOKEN_STORAGE_KEY);
        setStatus("unauthenticated");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback((newToken: string, newUser: SessionUser) => {
    sessionStorage.setItem(TOKEN_STORAGE_KEY, newToken);
    setToken(newToken);
    setUser(newUser);
    setStatus("authenticated");
  }, []);

  const logout = useCallback(() => {
    sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    setToken(null);
    setUser(null);
    setStatus("unauthenticated");
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, status, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth() は AuthProvider の内側で使ってください");
  return ctx;
}

/**
 * ログイン必須ページで使う。未ログインになった時点で /login?redirect=... へ飛ばす。
 * AppShell（(app)/layout.tsx）へ移行するまでの暫定措置で、各ページ側で個別に呼ぶ。
 */
export function useRequireAuth(): AuthContextValue {
  const ctx = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (ctx.status === "unauthenticated") {
      const redirect = encodeURIComponent(window.location.pathname + window.location.search);
      navigateAcrossLogin(router, `/login?redirect=${redirect}`);
    }
  }, [ctx.status, router]);

  return ctx;
}
