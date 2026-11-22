'use client';
import { useEffect, useState, useCallback, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api, onAuthChange, refreshSession, setAccessToken, type User, ApiError } from '@/lib/api';
import { Icon } from './icons';
import { useI18n } from './locale-provider';
import { Shell } from './shell';
import { AuthContext } from '@/features/auth/auth-context';
import { PlayerProvider } from '@/features/player/player-provider';
import { ToastContext, type Toast } from '@/shared/feedback/toast-context';
import { Chatbot } from '@/features/chatbot';
export { useAuth } from '@/features/auth/auth-context';
export { usePlayer } from '@/features/player/player-context';
export { useToast } from '@/shared/feedback/toast-context';
export { RecordVisual } from '@/features/player/player-visuals';

export function Providers({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: (count, error) =>
              count < 1 && (!(error instanceof ApiError) || error.status >= 500),
            staleTime: 15000,
            refetchOnWindowFocus: false,
          },
          mutations: { retry: 0 },
        },
      }),
  );
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<Toast | null>(null);
  const reload = useCallback(async () => {
    try {
      setUser(await api<User>('/me'));
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (window.location.pathname === '/oauth/complete') return;
    void refreshSession().then((ok) => (ok ? reload() : setLoading(false)));
  }, [reload]);
  useEffect(
    () =>
      onAuthChange((authenticated) => {
        if (!authenticated && user) {
          setUser(null);
          queryClient.clear();
          window.dispatchEvent(new Event('infosound-logout'));
        }
      }),
    [queryClient, user],
  );
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(id);
  }, [toast]);
  const completeOAuth = useCallback(async () => {
    setLoading(true);
    try {
      if (!(await refreshSession())) {
        setUser(null);
        return false;
      }
      const value = await api<User>('/me', { auth: false });
      setUser(value);
      queryClient.clear();
      return true;
    } catch {
      setAccessToken(null);
      setUser(null);
      return false;
    } finally {
      setLoading(false);
    }
  }, [queryClient]);
  const logout = async (all = false) => {
    try {
      await api(all ? '/auth/logout-all' : '/auth/logout', { method: 'POST', body: {} });
    } finally {
      setAccessToken(null);
      setUser(null);
      queryClient.clear();
      window.dispatchEvent(new Event('infosound-logout'));
    }
  };
  return (
    <QueryClientProvider client={queryClient}>
      <AuthContext.Provider
        value={{
          user,
          loading,
          reload,
          completeOAuth,
          login: (token, value) => {
            setAccessToken(token);
            setUser(value);
            setLoading(false);
            queryClient.clear();
          },
          logout,
        }}
      >
        <ToastContext.Provider value={(message, kind = 'success') => setToast({ message, kind })}>
          <PlayerProvider>
            <Shell>{children}</Shell>
            <Chatbot />
          </PlayerProvider>
          {toast && (
            <div
              className={'toast ' + toast.kind}
              role={toast.kind === 'error' ? 'alert' : 'status'}
            >
              {toast.kind === 'success' && <Icon name="check" />}
              <span>{t(toast.message)}</span>
              <button type="button" aria-label={t('Đóng thông báo')} onClick={() => setToast(null)}>
                <Icon name="close" size={16} />
              </button>
            </div>
          )}
        </ToastContext.Provider>
      </AuthContext.Provider>
    </QueryClientProvider>
  );
}
