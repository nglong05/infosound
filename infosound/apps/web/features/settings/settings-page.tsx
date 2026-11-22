'use client';
import { useState, type FormEvent } from 'react';
import { useAppRouter as useRouter } from '@/components/app-navigation';
import { NavigationAction } from '@/components/navigation-action';
import { useI18n } from '@/components/locale-provider';
import { api, type User } from '@/lib/api';
import { useAuth, useToast } from '@/components/providers';
import { PageTitle } from '@/components/common';
import { Icon } from '@/components/icons';
import { useSignInOptions } from '@/components/oauth-signin';
import { ModerationSettingsLink } from '../../components/comment-moderation';
import { AvatarSettings } from '@/features/settings/avatar-settings';

export function Settings() {
  const { t: tr } = useI18n();
  const { user, reload, logout } = useAuth();
  const signInOptions = useSignInOptions();
  const toast = useToast();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const save = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setPending(true);
    setError('');
    const f = new FormData(e.currentTarget);
    try {
      await api<User>('/me', {
        method: 'PATCH',
        body: { displayName: f.get('displayName'), bio: f.get('bio') },
      });
      await reload();
      toast('Đã cập nhật hồ sơ của bạn.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  };
  return (
    <>
      <PageTitle
        eyebrow={tr('TÀI KHOẢN CỦA BẠN')}
        title={tr('Đặt dấu ấn của riêng bạn.')}
        description={tr('Quản lý hồ sơ và bảo mật phiên đăng nhập.')}
      />
      <div className="settings-grid">
        <ModerationSettingsLink />
        <AvatarSettings />
        <form className="surface form-stack" onSubmit={save}>
          <h2>{tr('Hồ sơ cá nhân')}</h2>
          {error && (
            <p role="alert" className="form-error">
              {tr(error)}
            </p>
          )}
          <label>
            {tr('Tên hiển thị')}
            <input
              name="displayName"
              required
              minLength={2}
              maxLength={80}
              defaultValue={user?.displayName}
            />
          </label>
          <label>
            {tr('Giới thiệu')}
            <textarea
              name="bio"
              rows={5}
              maxLength={2000}
              defaultValue={user?.bio}
              placeholder={tr('Kể một chút về bạn và âm nhạc…')}
            />
          </label>
          <label>
            {tr('Email')}
            <input
              value={user?.email || ''}
              placeholder={tr('Chưa liên kết email')}
              readOnly
              type="email"
            />
          </label>
          <p className="muted small">
            {tr('Email chỉ hiển thị với bạn. Vai trò:')}{' '}
            {user?.role === 'AUTHOR' ? tr('Nghệ sĩ (AUTHOR)') : tr('Người nghe (USER)')}.
          </p>
          <button className="button" disabled={pending}>
            {pending ? tr('Đang lưu…') : tr('Lưu hồ sơ')}
          </button>
          {user && (
            <NavigationAction href={'/profile/' + user.id}>
              {tr('Xem hồ sơ công khai')}
            </NavigationAction>
          )}
        </form>
        <section className="surface form-stack">
          <h2>{tr('Bảo mật & phiên đăng nhập')}</h2>
          <p className="muted">
            {tr(
              'Quản lý các phiên đăng nhập và đăng xuất khỏi những thiết bị bạn không còn sử dụng.',
            )}
          </p>
          {signInOptions.data?.emailEnabled && user?.email && (
            <NavigationAction href="/forgot-password">
              {tr('Đổi mật khẩu qua email')}
            </NavigationAction>
          )}
          <button
            className="button secondary"
            disabled={pending}
            onClick={() => {
              setPending(true);
              void logout(true)
                .then(() => {
                  toast('Đã đăng xuất khỏi mọi phiên.');
                  router.push('/login');
                })
                .catch((e) => toast(e.message, 'error'))
                .finally(() => setPending(false));
            }}
          >
            {tr('Đăng xuất mọi phiên')}
          </button>
          <button
            className="button danger"
            disabled={pending}
            onClick={() =>
              void logout()
                .then(() => router.push('/login'))
                .catch((e) => toast(e.message, 'error'))
            }
          >
            <Icon name="logout" />
            {tr('Đăng xuất phiên này')}
          </button>
        </section>
      </div>
    </>
  );
}
