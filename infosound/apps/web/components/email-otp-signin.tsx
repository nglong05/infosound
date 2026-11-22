'use client';
import { useI18n } from '@/components/locale-provider';

import { NavigationAction } from './navigation-action';
import { useAppRouter as useRouter } from './app-navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, ApiError } from '@/lib/api';
import { emailError, passwordError, usernameError, USERNAME_HELP } from '@/lib/auth-validation';
import {
  AuthFormErrors,
  NewPasswordFields,
  useErrorSummaryFocus,
  type AuthFieldErrors,
} from './auth-form-fields';
import { Icon } from './icons';
import { OAuthSignIn } from './oauth-signin';

type RequestResult = {
  requestId: string;
  message: string;
  retryAfterSeconds?: number;
  expiresInSeconds?: number;
};
type Operation = 'request' | 'resend' | 'verify' | 'cancel' | null;
const safeCooldown = (seconds: number | undefined) =>
  Math.max(
    0,
    Math.min(
      3600,
      typeof seconds === 'number' && Number.isFinite(seconds) ? Math.ceil(seconds) : 60,
    ),
  );

function RegistrationRoleChoice({
  role,
  disabled,
  onChange,
}: {
  role: 'USER' | 'AUTHOR';
  disabled: boolean;
  onChange: (role: 'USER' | 'AUTHOR') => void;
}) {
  const { t } = useI18n();
  return (
    <fieldset>
      <legend>{t('Bạn đến đây để…')}</legend>
      <label className="radio-card">
        <input
          type="radio"
          name="role"
          value="USER"
          checked={role === 'USER'}
          disabled={disabled}
          onChange={() => onChange('USER')}
        />
        <span>
          <strong>{t('Lắng nghe & khám phá')}</strong>
          <small>{t('Lưu nhạc, tạo playlist, theo dõi nghệ sĩ.')}</small>
        </span>
        <Icon name="library" />
      </label>
      <label className="radio-card">
        <input
          type="radio"
          name="role"
          value="AUTHOR"
          checked={role === 'AUTHOR'}
          disabled={disabled}
          onChange={() => onChange('AUTHOR')}
        />
        <span>
          <strong>{t('Sáng tạo & chia sẻ')}</strong>
          <small>{t('Mọi quyền người nghe và Studio của riêng bạn.')}</small>
        </span>
        <Icon name="studio" />
      </label>
    </fieldset>
  );
}

export function EmailOtpRegistration({ emailEnabled = true }: { emailEnabled?: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [role, setRole] = useState<'USER' | 'AUTHOR'>('USER');
  const [requestId, setRequestId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [operation, setOperation] = useState<Operation>(null);
  const [oauthPending, setOAuthPending] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [fields, setFields] = useState<AuthFieldErrors>({});
  const [waitUntil, setWaitUntil] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const [validMinutes, setValidMinutes] = useState(8);
  const [completed, setCompleted] = useState(false);
  const { summary, focusErrors } = useErrorSummaryFocus();
  const codeInput = useRef<HTMLInputElement>(null);
  const pending = operation !== null || oauthPending;
  const prefix = 'registration';

  useEffect(() => {
    const secondsLeft = () => Math.max(0, Math.ceil((waitUntil - Date.now()) / 1000));
    setRemaining(secondsLeft());
    if (Date.now() >= waitUntil) return;
    const timer = setInterval(() => {
      const seconds = secondsLeft();
      setRemaining(seconds);
      if (!seconds) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [waitUntil]);
  useEffect(() => {
    if (requestId) codeInput.current?.focus();
  }, [requestId]);
  const clearField = (field: string) =>
    setFields((current) => {
      const next = { ...current };
      delete next[field];
      return next;
    });
  const showError = (reason: unknown) => {
    const text =
      reason instanceof Error ? reason.message : 'Không thể hoàn tất yêu cầu. Vui lòng thử lại.';
    if (reason instanceof ApiError && reason.code === 'OTP_INVALID' && requestId)
      setFields({ code: text });
    else if (reason instanceof ApiError && reason.code === 'USERNAME_UNAVAILABLE' && !requestId)
      setFields({ username: text });
    else setError(text);
    if (
      reason instanceof ApiError &&
      (reason.retryAfterSeconds !== undefined || reason.status === 429)
    ) {
      const cooldown = safeCooldown(reason.retryAfterSeconds);
      setRemaining(cooldown);
      setWaitUntil(Date.now() + cooldown * 1000);
    }
    focusErrors();
  };
  const acceptChallenge = (result: RequestResult, resend: boolean) => {
    setRequestId(result.requestId);
    setCode('');
    const cooldown = safeCooldown(result.retryAfterSeconds);
    setRemaining(cooldown);
    setWaitUntil(Date.now() + cooldown * 1000);
    setValidMinutes(
      typeof result.expiresInSeconds === 'number' && Number.isFinite(result.expiresInSeconds)
        ? Math.max(1, Math.ceil(result.expiresInSeconds / 60))
        : 8,
    );
    setMessage(
      resend
        ? 'Đã yêu cầu mã mới. Hãy sử dụng mã trong email mới nhất.'
        : 'Kiểm tra hộp thư và thư rác để nhận mã xác nhận.',
    );
  };
  const request = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!emailEnabled || pending || Date.now() < waitUntil) return;
    const address = email.trim().toLowerCase();
    const handle = username.trim().toLowerCase();
    const validation: AuthFieldErrors = {};
    const emailIssue = emailError(address);
    if (emailIssue) validation.email = emailIssue;
    const usernameIssue = usernameError(handle);
    if (usernameIssue) validation.username = usernameIssue;
    const passwordIssue = passwordError(password);
    if (passwordIssue) validation.password = passwordIssue;
    if (!confirmation || password !== confirmation)
      validation.confirmation = 'Nhập lại mật khẩu trùng với mật khẩu ở trên.';
    setFields(validation);
    setError('');
    setMessage('');
    if (Object.keys(validation).length) {
      focusErrors();
      return;
    }
    setOperation('request');
    try {
      const result = await api<RequestResult>('/auth/email-otp/request', {
        method: 'POST',
        auth: false,
        body: { email: address, username: handle, password, role },
      });
      setEmail(address);
      setUsername(handle);
      setPassword('');
      setConfirmation('');
      acceptChallenge(result, false);
    } catch (reason) {
      showError(reason);
    } finally {
      setOperation(null);
    }
  };
  const resend = async () => {
    if (pending || !requestId || Date.now() < waitUntil) return;
    setOperation('resend');
    setError('');
    setFields({});
    setMessage('');
    try {
      const result = await api<RequestResult>('/auth/email-otp/resend', {
        method: 'POST',
        auth: false,
        body: { requestId },
      });
      acceptChallenge(result, true);
    } catch (reason) {
      showError(reason);
    } finally {
      setOperation(null);
    }
  };
  const verify = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending || !requestId) return;
    setError('');
    setFields({});
    if (!/^[0-9]{6}$/.test(code)) {
      setFields({ code: 'Nhập đủ 6 chữ số trong email xác nhận.' });
      focusErrors();
      return;
    }
    setOperation('verify');
    try {
      const result = await api<{ registered: true; message: string }>('/auth/email-otp/verify', {
        method: 'POST',
        auth: false,
        body: { requestId, code },
      });
      if (result.registered !== true)
        throw new Error('Chưa thể xác nhận đăng ký. Vui lòng thử lại.');
      setEmail('');
      setUsername('');
      setPassword('');
      setConfirmation('');
      setCode('');
      setRequestId(null);
      setRole('USER');
      setWaitUntil(0);
      setRemaining(0);
      setMessage('');
      setFields({});
      setCompleted(true);
      router.replace('/login?registered=1');
    } catch (reason) {
      setCode('');
      showError(reason);
    } finally {
      setOperation(null);
    }
  };
  const changeDetails = async () => {
    if (pending || !requestId) return;
    setOperation('cancel');
    setError('');
    setFields({});
    try {
      await api('/auth/email-otp/cancel', { method: 'POST', auth: false, body: { requestId } });
      setRequestId(null);
      setPassword('');
      setConfirmation('');
      setCode('');
      setMessage('');
      setWaitUntil(0);
      setRemaining(0);
    } catch (reason) {
      showError(reason);
    } finally {
      setOperation(null);
    }
  };

  if (completed)
    return (
      <div className="success-box" role="status">
        <Icon name="check" size={32} />
        <p>
          {t('Tài khoản đã được xác minh. Đăng nhập bằng email và mật khẩu của bạn để tiếp tục.')}
        </p>
        <NavigationAction href="/login">{t('Đến trang đăng nhập')}</NavigationAction>
      </div>
    );
  return (
    <div className="email-otp-signin">
      <AuthFormErrors prefix={prefix} message={t(error)} fields={fields} summary={summary} />
      {!requestId ? (
        emailEnabled ? (
          <form className="form-stack" onSubmit={(event) => void request(event)} noValidate>
            <label htmlFor="registration-email">
              {t('Email')}
              <input
                id="registration-email"
                name="email"
                type="email"
                required
                autoComplete="email"
                maxLength={254}
                value={email}
                disabled={pending}
                aria-invalid={!!fields.email}
                aria-describedby={fields.email ? 'registration-email-error' : undefined}
                onChange={(event) => {
                  setEmail(event.target.value);
                  clearField('email');
                }}
                placeholder={t('ban@example.com')}
              />
              {fields.email && (
                <span className="field-error" id="registration-email-error">
                  {t(fields.email)}
                </span>
              )}
            </label>
            <label htmlFor="registration-username">
              {t('Tên người dùng')}
              <input
                id="registration-username"
                name="username"
                type="text"
                required
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                minLength={3}
                maxLength={30}
                value={username}
                disabled={pending}
                aria-invalid={!!fields.username}
                aria-describedby={
                  'registration-username-help' +
                  (fields.username ? ' registration-username-error' : '')
                }
                onChange={(event) => {
                  setUsername(event.target.value.toLowerCase());
                  clearField('username');
                }}
                placeholder={t('ten_cua_ban')}
              />
              <small id="registration-username-help">{t(USERNAME_HELP)}</small>
              {fields.username && (
                <span className="field-error" id="registration-username-error">
                  {t(fields.username)}
                </span>
              )}
            </label>
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
            <RegistrationRoleChoice role={role} disabled={pending} onChange={setRole} />
            <p className="muted small">
              {t('Tài khoản chỉ được tạo sau khi bạn xác nhận mã gửi đến email.')}
            </p>
            <button className="button full" disabled={pending || remaining > 0}>
              {operation === 'request'
                ? t('Đang gửi mã…')
                : remaining > 0
                  ? t('Thử lại sau {seconds} giây', { seconds: remaining })
                  : t('Gửi mã xác nhận')}
              <Icon name="mail" size={18} />
            </button>
          </form>
        ) : (
          <div className="form-stack auth-role-choice">
            <RegistrationRoleChoice role={role} disabled={pending} onChange={setRole} />
          </div>
        )
      ) : (
        <div className="form-stack">
          <div className="otp-destination">
            <h3>{t('Xác minh email đăng ký')}</h3>
            <p>
              {t('Nhập mã 6 chữ số trong email gửi đến')} <strong>{email}</strong>.
            </p>
            <button
              type="button"
              className="inline-link"
              disabled={pending}
              onClick={() => void changeDetails()}
            >
              {operation === 'cancel'
                ? t('Đang mở lại biểu mẫu…')
                : t('Sửa email hoặc thông tin đăng ký')}
            </button>
          </div>
          {message && (
            <p className="otp-status" role="status">
              {t(message)}
            </p>
          )}
          <form className="form-stack" onSubmit={(event) => void verify(event)} noValidate>
            <label htmlFor="registration-code">
              {t('Mã xác nhận')}
              <input
                ref={codeInput}
                id="registration-code"
                name="code"
                className="otp-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoCapitalize="off"
                spellCheck={false}
                enterKeyHint="done"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                value={code}
                disabled={pending}
                aria-invalid={!!fields.code}
                aria-describedby={
                  'registration-code-help' + (fields.code ? ' registration-code-error' : '')
                }
                onChange={(event) => {
                  setCode(event.target.value.replace(/[^0-9]/g, '').slice(0, 6));
                  clearField('code');
                }}
              />
              {fields.code && (
                <span className="field-error" id="registration-code-error">
                  {t(fields.code)}
                </span>
              )}
            </label>
            <small id="registration-code-help" className="otp-code-help">
              {t(
                'Bạn có thể dán mã từ email. Mã có hiệu lực {minutes} phút, dùng một lần và tối đa 5 lần nhập.',
                { minutes: validMinutes },
              )}
            </small>
            <button className="button full" disabled={pending}>
              {operation === 'verify' ? t('Đang xác nhận…') : t('Xác nhận & tạo tài khoản')}
              <Icon name="arrow" size={18} />
            </button>
          </form>
          <div className="otp-resend">
            <span className="muted">{t('Chưa nhận được mã?')}</span>
            <button
              type="button"
              className="inline-link"
              disabled={pending || remaining > 0}
              onClick={() => void resend()}
            >
              {operation === 'resend'
                ? t('Đang gửi lại…')
                : remaining > 0
                  ? t('Gửi lại sau {seconds} giây', { seconds: remaining })
                  : t('Gửi lại mã')}
            </button>
          </div>
        </div>
      )}
      {!requestId && (
        <OAuthSignIn role={role} disabled={operation !== null} onPendingChange={setOAuthPending} />
      )}
    </div>
  );
}
