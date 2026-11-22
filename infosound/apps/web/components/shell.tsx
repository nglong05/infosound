'use client';
import { useEffect, useRef, useState, useCallback, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { useAppRouter as useRouter, AppForm as Form } from './app-navigation';
import Link from './app-navigation';
import { NavigationAction } from './navigation-action';
import type { User } from '@/lib/api';
import { Icon } from './icons';
import { useI18n } from './locale-provider';
import { LanguageSelector } from './language-selector';
import { ThemeSelector } from './theme-selector';
import { KeyboardShortcuts } from './keyboard-shortcuts';
import { useKeyboardShortcuts } from './use-keyboard-shortcuts';
import { shortcutGroups } from '@/lib/keyboard-shortcuts';
import { LyricsScreen } from './lyrics-screen';
import { useAuth } from '@/features/auth/auth-context';
import { usePlayer } from '@/features/player/player-context';
import { useToast } from '@/shared/feedback/toast-context';

export function ProfileAvatar({ user }: { user: User }) {
  const [failed, setFailed] = useState<string | null>(null);
  const src = user.avatarUrl;
  return (
    <span className="avatar">
      {src && failed !== src ? (
        <img
          crossOrigin="anonymous"
          src={src}
          alt=""
          width={36}
          height={36}
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(src)}
        />
      ) : (
        user.displayName.slice(0, 1).toUpperCase()
      )}
    </span>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const { lyricsOpen, closeLyrics } = usePlayer();
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const openShortcuts = useCallback(() => setShortcutsOpen(true), []);
  const { charactersEnabled, setCharactersEnabled } = useKeyboardShortcuts(openShortcuts);
  const previousPath = useRef<string | null>(null);
  const header = useRef<HTMLElement>(null);
  useEffect(() => {
    const element = header.current;
    if (!element) return;
    const measure = () =>
      document.documentElement.style.setProperty(
        '--topbar-height',
        `${Math.ceil(element.getBoundingClientRect().height)}px`,
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty('--topbar-height');
    };
  }, []);
  const { user, loading, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const toast = useToast();
  const isAuthor = !loading && user?.role === 'AUTHOR';
  const isLibrarySubpage =
    pathname === '/library/liked' || pathname === '/playlists' || pathname.startsWith('/playlists/');
  const links = [
    ['/', 'home', t('Khám phá')],
    ['/search', 'search', t('Tìm kiếm')],
    ['/library', 'library', t('Thư viện')],
    ['/history', 'history', t('Lịch sử')],
    ['/notifications', 'bell', t('Thông báo')],
  ];
  const mobileLinks = links
    .slice(0, 3)
    .concat(isAuthor ? [['/studio', 'studio', t('Studio')]] : []);
  useEffect(() => {
    if (previousPath.current !== null && previousPath.current !== pathname) closeLyrics();
    previousPath.current = pathname;
    document.getElementById('main-content')?.focus({ preventScroll: true });
  }, [pathname, closeLyrics]);
  return (
    <>
      <a href="#main-content" className="skip">
        {t('Đến nội dung chính')}
      </a>
      <aside className="sidebar" hidden={lyricsOpen}>
        <Link href="/" className="brand">
          <span className="brand-symbol">
            <i />
            <i />
            <i />
            <i />
            <i />
          </span>
          InfoSound<span className="brand-dot">.</span>
        </Link>
        <p className="nav-caption">{t('KHÔNG GIAN CỦA BẠN')}</p>
        <nav aria-label={t('Điều hướng chính')}>
          {links.map(([href, icon, title]) => (
            <Link
              key={href}
              href={href}
              aria-current={
                pathname === href
                  ? 'page'
                  : href === '/library' && isLibrarySubpage
                    ? 'location'
                    : undefined
              }
              className={
                pathname === href || (href === '/library' && isLibrarySubpage) ? 'active' : ''
              }
            >
              <Icon name={icon} />
              {title}
            </Link>
          ))}
        </nav>
        {isAuthor && (
          <>
            <div className="sidebar-rule" />
            <p className="nav-caption">{t('DÀNH CHO NHÀ SÁNG TẠO')}</p>
            <Link
              href="/studio"
              className={'studio-link ' + (pathname.startsWith('/studio') ? 'active' : '')}
            >
              <Icon name="studio" />
              {t('Author Studio')}
              <Icon name="arrow" size={16} />
            </Link>
          </>
        )}
        <div className="sidebar-bottom">
          <p>
            {t('Âm nhạc do cộng đồng chia sẻ.')}
            <br />
            {t('Một không gian để lắng nghe.')}
          </p>
          <Link href="/settings">
            <Icon name="settings" size={18} />
            {t('Cài đặt')}
          </Link>
        </div>
      </aside>
      <div className={'workspace' + (lyricsOpen ? ' lyrics-mode' : '')}>
        <header ref={header} className="topbar">
          <Link href="/" className="mobile-brand">
            InfoSound<span>.</span>
          </Link>
          <Form className="global-search" action="/search">
            <Icon name="search" />
            <label className="sr-only" htmlFor="global-query">
              {t('Tìm bài hát, nghệ sĩ, playlist hoặc lời bài hát')}
            </label>
            <input
              id="global-query"
              name="q"
              maxLength={120}
              placeholder={t('Tìm bài hát, nghệ sĩ, playlist hoặc lời bài hát…')}
              autoComplete="off"
            />
          </Form>
          <div className="topbar-actions">
            {loading ? (
              <span className="muted">{t('Đang kết nối…')}</span>
            ) : user ? (
              <>
                <Link href="/notifications" className="icon-button" aria-label={t('Thông báo')}>
                  <Icon name="bell" />
                </Link>
                <Link href="/settings" className="profile-chip">
                  <ProfileAvatar user={user} />
                  <span>{user.displayName}</span>
                </Link>
                <button
                  className="icon-button logout-button"
                  aria-label={t('Đăng xuất')}
                  onClick={() =>
                    void logout()
                      .then(() => router.push('/'))
                      .catch((e) => toast(e.message, 'error'))
                  }
                >
                  <Icon name="logout" />
                </button>
              </>
            ) : (
              <>
                <NavigationAction className="login-link" href="/login">
                  {t('Đăng nhập')}
                </NavigationAction>
                <NavigationAction href="/register">{t('Tạo tài khoản')}</NavigationAction>
              </>
            )}
            <KeyboardShortcuts
              open={shortcutsOpen}
              onOpen={openShortcuts}
              onClose={() => setShortcutsOpen(false)}
              groups={shortcutGroups}
              charactersEnabled={charactersEnabled}
              onCharactersChange={setCharactersEnabled}
            />
            <LanguageSelector />
            <ThemeSelector />
          </div>
        </header>
        <nav
          className="mobile-nav"
          hidden={lyricsOpen}
          aria-label={t('Điều hướng trên thiết bị nhỏ')}
        >
          {mobileLinks.map(([href, icon, title]) => (
            <Link
              key={href}
              href={href}
              aria-current={
                pathname === href
                  ? 'page'
                  : href === '/library' && isLibrarySubpage
                    ? 'location'
                    : undefined
              }
            >
              <Icon name={icon} size={18} />
              {title}
            </Link>
          ))}
        </nav>
        <main id={lyricsOpen ? 'page-content' : 'main-content'} hidden={lyricsOpen} tabIndex={-1}>
          {children}
        </main>
        {lyricsOpen && <LyricsScreen />}
        <footer className="page-footer" hidden={lyricsOpen}>
          <Link href="/">InfoSound</Link>
          <span>{t('Nghe theo cách của bạn.')}</span>
        </footer>
      </div>
    </>
  );
}
