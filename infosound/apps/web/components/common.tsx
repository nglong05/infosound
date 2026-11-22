'use client';
import Link from './app-navigation';
import { NavigationAction } from './navigation-action';
import { useI18n } from './locale-provider';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { api, quality, time, type Track, type Playlist } from '@/lib/api';
import { useAuth } from '@/features/auth/auth-context';
import { usePlayer } from '@/features/player/player-context';
import { useToast } from '@/shared/feedback/toast-context';
import { Icon } from './icons';
import { TrackOptions } from './track-options';
import { GenreTags } from './genre-tags';
export function PageTitle({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action}
    </div>
  );
}
export function Loading() {
  const { t: tr } = useI18n();
  return (
    <div className="loading-state" role="status" aria-live="polite">
      <div className="skeleton wide" />
      <div className="skeleton" />
      <p>{tr('Đang tải không gian âm nhạc…')}</p>
    </div>
  );
}
export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  const { t: tr } = useI18n();
  return (
    <div className="state-box error-state" role="alert">
      <Icon name="refresh" size={28} />
      <h2>{tr('Chưa thể tải nội dung')}</h2>
      <p>{tr(error instanceof Error ? error.message : 'Có lỗi xảy ra. Hãy thử lại.')}</p>
      {retry && (
        <button type="button" className="button secondary" onClick={retry}>
          {tr('Thử lại')}
        </button>
      )}
    </div>
  );
}
export function Empty({
  title = 'Chưa có nội dung',
  description = 'Những âm thanh mới sẽ xuất hiện ở đây.',
  action,
  icon = 'music',
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
  icon?: string;
}) {
  const { t: tr } = useI18n();
  return (
    <div className="state-box">
      <span className="empty-icon">
        <Icon name={icon} size={34} />
      </span>
      <h2>{tr(title)}</h2>
      <p>{tr(description)}</p>
      {action}
    </div>
  );
}
export function RequireAuth({
  children,
  author = false,
}: {
  children: ReactNode;
  author?: boolean;
}) {
  const { t: tr } = useI18n();
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  if (!user)
    return (
      <Empty
        title={tr('Không gian dành riêng cho bạn')}
        description={tr('Đăng nhập để thực hiện thao tác này.')}
        icon="lock"
        action={<NavigationAction href="/login">{tr('Đăng nhập')}</NavigationAction>}
      />
    );
  if (author && user.role !== 'AUTHOR')
    return (
      <Empty
        title={tr('Bạn không có quyền thực hiện thao tác này.')}
        description={tr('Trở về khám phá để tiếp tục hành trình âm nhạc.')}
        icon="lock"
        action={<NavigationAction href="/">{tr('Về trang chủ')}</NavigationAction>}
      />
    );
  return <>{children}</>;
}
export function Avatar({
  name,
  src,
  className = 'avatar',
}: {
  name: string;
  src?: string | null;
  className?: string;
}) {
  const { t: tr } = useI18n();
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return (
    <span className={className} role="img" aria-label={tr('Ảnh đại diện {name}', { name })}>
      {src && !failed ? (
        <img
          src={src}
          crossOrigin="anonymous"
          referrerPolicy="no-referrer"
          alt=""
          width={128}
          height={128}
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        <span aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>
      )}
    </span>
  );
}
export function Artwork({ track, large = false }: { track?: Track; large?: boolean }) {
  const { t: tr } = useI18n();
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [track?.coverUrl]);
  return (
    <div
      className={'artwork ' + (large ? 'large' : '')}
      style={
        {
          '--art-hue': String(
            ((track?.id || '').split('').reduce((n, c) => n + c.charCodeAt(0), 0) % 150) + 190,
          ),
        } as React.CSSProperties
      }
    >
      {track?.coverUrl && !failed ? (
        <img
          src={track.coverUrl}
          crossOrigin="anonymous"
          referrerPolicy="no-referrer"
          alt={tr('Ảnh bìa {title}', { title: track.title })}
          loading="lazy"
          width={large ? 320 : 240}
          height={large ? 320 : 240}
          onError={() => setFailed(true)}
        />
      ) : (
        <>
          <span className="art-orbit" />
          <span className="art-orbit second" />
          <Icon name="music" size={large ? 72 : 44} />
        </>
      )}
    </div>
  );
}
export function TrackCards({ tracks }: { tracks: Track[] }) {
  const { t: tr } = useI18n();
  const player = usePlayer();
  return (
    <div className="track-grid">
      {tracks.map((track) => (
        <article className="track-card" key={track.id}>
          <div className="card-art">
            <Link
              href={'/tracks/' + track.id}
              aria-label={tr('Xem {title}', { title: track.title })}
            >
              <Artwork track={track} />
            </Link>
            <button
              className="card-play"
              aria-label={tr('Phát {title}', { title: track.title })}
              onClick={() => void player.play(track)}
            >
              <Icon name="play" />
            </button>
            <span className="codec-label">{tr(quality(track))}</span>
          </div>
          <Link className="track-title" href={'/tracks/' + track.id}>
            {track.title}
          </Link>
          <Link href={'/artists/' + track.authorId} className="muted">
            {track.author?.displayName || tr('Nghệ sĩ')}
          </Link>
          {track.searchMatch === 'lyrics' && (
            <p className="search-lyric-match">
              <Icon name="microphone" size={14} />
              <span>{tr('Khớp lời bài hát')}</span>
            </p>
          )}
          <div className="track-card-footer">
            <div className="card-meta">
              <GenreTags
                genres={track.genres}
                legacyGenre={track.genre}
                fallback={tr('Âm nhạc độc lập')}
              />
              <span>{time(track.duration)}</span>
            </div>
            <TrackOptions track={track} />
          </div>
        </article>
      ))}
    </div>
  );
}
export function TrackRows({
  tracks,
  actions,
}: {
  tracks: Track[];
  actions?: (track: Track, index: number) => ReactNode;
}) {
  const { t: tr } = useI18n();
  const player = usePlayer();
  return (
    <div className="track-list">
      {tracks.map((t, index) => (
        <div className={'track-row ' + (t.available === false ? 'unavailable' : '')} key={t.id}>
          <span className="row-number">{String(index + 1).padStart(2, '0')}</span>
          <button
            className="row-play icon-button"
            aria-label={tr('Phát {title}', { title: t.title })}
            disabled={t.available === false}
            onClick={() => void player.play(t)}
          >
            <Icon name="play" size={18} />
          </button>
          <div className="row-art">
            <Artwork track={t} />
          </div>
          <div className="row-info">
            <Link href={'/tracks/' + t.id}>{t.title}</Link>
            <Link className="muted" href={'/artists/' + t.authorId}>
              {t.author?.displayName || tr('Nghệ sĩ')}
            </Link>
          </div>
          <span className="row-quality">
            {t.available === false ? tr('Không khả dụng') : tr(quality(t))}
          </span>
          <span className="row-time">{time(t.duration)}</span>
          {actions?.(t, index)}
          <TrackOptions track={t} />
        </div>
      ))}
    </div>
  );
}
export function LikeButton({ track }: { track: Track }) {
  const { t: tr } = useI18n();
  const { user } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => api(`/tracks/${track.id}/like`, { method: track.liked ? 'DELETE' : 'PUT' }),
    onSuccess: () => {
      void queryClient.invalidateQueries();
      toast(track.liked ? 'Đã bỏ thích bài hát.' : 'Đã lưu vào bài đã thích.');
    },
    onError: (e) => toast(e.message, 'error'),
  });
  return user ? (
    <button
      className={'button secondary ' + (track.liked ? 'selected' : '')}
      disabled={mutation.isPending}
      aria-pressed={!!track.liked}
      onClick={() => mutation.mutate()}
    >
      <Icon name="heart" />
      {track.liked ? tr('Đã thích') : tr('Yêu thích')}
      {typeof track.likeCount === 'number' && <span>{track.likeCount}</span>}
    </button>
  ) : (
    <Link className="button secondary" href="/login">
      <Icon name="heart" />
      {tr('Yêu thích')}
    </Link>
  );
}
export function PlaylistCards({ playlists }: { playlists: Playlist[] }) {
  const { t: tr } = useI18n();
  return (
    <div className="playlist-grid">
      {playlists.map((p) => (
        <Link className="playlist-card" href={'/playlists/' + p.id} key={p.id}>
          <div className="playlist-art">
            <Icon name="playlist" size={40} />
            <span>{p.isPublic ? tr('CÔNG KHAI') : tr('RIÊNG TƯ')}</span>
          </div>
          <h2>{p.title}</h2>
          <p>{p.description || tr('Bộ sưu tập âm nhạc của bạn')}</p>
          <span className="muted">
            {tr((p.trackCount ?? p.tracks?.length ?? 0) === 1 ? '1 bài hát' : '{count} bài hát', {
              count: p.trackCount ?? p.tracks?.length ?? 0,
            })}
            <Icon name="arrow" size={18} />
          </span>
        </Link>
      ))}
    </div>
  );
}
