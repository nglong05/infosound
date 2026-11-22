'use client';
import { useI18n } from '@/components/locale-provider';

import { NavigationAction } from './navigation-action';
import { useAppRouter as useRouter } from './app-navigation';
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from './providers';
import { Icon } from './icons';

type ProviderId = 'google' | 'microsoft' | 'facebook';
export type SignInOptions = {
  providers: { id: ProviderId; name: string; enabled: boolean }[];
  emailEnabled: boolean;
};
const providers: ReadonlyArray<{ id: ProviderId; name: string; hosts: readonly string[] }> = [
  { id: 'google', name: 'Google', hosts: ['accounts.google.com'] },
  { id: 'microsoft', name: 'Microsoft', hosts: ['login.microsoftonline.com'] },
  { id: 'facebook', name: 'Facebook', hosts: ['www.facebook.com', 'facebook.com'] },
];

export function useSignInOptions() {
  return useQuery({
    queryKey: ['auth', 'sign-in-options'],
    queryFn: () => api<SignInOptions>('/auth/oauth/providers', { auth: false }),
    staleTime: 30_000,
    retry: 1,
  });
}

export function hasEnabledOAuth(options: SignInOptions | undefined) {
  return providers.some((provider) =>
    options?.providers.some((item) => item.id === provider.id && item.enabled === true),
  );
}

export function oauthErrorMessage(code: string) {
  const messages: Record<string, string> = {
    cancelled: 'Bạn đã hủy đăng nhập. Hãy chọn một phương thức để thử lại.',
    invalid_state:
      'Phiên đăng nhập này đã hết hạn hoặc không hợp lệ. Hãy bắt đầu lại từ InfoSound.',
    provider_unavailable:
      'Phương thức đăng nhập này hiện chưa khả dụng. Hãy chọn cách khác hoặc thử lại sau.',
    account_exists:
      'Email này đã có tài khoản InfoSound. Hãy đăng nhập bằng phương thức bạn đã sử dụng trước đó.',
    account_disabled: 'Tài khoản này hiện không thể đăng nhập.',
    signin_failed: 'Chưa thể hoàn tất đăng nhập. Hãy thử lại hoặc chọn phương thức khác.',
  };
  return messages[code] || messages.signin_failed;
}

export function OAuthSignIn({
  disabled = false,
  role = 'USER',
  onPendingChange,
}: {
  disabled?: boolean;
  role?: 'USER' | 'AUTHOR';
  onPendingChange: (value: boolean) => void;
}) {
  const { t } = useI18n();
  const options = useSignInOptions();
  const [busy, setBusy] = useState<ProviderId | null>(null);
  const [error, setError] = useState('');
  const summary = useRef<HTMLDivElement>(null);
  const mounted = useRef(false);
  const inFlight = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const pendingChange = useRef(onPendingChange);
  pendingChange.current = onPendingChange;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
      inFlight.current = false;
      pendingChange.current(false);
    };
  }, []);
  useEffect(() => {
    if (error) summary.current?.focus();
  }, [error]);
  const start = async (provider: (typeof providers)[number]) => {
    if (inFlight.current || disabled) return;
    inFlight.current = true;
    const abort = new AbortController();
    controller.current = abort;
    setBusy(provider.id);
    onPendingChange(true);
    setError('');
    try {
      const result = await api<{ url: string }>(`/auth/oauth/${provider.id}/start`, {
        method: 'POST',
        auth: false,
        body: { role },
        signal: abort.signal,
      });
      if (!mounted.current || abort.signal.aborted) return;
      const destination = new URL(result.url);
      if (
        destination.protocol !== 'https:' ||
        destination.port ||
        destination.username ||
        destination.password ||
        !provider.hosts.includes(destination.hostname)
      )
        throw new Error('Không thể mở trang đăng nhập. Vui lòng thử lại sau.');
      window.location.assign(destination.href);
    } catch (reason) {
      if (!mounted.current || abort.signal.aborted) return;
      inFlight.current = false;
      setError(
        reason instanceof Error ? reason.message : 'Không thể bắt đầu đăng nhập. Hãy thử lại.',
      );
      setBusy(null);
      onPendingChange(false);
    }
  };
  const enabledProviders = providers.filter((provider) =>
    options.data?.providers.some((item) => item.id === provider.id && item.enabled === true),
  );
  if (!enabledProviders.length) return null;
  return (
    <div
      className="oauth-signin"
      role="group"
      aria-label={t('Đăng nhập bằng tài khoản liên kết')}
      aria-busy={!!busy}
    >
      {enabledProviders.map((provider) => {
        return (
          <button
            type="button"
            key={provider.id}
            className="button secondary full oauth-button"
            disabled={disabled || !!busy}
            onClick={() => void start(provider)}
          >
            <span>
              {busy === provider.id
                ? t('Đang chuyển đến {provider}…', { provider: provider.name })
                : t('Tiếp tục với {provider}', { provider: provider.name })}
            </span>
            <Icon name="arrow" size={18} />
          </button>
        );
      })}
      {error && (
        <div ref={summary} tabIndex={-1} className="form-error" role="alert">
          {t(error)}
        </div>
      )}
    </div>
  );
}

export function OAuthComplete() {
  const { t } = useI18n();
  const { completeOAuth } = useAuth();
  const router = useRouter();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    void completeOAuth()
      .then((ok) => {
        if (!active) return;
        if (ok) router.replace('/');
        else setFailed(true);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [completeOAuth, router]);
  return (
    <section className="surface auth-completion" aria-labelledby="oauth-complete-title">
      <span className="eyebrow">{t('TÀI KHOẢN INFOSOUND')}</span>
      <h1 id="oauth-complete-title">
        {failed ? t('Chưa thể hoàn tất đăng nhập') : t('Chào mừng đến InfoSound')}
      </h1>
      {failed ? (
        <>
          <p role="alert" className="muted">
            {t('Phiên đăng nhập chưa được xác nhận. Hãy bắt đầu lại để tiếp tục.')}
          </p>
          <NavigationAction href="/login">{t('Về trang đăng nhập')}</NavigationAction>
        </>
      ) : (
        <p className="muted" role="status">
          {t('Đang hoàn tất đăng nhập của bạn…')}
        </p>
      )}
    </section>
  );
}
