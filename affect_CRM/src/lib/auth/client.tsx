"use client";

// タブごとに独立した認証状態を管理する Context
//
// トークンは sessionStorage に保存する。タブ・ウィンドウごとに独立しているため、
// そのまま「タブごとに別アカウントでログインできる」仕組みになる
// （管理者とスタッフを並べて動作確認できる）。

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

export const TOKEN_STORAGE_KEY = "affect_crm_token";

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
    let cancelled = false;
    const stored = sessionStorage.getItem(TOKEN_STORAGE_KEY);

    // トークンがない場合も同じ非同期の流れに合流させる
    // （effect 内で同期的に setState するとカスケード再描画になるため）
    const verify = stored
      ? fetch("/api/auth/me", { headers: { Authorization: `Bearer ${stored}` } }).then((res) =>
          res.ok ? (res.json() as Promise<{ user: SessionUser }>) : Promise.reject(res),
        )
      : Promise.reject(new Error("no token"));

    verify
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

/** ログイン必須ページで使う。未ログインになった時点で /login?redirect=... へ飛ばす */
export function useRequireAuth(): AuthContextValue {
  const ctx = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (ctx.status === "unauthenticated") {
      const redirect = encodeURIComponent(window.location.pathname + window.location.search);
      router.replace(`/login?redirect=${redirect}`);
    }
  }, [ctx.status, router]);

  return ctx;
}
