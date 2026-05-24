import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  ApiError,
  fetchAuthStatus,
  getAdminToken,
  loginAdmin,
  setAdminToken,
} from '../api';
import { LoginPage } from '../pages/Login';

interface AuthContextValue {
  authEnabled: boolean;
  isAuthenticated: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [authEnabled, setAuthEnabled] = useState(false);
  const [token, setToken] = useState<string | null>(() => getAdminToken());

  useEffect(() => {
    fetchAuthStatus()
      .then((s) => {
        setAuthEnabled(s.authEnabled);
        if (!s.authEnabled) setAdminToken(null);
      })
      .catch(() => setAuthEnabled(false))
      .finally(() => setReady(true));
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const result = await loginAdmin(username, password);
    if (result.token) {
      setAdminToken(result.token);
      setToken(result.token);
    }
  }, []);

  const logout = useCallback(() => {
    setAdminToken(null);
    setToken(null);
  }, []);

  const value = useMemo(
    () => ({
      authEnabled,
      isAuthenticated: !authEnabled || Boolean(token),
      login,
      logout,
    }),
    [authEnabled, token, login, logout],
  );

  if (!ready) {
    return (
      <div className="login-screen">
        <p className="muted">Loading…</p>
      </div>
    );
  }

  if (authEnabled && !token) {
    return <LoginPage onLogin={login} />;
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export function useApiAuthRedirect(): void {
  useEffect(() => {
    const handler = (event: PromiseRejectionEvent) => {
      if (event.reason instanceof ApiError && event.reason.status === 401) {
        setAdminToken(null);
        window.location.reload();
      }
    };
    window.addEventListener('unhandledrejection', handler);
    return () => window.removeEventListener('unhandledrejection', handler);
  }, []);
}
