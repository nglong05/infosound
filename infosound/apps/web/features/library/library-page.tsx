'use client';
import { NavigationAction } from '@/components/navigation-action';
import { useI18n } from '@/components/locale-provider';
import { useQuery } from '@tanstack/react-query';
import { api, type Track, type Artist, type Playlist } from '@/lib/api';
import {
  PageTitle,
  Loading,
  ErrorState,
  Empty,
  TrackRows,
  LikeButton,
  PlaylistCards,
} from '@/components/common';
import { FollowedArtists } from '@/components/followed-artists';

export function Library({ liked = false }: { liked?: boolean }) {
  const { t: tr } = useI18n();
  const result = useQuery({
    queryKey: ['library'],
    queryFn: () =>
      api<{ likedTracks: Track[]; followedArtists: Artist[]; playlists: Playlist[] }>('/library'),
  });
  if (result.isPending) return <Loading />;
  if (result.isError)
    return <ErrorState error={result.error} retry={() => void result.refetch()} />;
  const data = result.data;
  return (
    <>
      <PageTitle
        eyebrow={tr('BỘ SƯU TẬP CÁ NHÂN')}
        title={liked ? tr('Những giai điệu bạn yêu.') : tr('Thư viện của bạn.')}
        description={
          liked
            ? tr('Mọi bài hát bạn đã yêu thích, ở cùng một nơi.')
            : tr('Lưu lại cảm xúc. Nghe lại bất cứ khi nào bạn muốn.')
        }
        action={
          <div className="action-row">
            <NavigationAction href="/history">{tr('Lịch sử')}</NavigationAction>
            <NavigationAction href="/playlists">{tr('Tạo playlist')}</NavigationAction>
          </div>
        }
      />
      <section className="catalog-section">
        <div className="section-heading">
          <h2>{tr('Bài đã thích')}</h2>
          <span className="muted">
            {tr(data.likedTracks.length === 1 ? '1 bài hát' : '{count} bài hát', {
              count: data.likedTracks.length,
            })}
          </span>
        </div>
        {data.likedTracks.length ? (
          <TrackRows
            tracks={data.likedTracks}
            actions={(t) => <LikeButton track={{ ...t, liked: true }} />}
          />
        ) : (
          <Empty
            icon="heart"
            title={tr('Thư viện bắt đầu từ một lần yêu thích')}
            description={tr('Nhấn trái tim bên cạnh bài hát để lưu lại ở đây.')}
            action={<NavigationAction href="/search">{tr('Tìm âm nhạc của bạn')}</NavigationAction>}
          />
        )}
      </section>
      {!liked && (
        <>
          <section className="catalog-section">
            <div className="section-heading">
              <h2>{tr('Playlist của bạn')}</h2>
              <NavigationAction href="/playlists">{tr('Quản lý')}</NavigationAction>
            </div>
            {data.playlists.length ? (
              <PlaylistCards playlists={data.playlists} />
            ) : (
              <Empty
                title={tr('Chưa có playlist')}
                description={tr('Tạo một bộ sưu tập cho từng tâm trạng.')}
                icon="playlist"
                action={<NavigationAction href="/playlists">{tr('Tạo playlist')}</NavigationAction>}
              />
            )}
          </section>
          <section className="catalog-section">
            <div className="section-heading">
              <h2>{tr('Nghệ sĩ đang theo dõi')}</h2>
            </div>
            {data.followedArtists.length ? (
              <FollowedArtists artists={data.followedArtists} />
            ) : (
              <Empty
                title={tr('Kết nối với âm thanh bạn yêu')}
                description={tr(
                  'Theo dõi nghệ sĩ và bật chuông để nhận thông báo khi có bài phát hành mới.',
                )}
                icon="user"
              />
            )}
          </section>
        </>
      )}
    </>
  );
}
