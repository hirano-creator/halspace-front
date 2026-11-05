import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { can as canFn, type Action, type CompanySettings, type Role } from '@partsgate/shared';
import { ApiError, apiGet, setUnauthorizedHandler } from '../api/client';
import { navigate } from '../router';
import { clearSession, currentToken, sessionExpired } from './session';

export interface Me {
  user: { id: number; name: string; email: string | null; role: Role; roleLabel: string };
  company: { id: number; name: string; code: string; status: string } | null;
  operator: boolean;
  via: 'space' | 'dev-stub';
  settings: CompanySettings;
}

interface AuthState {
  me: Me | null;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  logout: () => void;
  /** 画面の出し分け用。最終判定は API 側 */
  can: (action: Action) => boolean;
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

  const logout = useCallback(() => {
    clearSession();
    setMe(null);
    navigate('/login', true);
  }, []);

  // 一定時間を過ぎたログインは、ログインし直してもらう
  useEffect(() => {
    if (me && sessionExpired(me.settings.reauth_hours)) {
      clearSession();
      navigate('/login', true);
      window.location.reload();
    }
  }, [me]);

  const can = useCallback((action: Action) => (me ? canFn({ role: me.user.role, operator: me.operator }, action) : false), [me]);
  const value = useMemo(() => ({ me, loading, error, reload, logout, can }), [me, loading, error, reload, logout, can]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('AuthProvider の外で useAuth を使っています');
  return v;
}
