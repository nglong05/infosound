'use client';
import { useI18n } from '@/components/locale-provider';

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { PASSWORD_HELP } from '@/lib/auth-validation';

export type AuthFieldErrors = Record<string, string>;

export function useErrorSummaryFocus() {
  const summary = useRef<HTMLDivElement>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  const focusErrors = useCallback(() => setFocusRequest((value) => value + 1), []);
  // Request focus explicitly on failure; wait until React has mounted the summary.
  // Field edits may change errors, but never request focus or restart this effect.
  useEffect(() => {
    if (focusRequest > 0) summary.current?.focus();
  }, [focusRequest]);
  return { summary, focusErrors };
}

export function AuthFormErrors({
  prefix,
  message,
  fields,
  summary,
}: {
  prefix: string;
  message: string;
  fields: AuthFieldErrors;
  summary: RefObject<HTMLDivElement | null>;
}) {
  const { t } = useI18n();
  if (!message && !Object.keys(fields).length) return null;
  return (
    <div
      ref={summary}
      tabIndex={-1}
      role="alert"
      aria-labelledby={prefix + '-error-title'}
      className="form-error auth-error-summary"
    >
      <h3 id={prefix + '-error-title'}>{t('Kiểm tra lại thông tin')}</h3>
      {message && <p>{t(message)}</p>}
      {!!Object.keys(fields).length && (
        <ul>
          {Object.entries(fields).map(([field, error]) => (
            <li key={field}>
              <a href={'#' + prefix + '-' + field}>{t(error)}</a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function NewPasswordFields({
  prefix,
  password,
  confirmation,
  onPasswordChange,
  onConfirmationChange,
  errors,
  disabled = false,
}: {
  prefix: string;
  password: string;
  confirmation: string;
  onPasswordChange: (value: string) => void;
  onConfirmationChange: (value: string) => void;
  errors: AuthFieldErrors;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);
  return (
    <>
      <label htmlFor={prefix + '-password'}>
        {t('Mật khẩu')}
        <div className="password-field">
          <input
            id={prefix + '-password'}
            name="password"
            type={visible ? 'text' : 'password'}
            required
            minLength={8}
            maxLength={128}
            autoComplete="new-password"
            value={password}
            disabled={disabled}
            aria-invalid={!!errors.password}
            aria-describedby={
              prefix + '-password-help' + (errors.password ? ' ' + prefix + '-password-error' : '')
            }
            onChange={(event) => onPasswordChange(event.target.value)}
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
        <small id={prefix + '-password-help'}>{t(PASSWORD_HELP)}</small>
        {errors.password && (
          <span className="field-error" id={prefix + '-password-error'}>
            {t(errors.password)}
          </span>
        )}
      </label>
      <label htmlFor={prefix + '-confirmation'}>
        {t('Nhập lại mật khẩu')}
        <input
          id={prefix + '-confirmation'}
          name="confirmPassword"
          type={visible ? 'text' : 'password'}
          required
          minLength={8}
          maxLength={128}
          autoComplete="new-password"
          value={confirmation}
          disabled={disabled}
          aria-invalid={!!errors.confirmation}
          aria-describedby={errors.confirmation ? prefix + '-confirmation-error' : undefined}
          onChange={(event) => onConfirmationChange(event.target.value)}
        />
        {errors.confirmation && (
          <span className="field-error" id={prefix + '-confirmation-error'}>
            {t(errors.confirmation)}
          </span>
        )}
      </label>
    </>
  );
}
