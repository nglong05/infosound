'use client';
import Link from './app-navigation';
import { NavigationAction } from './navigation-action';
import { useEffect, useId, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Artist, type List } from '@/lib/api';
import { getLanguage } from '@/lib/languages';
import { Artwork, Avatar, Empty, ErrorState, Loading } from './common';
import { Icon } from './icons';
import { TrackOptions } from './track-options';
import { useI18n } from './locale-provider';
import { useAuth, usePlayer, useToast } from './providers';

export function TrendingArtistsSection() {
  const { t: tr } = useI18n();
  const { user, loading } = useAuth();
  return (
    <section className="catalog-section trending-artists" aria-labelledby="home-artists-title">
      <div className="section-heading">
        <h2 id="home-artists-title">{tr('Nghệ sĩ thịnh hành')}</h2>
        <NavigationAction href="/artists">{tr('Khám phá')}</NavigationAction>
      </div>
      {loading ? <Loading /> : <TrendingArtists key={user?.id ?? 'visitor'} userId={user?.id} />}
    </section>
  );
}

function TrendingArtists({ userId }: { userId?: string }) {
  const { t: tr } = useI18n();
  const artists = useQuery({
    queryKey: ['artists', 'popular', 'home', 'spotlight', userId ?? 'visitor'],
    queryFn: ({ signal }) =>
      api<List<Artist>>('/artists?sort=popular&pageSize=5&include=spotlight', {
        auth: false,
        signal,
      }),
  });
  if (artists.isPending) return <Loading />;
  if (artists.isError)
    return <ErrorState error={artists.error} retry={() => void artists.refetch()} />;
  if (!artists.data.items.length)
    return (
      <Empty
        title={tr('Gặp gỡ những nghệ sĩ tiếp theo')}
        description={tr('Hồ sơ nghệ sĩ sẽ xuất hiện khi cộng đồng bắt đầu chia sẻ âm nhạc.')}
        icon="user"
      />
    );
  return (
    <div className="trending-artist-grid">
      {artists.data.items.slice(0, 5).map((artist) => (
        <TrendingArtistCard key={artist.id} artist={artist} userId={userId} />
      ))}
    </div>
  );
}

export function TrendingArtistCard({
  artist,
  userId,
  relationKnown = true,
  detailsPending = false,
  detailsError = false,
  onRetry,
}: {
  artist: Artist;
  userId?: string;
  relationKnown?: boolean;
  detailsPending?: boolean;
  detailsError?: boolean;
  onRetry?: () => void;
}) {
  const { t: tr, locale } = useI18n();
  const player = usePlayer();
  const id = useId(),
    nameId = id + '-name',
    actionId = id + '-follow';
  const count = artist.followerCount;
  const followers =
    typeof count === 'number'
      ? tr(count === 1 ? '1 người theo dõi' : '{count} người theo dõi', {
          count: new Intl.NumberFormat(getLanguage(locale).tag).format(count),
        })
      : '';
  const track = artist.topTrack;
  return (
    <article className="trending-artist-card" aria-labelledby={nameId}>
      <div className="trending-artist-portrait">
        <Link
          className="trending-artist-photo-link"
          href={'/artists/' + artist.id}
          tabIndex={-1}
          aria-hidden="true"
        >
          <Avatar
            name={artist.displayName}
            src={artist.avatarUrl}
            className="trending-artist-avatar"
          />
        </Link>
        <div className="trending-artist-caption">
          <h3>
            <Link id={nameId} href={'/artists/' + artist.id} dir="auto" title={artist.displayName}>
              {artist.displayName}
            </Link>
          </h3>
          <div className="trending-artist-social">
            <span className="trending-artist-followers" title={followers}>
              {followers}
            </span>
            <FollowArtistButton
              artist={artist}
              userId={userId}
              nameId={nameId}
              actionId={actionId}
              relationKnown={relationKnown}
            />
          </div>
        </div>
      </div>
      {detailsPending ? (
        <p className="trending-artist-no-song">{tr('Đang tải…')}</p>
      ) : detailsError ? (
        <div className="trending-artist-no-song">
          <button
            type="button"
            className="text-action"
            aria-label={tr('Thử lại') + ' — ' + artist.displayName}
            onClick={onRetry}
          >
            <Icon name="refresh" size={16} />
            {tr('Thử lại')}
          </button>
        </div>
      ) : track ? (
        <div className="trending-artist-song">
          <button
            type="button"
            className="trending-song-play"
            aria-label={tr('Phát {title}', { title: track.title })}
            disabled={track.available === false}
            onClick={() => void player.play(track)}
          >
            <Artwork track={track} />
            <span className="trending-song-play-icon">
              <Icon name="play" size={18} />
            </span>
          </button>
          <div className="trending-song-info">
            <Link
              className="trending-song-title"
              href={'/tracks/' + track.id}
              dir="auto"
              title={track.title}
            >
              {track.title}
            </Link>
            <Link
              className="trending-song-author"
              href={'/artists/' + track.authorId}
              dir="auto"
              title={track.author?.displayName || artist.displayName}
            >
              {track.author?.displayName || artist.displayName}
            </Link>
          </div>
          <TrackOptions track={track} />
        </div>
      ) : (
        <p className="trending-artist-no-song">{tr('Chưa có bài hát công khai')}</p>
      )}
    </article>
  );
}

function FollowArtistButton({
  artist,
  userId,
  nameId,
  actionId,
  relationKnown,
}: {
  artist: Artist;
  userId?: string;
  nameId: string;
  actionId: string;
  relationKnown: boolean;
}) {
  const { t: tr } = useI18n();
  const queryClient = useQueryClient(),
    toast = useToast();
  const [pending, setPending] = useState(false);
  const alive = useRef(true),
    busy = useRef(false),
    request = useRef<AbortController | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      request.current?.abort();
    };
  }, []);
  const follow = async () => {
    if (!userId || userId === artist.id || !relationKnown || busy.current) return;
    busy.current = true;
    setPending(true);
    const controller = new AbortController();
    request.current = controller;
    try {
      await api('/artists/' + artist.id + '/follow', {
        method: artist.following ? 'DELETE' : 'PUT',
        body: {},
        signal: controller.signal,
      });
      if (!alive.current || controller.signal.aborted) return;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['artists'] }),
        queryClient.invalidateQueries({ queryKey: ['artist', artist.id] }),
        queryClient.invalidateQueries({ queryKey: ['profile', artist.id] }),
        queryClient.invalidateQueries({ queryKey: ['library'] }),
      ]);
      if (alive.current && !controller.signal.aborted) toast('Đã cập nhật theo dõi nghệ sĩ.');
    } catch (error) {
      if (alive.current && !controller.signal.aborted)
        toast(error instanceof Error ? error.message : 'Có lỗi xảy ra. Hãy thử lại.', 'error');
    } finally {
      if (request.current === controller) {
        request.current = null;
        busy.current = false;
        if (alive.current) setPending(false);
      }
    }
  };
  if (!userId)
    return (
      <Link
        className="trending-artist-follow"
        href="/login"
        aria-label={tr('Đăng nhập để theo dõi')}
      >
        <span>{tr('Theo dõi')}</span>
      </Link>
    );
  return (
    <button
      type="button"
      className={'trending-artist-follow' + (artist.following ? ' is-following' : '')}
      aria-labelledby={actionId + ' ' + nameId}
      aria-pressed={relationKnown ? !!artist.following : undefined}
      aria-busy={pending}
      disabled={pending || !relationKnown || userId === artist.id}
      onClick={() => void follow()}
    >
      <span id={actionId}>{tr(artist.following ? 'Đang theo dõi' : 'Theo dõi')}</span>
    </button>
  );
}
