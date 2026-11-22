'use client';
import { usePathname } from 'next/navigation';
import { NavigationAction } from '@/components/navigation-action';
import { useI18n } from '@/components/locale-provider';
import { Empty, RequireAuth } from '@/components/common';
import { AuthScreen } from '@/components/auth-screens';
import { OAuthComplete } from '@/components/oauth-signin';
import { StudioScreen } from '@/components/studio-screens';
import { CatalogPage } from '@/components/discovery-catalog';
import { HistoryPage } from '@/components/history';
import { ArtistCatalogPage } from '@/components/artist-catalog';
import { TrackDetail } from '@/components/track-detail';
import { CommentModerationPage } from './comment-moderation';
import { ArtistDetail } from '@/features/artists/artist-detail';
import { Search } from '@/features/search/search-page';
import { Library } from '@/features/library/library-page';
import { PlaylistDetail } from '@/features/playlists/playlist-detail';
import { Playlists } from '@/features/playlists/playlists-page';
import { Notifications } from '@/features/notifications/notifications-page';
import { Settings } from '@/features/settings/settings-page';
import { Home } from '@/features/discovery/home-page';

export function Screen() {
  const pathname = usePathname();
  return <RouteScreen key={pathname} pathname={pathname} />;
}

function RouteScreen({ pathname }: { pathname: string }) {
  const { t: tr } = useI18n();
  const path = pathname.split('/').filter(Boolean);
  if (path[0] === 'oauth' && path[1] === 'complete') return <OAuthComplete />;
  if (['login', 'register', 'verify-email', 'forgot-password', 'reset-password'].includes(path[0]))
    return <AuthScreen key={path[0]} mode={path[0]} />;
  if (path[0] === 'admin' && path[1] === 'moderation')
    return (
      <RequireAuth>
        <CommentModerationPage />
      </RequireAuth>
    );
  if (path[0] === 'studio')
    return (
      <RequireAuth author>
        <StudioScreen id={path[1] === 'tracks' ? path[2] : undefined} />
      </RequireAuth>
    );
  if (path[0] === 'tracks' && path[1]) return <TrackDetail id={path[1]} />;
  if ((path[0] === 'artists' || path[0] === 'profile' || path[0] === 'profiles') && path[1])
    return <ArtistDetail id={path[1]} profile={path[0] !== 'artists'} />;
  if (path[0] === 'artists') return <ArtistCatalogPage />;
  if (path[0] === 'search') return <Search />;
  if (path[0] === 'charts') return <CatalogPage popular />;
  if (path[0] === 'new-releases') return <CatalogPage />;
  if (path[0] === 'history') return <HistoryPage />;
  if (path[0] === 'library')
    return (
      <RequireAuth>
        <Library liked={path[1] === 'liked'} />
      </RequireAuth>
    );
  if (path[0] === 'playlists')
    return path[1] ? (
      <PlaylistDetail id={path[1]} />
    ) : (
      <RequireAuth>
        <Playlists />
      </RequireAuth>
    );
  if (path[0] === 'notifications')
    return (
      <RequireAuth>
        <Notifications />
      </RequireAuth>
    );
  if (path[0] === 'settings')
    return (
      <RequireAuth>
        <Settings />
      </RequireAuth>
    );
  if (!path.length) return <Home />;
  return (
    <Empty
      title={tr('Trang này không tồn tại')}
      description={tr('Trở về khám phá để tiếp tục hành trình âm nhạc.')}
      action={<NavigationAction href="/">{tr('Về trang chủ')}</NavigationAction>}
    />
  );
}
