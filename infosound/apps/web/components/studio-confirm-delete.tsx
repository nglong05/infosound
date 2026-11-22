'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { lockBodyScroll } from '@/lib/body-scroll-lock';
import { useI18n } from './locale-provider';
import { useToast } from './providers';
import { useErrorSummaryFocus } from './auth-form-fields';

/** Only the explicit final button can request deletion. */
export function StudioConfirmDelete({
  title,
  disabled,
  onConfirm,
}: {
  title: string;
  disabled: boolean;
  onConfirm: () => Promise<void>;
}) {
  const { t } = useI18n(),
    toast = useToast();
  const [open, setOpen] = useState(false),
    [pending, setPending] = useState(false),
    [error, setError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null),
    trigger = useRef<HTMLButtonElement>(null),
    cancel = useRef<HTMLButtonElement>(null);
  const { summary: errorSummary, focusErrors } = useErrorSummaryFocus();
  const mounted = useRef(true),
    inFlight = useRef(false),
    isOpen = useRef(open);
  isOpen.current = open;
  const id = useId();
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!open) return;
    const element = dialog.current;
    if (!element?.isConnected) return;
    const another = () =>
      [
        ...document.querySelectorAll<HTMLElement>(
          'dialog[open],[role="dialog"],[role="alertdialog"]',
        ),
      ].some(
        (item) => item !== element && !item.closest('[hidden]') && item.getClientRects().length > 0,
      );
    if (another()) {
      setOpen(false);
      return;
    }
    try {
      if (!element.open) element.showModal();
    } catch {
      setOpen(false);
      return;
    }
    const unlock = lockBodyScroll();
    cancel.current?.focus({ preventScroll: true });
    return () => {
      if (element.open) element.close();
      unlock();
      if (mounted.current && !another() && trigger.current?.isConnected)
        trigger.current.focus({ preventScroll: true });
    };
  }, [open]);
  const close = () => {
    if (!inFlight.current) setOpen(false);
  };
  const confirm = async () => {
    if (inFlight.current || disabled || !open || !dialog.current?.open) return;
    inFlight.current = true;
    setPending(true);
    setError('');
    try {
      await onConfirm();
      if (mounted.current) setOpen(false);
    } catch (reason) {
      if (mounted.current) {
        const message =
          reason instanceof Error
            ? reason.message
            : 'Không thể hoàn tất yêu cầu. Kiểm tra thông tin và thử lại.';
        setError(message);
        toast(message, 'error');
        focusErrors();
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setPending(false);
    }
  };
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="button studio-delete-trigger"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-controls={id}
        aria-expanded={open}
        onClick={() => {
          setError('');
          setOpen(true);
        }}
      >
        {t('Xóa bài hát')}
      </button>
      <dialog
        ref={dialog}
        id={id}
        className="studio-delete-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={id + '-title'}
        aria-describedby={id + '-track ' + id + '-warning'}
        aria-busy={pending}
        onCancel={(event) => {
          event.preventDefault();
          close();
        }}
        onClose={() => {
          if (isOpen.current && !dialog.current?.open && !inFlight.current) setOpen(false);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') event.stopPropagation();
        }}
      >
        <h2 id={id + '-title'}>{t('Xóa bài hát này khỏi InfoSound?')}</h2>
        <p id={id + '-track'} className="studio-delete-track" dir="auto">
          {title}
        </p>
        <p id={id + '-warning'} className="muted">
          {t(
            'Bài hát sẽ ngừng hiển thị và không được cấp URL phát mới. URL đã cấp vẫn có thể còn hiệu lực trong thời gian ngắn.',
          )}
        </p>
        {error && (
          <div ref={errorSummary} className="form-error" tabIndex={-1} role="alert">
            {t(error)}
          </div>
        )}
        <div className="action-row">
          <button
            ref={cancel}
            type="button"
            className="button secondary"
            disabled={pending}
            onClick={close}
          >
            {t('Hủy')}
          </button>
          <button
            type="button"
            className="button danger"
            disabled={disabled || pending}
            onClick={() => void confirm()}
          >
            {pending ? t('Đang thực hiện…') : t('Xóa bài hát')}
          </button>
        </div>
      </dialog>
    </>
  );
}
