'use client';
import { useI18n } from '@/components/locale-provider';

import { NavigationAction } from './navigation-action';
import { useSearchParams } from 'next/navigation';
import { useAppRouter as useRouter } from './app-navigation';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { api, type User } from '@/lib/api';
import { emailError, passwordError } from '@/lib/auth-validation';
import { useAuth } from './providers';
import { Icon } from './icons';
import { hasEnabledOAuth, OAuthSignIn, oauthErrorMessage, useSignInOptions } from './oauth-signin';
import { EmailOtpRegistration } from './email-otp-signin';
import {
  AuthFormErrors,
  NewPasswordFields,
  useErrorSummaryFocus,
  type AuthFieldErrors,
} from './auth-form-fields';

export function AuthScreen({ mode }: { mode: string }) {
  if (mode === 'login' || mode === 'register') return <EntryAuth register={mode === 'register'} />;
  if (mode === 'verify-email') return <ReplacedVerification />;
  return <RecoveryAuth reset={mode === 'reset-password'} />;
}

function AuthLayout({
  title,
  eyebrow,
  heading,
  description,
  children,
}: {
  title: string;
  eyebrow: string;
  heading: string;
  description: string;
  children: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div className="auth-layout">
      <section className="auth-story">
        <span className="eyebrow">{t('INFOSOUND · KẾT NỐI QUA ÂM NHẠC')}</span>
        <h1>{t(title)}</h1>
        <p>
          {t('Mỗi giai điệu đều có một câu chuyện.')}
          <br />
          {t('Tìm âm thanh của bạn, hoặc chia sẻ câu chuyện của riêng mình.')}
        </p>
        <div className="auth-record" aria-hidden="true">
          <div>
            <Icon name="music" size={48} />
          </div>
        </div>
        <span className="story-note">{t('Không gian cho người nghe & nghệ sĩ độc lập')}</span>
      </section>
      <section className="auth-card">
        <span className="eyebrow">{t(eyebrow)}</span>
        <h2>{t(heading)}</h2>
        <p className="muted">{t(description)}</p>
        {children}
      </section>
    </div>
  );
}

function LoginPasswordField({ disabled, error }: { disabled: boolean; error?: string }) {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);
  return (
    <label htmlFor="login-password">
      {t('Mật khẩu')}
      <div className="password-field">
        <input
          id="login-password"
          name="password"
          type={visible ? 'text' : 'password'}
          required
          maxLength={128}
          autoComplete="current-password"
          disabled={disabled}
          aria-invalid={!!error}
          aria-describedby={error ? 'login-password-error' : undefined}
        />
        <button
          type="button"
          disabled={disabled}
          onClick={() => setVisible((value) => !value)}
          aria-label={visible ? t('Ẩn mật khẩu') : t('Hiện mật khẩu')}
          aria-pressed={visible}
        >
          {visible ? t('Ẩn') : t('Hiện')}
        </button>
      </div>
      {error && (
        <span className="field-error" id="login-password-error">
          {t(error)}
        </span>
      )}
    </label>
  );
}

function EntryAuth({ register }: { register: boolean }) {
  const { t } = useI18n();
  const params = useSearchParams();
  const router = useRouter();
  const auth = useAuth();
  const options = useSignInOptions();
  const emailAvailable = options.data?.emailEnabled === true;
  const [pending, setPending] = useState(false);
  const [oauthPending, setOAuthPending] = useState(false);
  const busy = pending || oauthPending;
  const [error, setError] = useState(() =>
    !register && params.has('oauth_error')
      ? oauthErrorMessage(params.get('oauth_error') || '')
      : '',
  );
  const [fields, setFields] = useState<AuthFieldErrors>({});
  const [registered] = useState(() => !register && params.get('registered') === '1');
  const { summary, focusErrors } = useErrorSummaryFocus();
  useEffect(() => {
    if (params.has('oauth_error') || params.has('registered')) {
      const address = new URL(window.location.href);
      address.searchParams.delete('oauth_error');
      address.searchParams.delete('registered');
      window.history.replaceState(null, '', address.pathname + address.search);
    }
  }, [params]);
  const passwordLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const email = String(form.get('email') || '')
      .trim()
      .toLowerCase();
    const password = String(form.get('password') || '');
    const validation: AuthFieldErrors = {};
    const emailIssue = emailError(email);
    if (emailIssue) validation.email = emailIssue;
    if (!password) validation.password = 'Nhập mật khẩu của bạn.';
    setFields(validation);
    setError('');
    if (Object.keys(validation).length) {
      focusErrors();
      return;
    }
    setPending(true);
    try {
      const result = await api<{ accessToken: string; user: User }>('/auth/login', {
        method: 'POST',
        auth: false,
        body: { email, password },
      });
      formElement.reset();
      auth.login(result.accessToken, result.user);
      router.replace('/');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không thể đăng nhập. Vui lòng thử lại.');
      focusErrors();
    } finally {
      setPending(false);
    }
  };
  return (
    <AuthLayout
      title={register ? t('Bắt đầu hành trình âm nhạc.') : t('Chào mừng bạn trở lại.')}
      eyebrow={register ? t('TÀI KHOẢN MỚI') : t('TÀI KHOẢN INFOSOUND')}
      heading={register ? t('Tham gia InfoSound') : t('Đăng nhập')}
      description={
        register ? t('Tạo tài khoản và xác minh email để bắt đầu.') : t('Âm nhạc đang chờ bạn.')
      }
    >
      {register ? (
        options.isPending ? (
          <p className="auth-options-loading muted" role="status">
            {t('Đang tải thông tin đăng ký…')}
          </p>
        ) : emailAvailable || hasEnabledOAuth(options.data) ? (
          <EmailOtpRegistration emailEnabled={emailAvailable} />
        ) : (
          <div className="email-unavailable" role={options.isError ? 'alert' : 'status'}>
            <p>
              {options.isError
                ? t('Chưa thể tải thông tin đăng ký. Vui lòng thử lại.')
                : t('Việc tạo tài khoản mới hiện chưa khả dụng. Vui lòng quay lại sau.')}
            </p>
            {options.isError && (
              <button
                type="button"
                className="inline-link"
                disabled={options.isFetching}
                onClick={() => void options.refetch()}
              >
                {options.isFetching ? t('Đang thử lại…') : t('Thử lại')}
              </button>
            )}
          </div>
        )
      ) : (
        <>
          {registered && (
            <p className="registration-success" role="status">
              {t(
                'Tài khoản đã được xác minh. Đăng nhập bằng email và mật khẩu của bạn để tiếp tục.',
              )}
            </p>
          )}
          <AuthFormErrors prefix="login" message={t(error)} fields={fields} summary={summary} />
          <form className="form-stack" onSubmit={(event) => void passwordLogin(event)} noValidate>
            <label htmlFor="login-email">
              {t('Email')}
              <input
                id="login-email"
                name="email"
                type="email"
                required
                autoComplete="email"
                maxLength={254}
                placeholder={t('ban@example.com')}
                disabled={busy}
                aria-invalid={!!fields.email}
                aria-describedby={fields.email ? 'login-email-error' : undefined}
              />
              {fields.email && (
                <span className="field-error" id="login-email-error">
                  {t(fields.email)}
                </span>
              )}
            </label>
            <LoginPasswordField disabled={busy} error={fields.password} />
            {emailAvailable && (
              <NavigationAction className="align-right" href="/forgot-password">
                {t('Quên mật khẩu?')}
              </NavigationAction>
            )}
            <button className="button full" disabled={busy}>
              {pending ? t('Đang đăng nhập…') : t('Đăng nhập')}
              <Icon name="arrow" size={18} />
            </button>
          </form>
          <OAuthSignIn disabled={pending} onPendingChange={setOAuthPending} />
        </>
      )}
      <div className="auth-switch">
        {register ? (
          <>
            {t('Đã có tài khoản?')}{' '}
            <NavigationAction href="/login">{t('Đăng nhập')}</NavigationAction>
          </>
        ) : (
          <>
            {t('Chưa có tài khoản?')}{' '}
            <NavigationAction href="/register">{t('Tham gia InfoSound')}</NavigationAction>
          </>
        )}
      </div>
    </AuthLayout>
  );
}

function ReplacedVerification() {
  const { t } = useI18n();
  useEffect(() => {
    window.history.replaceState(null, '', window.location.pathname);
  }, []);
  return (
    <AuthLayout
      title={t('Xác minh email của bạn.')}
      eyebrow={t('XÁC MINH TÀI KHOẢN')}
      heading={t('Tiếp tục đăng ký')}
      description={t('Tài khoản được xác minh bằng mã gửi qua email.')}
    >
      <p className="muted small">
        {t(
          'Liên kết này không còn được sử dụng. Hãy bắt đầu từ trang đăng ký để nhận mã xác nhận mới.',
        )}
      </p>
      <NavigationAction href="/register" className="auth-method-switch">
        {t('Đến trang đăng ký')}
      </NavigationAction>
      <div className="auth-switch">
        <NavigationAction href="/login">{t('Về trang đăng nhập')}</NavigationAction>
      </div>
    </AuthLayout>
  );
}

function RecoveryAuth({ reset }: { reset: boolean }) {
  const { t } = useI18n();
  const params = useSearchParams();
  const options = useSignInOptions();
  const emailAvailable = options.data?.emailEnabled === true;
  const [privateToken, setPrivateToken] = useState(() => params.get('token'));
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [fields, setFields] = useState<AuthFieldErrors>({});
  const { summary, focusErrors } = useErrorSummaryFocus();
  const prefix = 'recovery';
  useEffect(() => {
    if (reset && privateToken) window.history.replaceState(null, '', window.location.pathname);
  }, [reset, privateToken]);
  const clearField = (field: string) =>
    setFields((current) => {
      const next = { ...current };
      delete next[field];
      return next;
    });
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const email = String(form.get('email') || '')
      .trim()
      .toLowerCase();
    const validation: AuthFieldErrors = {};
    if (reset) {
      const issue = passwordError(password);
      if (issue) validation.password = issue;
      if (!confirmation || confirmation !== password)
        validation.confirmation = 'Nhập lại mật khẩu trùng với mật khẩu ở trên.';
    } else {
      const issue = emailError(email);
      if (issue) validation.email = issue;
    }
    setFields(validation);
    setError('');
    if (Object.keys(validation).length) {
      focusErrors();
      return;
    }
    if (reset && !privateToken) {
      setError('Liên kết không hợp lệ hoặc đã hết hạn. Hãy yêu cầu liên kết khôi phục mới.');
      focusErrors();
      return;
    }
    setPending(true);
    try {
      if (reset) {
        await api('/auth/reset-password', {
          method: 'POST',
          auth: false,
          body: { token: privateToken, password },
        });
        setPassword('');
        setConfirmation('');
        setPrivateToken(null);
        setMessage('Đã đổi mật khẩu và thu hồi các phiên cũ. Vui lòng đăng nhập lại.');
      } else {
        await api('/auth/forgot-password', { method: 'POST', auth: false, body: { email } });
        formElement.reset();
        setMessage('Nếu email đã đăng ký, bạn sẽ nhận được liên kết đặt lại mật khẩu qua email.');
      }
      setFields({});
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không thể hoàn tất yêu cầu.');
      focusErrors();
    } finally {
      setPending(false);
    }
  };
  return (
    <AuthLayout
      title={reset ? t('Tạo mật khẩu mới.') : t('Tìm lại không gian của bạn.')}
      eyebrow={reset ? t('BẢO MẬT TÀI KHOẢN') : t('KHÔI PHỤC TÀI KHOẢN')}
      heading={reset ? t('Đặt lại mật khẩu') : t('Quên mật khẩu?')}
      description={
        reset
          ? t('Bảo vệ không gian âm nhạc của bạn.')
          : t('Tìm lại quyền truy cập vào tài khoản của bạn.')
      }
    >
      <AuthFormErrors prefix={prefix} message={t(error)} fields={fields} summary={summary} />
      {message ? (
        <div className="success-box" role="status">
          <Icon name="check" size={32} />
          <p>{t(message)}</p>
          <NavigationAction href="/login">{t('Đến trang đăng nhập')}</NavigationAction>
        </div>
      ) : !emailAvailable ? (
        <div className="email-unavailable" role="status">
          <p>
            {options.isPending
              ? t('Đang tải…')
              : t('Khôi phục tài khoản hiện chưa khả dụng. Vui lòng thử lại sau.')}
          </p>
          <NavigationAction href="/login">{t('Về trang đăng nhập')}</NavigationAction>
        </div>
      ) : (
        <form onSubmit={(event) => void submit(event)} className="form-stack" noValidate>
          {reset ? (
            <NewPasswordFields
              prefix={prefix}
              password={password}
              confirmation={confirmation}
              onPasswordChange={(value) => {
                setPassword(value);
                clearField('password');
              }}
              onConfirmationChange={(value) => {
                setConfirmation(value);
                clearField('confirmation');
              }}
              errors={fields}
              disabled={pending}
            />
          ) : (
            <label htmlFor="recovery-email">
              {t('Email')}
              <input
                id="recovery-email"
                name="email"
                type="email"
                required
                autoComplete="email"
                maxLength={254}
                placeholder={t('ban@example.com')}
                disabled={pending}
                aria-invalid={!!fields.email}
                aria-describedby={fields.email ? 'recovery-email-error' : undefined}
              />
              {fields.email && (
                <span className="field-error" id="recovery-email-error">
                  {t(fields.email)}
                </span>
              )}
            </label>
          )}
          <button className="button full" disabled={pending}>
            {pending
              ? t('Đang xử lý…')
              : reset
                ? t('Lưu mật khẩu mới')
                : t('Gửi liên kết khôi phục')}
            <Icon name={reset ? 'arrow' : 'mail'} />
          </button>
        </form>
      )}
      <div className="auth-switch">
        <NavigationAction href="/login">{t('Về trang đăng nhập')}</NavigationAction>
      </div>
    </AuthLayout>
  );
}
