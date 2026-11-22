'use client';
import { useState, useRef, type FormEvent } from 'react';
import { useI18n } from '@/components/locale-provider';
import { useQueryClient } from '@tanstack/react-query';
import { api, uploadFile, type User } from '@/lib/api';
import { useAuth, useToast } from '@/components/providers';
import { Avatar } from '@/components/common';
import { Icon } from '@/components/icons';
import { useErrorSummaryFocus } from '@/components/auth-form-fields';

type AvatarUpload = {
  uploadId: string;
  url: string;
  expiresAt: string;
  headers: Record<string, string>;
};

export function AvatarSettings() {
  const { t: tr } = useI18n();
  const { user, reload } = useAuth();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [operation, setOperation] = useState<'upload' | 'remove' | 'cancel' | null>(null);
  const [stage, setStage] = useState('');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const session = useRef<AvatarUpload | null>(null);
  const uploaded = useRef(false);
  const requestKey = useRef<string | null>(null);
  const { summary, focusErrors } = useErrorSummaryFocus();
  const pending = operation !== null;
  const fail = (message: string) => {
    setError(message);
    focusErrors();
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    setError('');
    if (!file) {
      fail('Chọn một ảnh đại diện để tiếp tục.');
      return;
    }
    if (
      !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
      file.size < 1 ||
      file.size > 5 * 1024 * 1024
    ) {
      fail('Chọn ảnh JPEG, PNG hoặc WebP không quá 5 MiB.');
      return;
    }
    setOperation('upload');
    setProgress(0);
    setConfirmRemove(false);
    try {
      setStage('Đang chuẩn bị tải ảnh…');
      if (
        session.current &&
        !uploaded.current &&
        Date.parse(session.current.expiresAt) <= Date.now()
      ) {
        await api('/me/avatar/uploads/' + encodeURIComponent(session.current.uploadId), {
          method: 'DELETE',
        });
        session.current = null;
        requestKey.current = null;
        uploaded.current = false;
      }
      requestKey.current ??= crypto.randomUUID();
      const upload =
        session.current ??
        (await api<AvatarUpload>('/me/avatar/uploads', {
          method: 'POST',
          body: {
            filename: file.name,
            size: file.size,
            contentType: file.type,
            idempotencyKey: requestKey.current,
          },
        }));
      session.current = upload;
      setStage('Đang tải ảnh đại diện…');
      if (!uploaded.current) {
        await uploadFile(upload.url, file, upload.headers, setProgress, 60_000, true);
        uploaded.current = true;
      }
      setStage('Đang hoàn tất ảnh đại diện…');
      await api<{ avatarUrl: string; user: User }>(
        '/me/avatar/uploads/' + encodeURIComponent(upload.uploadId) + '/complete',
        { method: 'POST', body: {} },
      );
      session.current = null;
      requestKey.current = null;
      uploaded.current = false;
      setFile(null);
      if (input.current) input.current.value = '';
      await reload();
      await queryClient.invalidateQueries();
      toast('Đã cập nhật ảnh đại diện của bạn.');
    } catch (reason) {
      fail(
        reason instanceof Error
          ? reason.message
          : 'Chưa thể cập nhật ảnh đại diện. Vui lòng thử lại.',
      );
    } finally {
      setOperation(null);
      setStage('');
    }
  };
  const remove = async () => {
    if (pending) return;
    setOperation('remove');
    setError('');
    try {
      await api('/me/avatar', { method: 'DELETE' });
      session.current = null;
      requestKey.current = null;
      uploaded.current = false;
      setFile(null);
      if (input.current) input.current.value = '';
      await reload();
      await queryClient.invalidateQueries();
      setConfirmRemove(false);
      toast('Đã xóa ảnh đại diện.');
    } catch (reason) {
      fail(
        reason instanceof Error ? reason.message : 'Chưa thể xóa ảnh đại diện. Vui lòng thử lại.',
      );
    } finally {
      setOperation(null);
    }
  };
  const changeImage = async () => {
    if (pending || !session.current) return;
    setOperation('cancel');
    setError('');
    try {
      await api('/me/avatar/uploads/' + encodeURIComponent(session.current.uploadId), {
        method: 'DELETE',
      });
      session.current = null;
      requestKey.current = null;
      uploaded.current = false;
      setFile(null);
      setProgress(0);
      if (input.current) input.current.value = '';
      await reload();
      await queryClient.invalidateQueries();
      toast('Bạn có thể chọn một ảnh khác.');
    } catch (reason) {
      fail(
        reason instanceof Error ? reason.message : 'Chưa thể hủy lần tải ảnh. Vui lòng thử lại.',
      );
    } finally {
      setOperation(null);
    }
  };
  if (!user) return null;
  return (
    <section className="surface avatar-settings" aria-labelledby="avatar-settings-title">
      <div className="avatar-settings-preview">
        <Avatar
          name={user.displayName}
          src={user.avatarUrl}
          className="artist-avatar avatar-settings-image"
        />
      </div>
      <div className="avatar-settings-content">
        <h2 id="avatar-settings-title">{tr('Ảnh đại diện')}</h2>
        <p className="muted">{tr('Một dấu ấn để mọi người nhận ra bạn.')}</p>
        {error && (
          <div
            ref={summary}
            role="alert"
            tabIndex={-1}
            className="form-error auth-error-summary"
            aria-labelledby="avatar-error-title"
          >
            <h3 id="avatar-error-title">{tr('Chưa thể cập nhật ảnh')}</h3>
            <a href={session.current ? '#avatar-upload-submit' : '#settings-avatar'}>{tr(error)}</a>
          </div>
        )}
        <form
          className="form-stack avatar-upload-form"
          onSubmit={(event) => void submit(event)}
          noValidate
          aria-busy={pending}
        >
          <label htmlFor="settings-avatar">
            {tr('Chọn ảnh mới')}
            <input
              ref={input}
              id="settings-avatar"
              name="avatar"
              type="file"
              accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
              disabled={pending || !!session.current}
              aria-describedby={'settings-avatar-help' + (error ? ' settings-avatar-error' : '')}
              aria-invalid={!!error}
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
                setError('');
                session.current = null;
                requestKey.current = null;
                uploaded.current = false;
                setProgress(0);
              }}
            />
            <small id="settings-avatar-help">
              {tr(
                'JPEG, PNG hoặc WebP không động · Tối đa 5 MiB, 16 megapixel · Cạnh ảnh tối đa 4096 px.',
              )}
            </small>
            {error && (
              <span className="field-error" id="settings-avatar-error">
                {tr(error)}
              </span>
            )}
          </label>
          {file && (
            <p className="avatar-selected-file muted">
              {file.name} <span>· {(file.size / 1024 / 1024).toFixed(2)} MiB</span>
            </p>
          )}
          {operation === 'upload' && (
            <div className="upload-progress">
              <p role="status">{tr(stage)}</p>
              <progress max={100} value={progress} aria-label={tr('Tiến độ tải ảnh đại diện')} />
            </div>
          )}
          <div className="action-row">
            <button
              id="avatar-upload-submit"
              className="button"
              type="submit"
              disabled={pending || !file}
            >
              <Icon name="upload" />
              {operation === 'upload' ? tr('Đang cập nhật…') : tr('Cập nhật ảnh')}
            </button>
            {session.current && (
              <button
                className="button secondary"
                type="button"
                disabled={pending}
                onClick={() => void changeImage()}
              >
                {operation === 'cancel' ? tr('Đang hủy…') : tr('Chọn ảnh khác')}
              </button>
            )}
            {user.avatarUrl && !confirmRemove && (
              <button
                className="button secondary"
                type="button"
                disabled={pending}
                onClick={() => setConfirmRemove(true)}
              >
                {tr('Xóa ảnh')}
              </button>
            )}
          </div>
        </form>
        {confirmRemove && (
          <div
            className="avatar-delete-confirm"
            role="group"
            aria-label={tr('Xác nhận xóa ảnh đại diện')}
          >
            <p>{tr('Xóa ảnh đại diện hiện tại?')}</p>
            <div className="action-row">
              <button className="button danger" disabled={pending} onClick={() => void remove()}>
                {operation === 'remove' ? tr('Đang xóa…') : tr('Xác nhận xóa')}
              </button>
              <button
                className="button secondary"
                disabled={pending}
                onClick={() => setConfirmRemove(false)}
              >
                {tr('Hủy')}
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
