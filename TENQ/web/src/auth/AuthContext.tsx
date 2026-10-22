import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { can as canFn, type Action, type Actor, type Role, type Target } from '@tenq/shared';
import { ApiError, apiGet, apiSend, setUnauthorizedHandler } from '../api/client';
import { navigate } from '../router';
import { clearSession, currentToken } from './session';

export interface Me {
  user: { id: string; name: string; email: string | null; role: Role | null; roleLabel: string | null };
  factories: { id: string; code: string; name: string; timezone: string }[];
  via: 'space' | 'device' | 'dev-stub';
  settings: { qr_base_url: string; device_login_days: number; board_refresh_seconds: number; reauth_hours: number };
}

interface AuthState {
  me: Me | null;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  logout: () => Promise<void>;
  /** 画面の出し分け用。最終判定は API 側 */
  can: (action: Action, target?: Target) => boolean;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(() => currentToken() !== null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setMe(await apiGet<Me>('/me'));
      setError(null);
    } catch (e) {
      setMe(null);
      setError(e instanceof ApiError && e.status !== 401 ? e.message : null);
    } finally {
      setLoading(false);
    }
  }, []);

  // 開いたときの読み込み（ログイン後の読み直しは reload を使う）
  useEffect(() => {
    setUnauthorizedHandler(() => { setMe(null); navigate('/login', true); });
    if (!currentToken()) return;
    let alive = true;
    apiGet<Me>('/me')
      .then((m) => { if (alive) { setMe(m); setError(null); } })
      .catch((e: unknown) => { if (alive) setError(e instanceof ApiError && e.status !== 401 ? e.message : null); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const logout = useCallback(async () => {
    // 端末記憶で入っている場合はサーバー側でも取り消す（失敗してもこの端末からは消す）
    try { await apiSend('DELETE', '/auth/device'); } catch { /* 何もしない */ }
    clearSession();
    setMe(null);
    navigate('/login', true);
  }, []);

  const actor = useMemo<Actor | null>(() => me && { id: me.user.id, role: me.user.role, factoryIds: me.factories.map((f) => f.id) }, [me]);
  const can = useCallback((action: Action, target?: Target) => (actor ? canFn(actor, action, target) : false), [actor]);

  const value = useMemo(() => ({ me, loading, error, reload, logout, can }), [me, loading, error, reload, logout, can]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('AuthProvider の外で useAuth を使っています');
  return v;
}
