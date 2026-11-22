'use client';
import Link from './app-navigation';
import { NavigationAction, NavigationActionButton } from './navigation-action';
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, time, type List, type Playlist, type Track } from '@/lib/api';
import type {
  CommentMarkers,
  CommentPage,
  TrackComment,
  TrackCommunity,
  TrackWaveform,
} from '@/lib/track-community';
import { getLanguage } from '@/lib/languages';
import { Artwork, Avatar, ErrorState, LikeButton, Loading } from './common';
import { GenreTags } from './genre-tags';
import { Icon } from './icons';
import { TrackOptions } from './track-options';
import { useI18n } from './locale-provider';
import { useAuth, usePlayer, useToast } from './providers';
import {
  CommentModerationScope,
  CommentOwnerMenu,
  useCommentModerationRefresh,
  moderationSubmissionMessage,
} from './comment-moderation';

function useGuardedAction() {
  const [pending, setPending] = useState(false);
  const alive = useRef(true),
    busy = useRef(false),
    controller = useRef<AbortController | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      controller.current?.abort();
    };
  }, []);
  const run = async (action: (signal: AbortSignal) => Promise<void>) => {
    if (busy.current) return;
    const request = new AbortController();
    controller.current = request;
    busy.current = true;
    setPending(true);
    try {
      await action(request.signal);
    } finally {
      if (controller.current === request) {
        controller.current = null;
        busy.current = false;
        if (alive.current) setPending(false);
      }
    }
  };
  return { pending, run };
}

export function TrackDetail({ id }: { id: string }) {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  return <TrackDetailQuery key={id + ':' + (user?.id ?? 'visitor')} id={id} userId={user?.id} />;
}
function TrackDetailQuery({ id, userId }: { id: string; userId?: string }) {
  const result = useQuery({
    queryKey: ['track', id, userId ?? 'visitor'],
    queryFn: ({ signal }) => api<Track>('/tracks/' + id, { signal, auth: false }),
  });
  if (result.isPending) return <Loading />;
  if (result.isError)
    return <ErrorState error={result.error} retry={() => void result.refetch()} />;
  return <TrackDetailContent track={result.data} userId={userId} />;
}

function TrackDetailContent({ track, userId }: { track: Track; userId?: string }) {
  const { t: tr } = useI18n();
  const player = usePlayer();
  const commentsRef = useRef<HTMLElement>(null),
    composerRef = useRef<HTMLTextAreaElement>(null);
  const [playlistOpen, setPlaylistOpen] = useState(false);
  const [replyTarget, setReplyTarget] = useState<TrackComment | null>(null);
  const active =
    player.track?.id === track.id && player.track.sourceVersion === track.sourceVersion;
  const community = useQuery({
    queryKey: ['track-community', track.id, track.sourceVersion, userId ?? 'visitor'],
    queryFn: ({ signal }) =>
      api<TrackCommunity>('/tracks/' + track.id + '/community', { signal, auth: false }),
  });
  const waveform = useQuery({
    queryKey: ['track-waveform', track.id, track.sourceVersion, userId ?? 'visitor'],
    queryFn: ({ signal }) =>
      api<TrackWaveform>('/tracks/' + track.id + '/waveform', { signal, auth: false }),
    refetchInterval: (query) =>
      query.state.data?.status === 'PENDING' && query.state.dataUpdateCount < 12 ? 3000 : false,
  });
  const markers = useQuery({
    queryKey: ['track-comments', 'markers', track.id, track.sourceVersion, userId ?? 'visitor'],
    queryFn: ({ signal }) =>
      api<CommentMarkers>('/tracks/' + track.id + '/comments/markers', { signal, auth: false }),
  });
  const markerItems =
    markers.data && markers.data.sourceVersion === track.sourceVersion ? markers.data.items : [];
  const jump = (seconds: number) => void player.playAt(track, seconds);
  const showComments = (comment?: TrackComment) => {
    if (comment) setReplyTarget(comment);
    commentsRef.current?.scrollIntoView({
      behavior: player.motionEnabled ? 'smooth' : 'auto',
      block: 'start',
    });
    if (!comment) composerRef.current?.focus({ preventScroll: true });
  };
  const canPlay = track.available !== false;
  return (
    <div className="sound-track-detail">
      <section className="sound-track-hero" aria-labelledby="sound-track-title">
        <div className="sound-track-main">
          <div className="sound-track-heading">
            <button
              type="button"
              className="sound-track-play"
              aria-label={tr(active && player.playing ? 'Tạm dừng' : 'Phát {title}', {
                title: track.title,
              })}
              disabled={player.pending || !canPlay}
              onClick={() => (active ? player.toggle() : void player.play(track))}
            >
              <Icon name={active && player.playing ? 'pause' : 'play'} size={30} />
            </button>
            <div>
              <h1 id="sound-track-title" dir="auto">
                {track.title}
              </h1>
              <Link className="sound-track-byline" href={'/artists/' + track.authorId} dir="auto">
                {track.author.displayName}
              </Link>
            </div>
          </div>
          <TrackWaveformView
            track={track}
            data={waveform.data}
            loading={waveform.isPending}
            error={waveform.isError}
            retry={() => void waveform.refetch()}
            comments={markerItems}
            current={active ? player.current : 0}
            playing={active && player.playing}
            pending={player.pending}
            onSeek={jump}
            onComments={showComments}
            userId={userId}
          />
          <div className="sound-track-actions">
            <LikeButton track={track} />
            <button
              type="button"
              className="button secondary"
              onClick={() => setPlaylistOpen((v) => !v)}
              disabled={!userId}
              aria-expanded={playlistOpen}
            >
              <Icon name="plus" />
              {tr('Thêm vào playlist')}
            </button>
            <DownloadTrack track={track} userId={userId} />
            <button
              type="button"
              className="button secondary sound-open-comments"
              onClick={() => showComments()}
            >
              <CommentIcon />
              {tr('Bình luận')}
            </button>
            <TrackOptions track={track} />
          </div>
          {!userId && (
            <p className="sound-track-login">
              <NavigationAction href="/login">{tr('Đăng nhập')}</NavigationAction>
            </p>
          )}
        </div>
        <div className="sound-track-cover">
          <Artwork track={track} large />
        </div>
      </section>
      {playlistOpen && (
        <PlaylistPicker track={track} userId={userId} onClose={() => setPlaylistOpen(false)} />
      )}
      <div className="sound-track-columns">
        <div className="sound-track-discussion">
          <section className="sound-track-description">
            <h2 className="sound-section-label">{tr('Về bài hát')}</h2>
            <p dir="auto">
              {track.description || tr('Nghệ sĩ chưa thêm lời giới thiệu cho bài hát này.')}
            </p>
          </section>
          <section className="sound-track-comments" ref={commentsRef} aria-label={tr('Bình luận')}>
            <TrackComments
              track={track}
              userId={userId}
              current={active ? player.current : 0}
              composerRef={composerRef}
              onSeek={jump}
              replyTarget={replyTarget}
              onClearReply={() => setReplyTarget(null)}
            />
          </section>
        </div>
        <aside className="sound-track-sidebar" aria-label={tr('Nghệ sĩ')}>
          {community.isPending ? (
            <Loading />
          ) : community.isError ? (
            <ErrorState error={community.error} retry={() => void community.refetch()} />
          ) : community.data.sourceVersion === track.sourceVersion ? (
            <CommunitySidebar data={community.data} track={track} userId={userId} />
          ) : null}
          <section className="sound-track-tags">
            <h2 className="sound-section-label">{tr('Tag bài hát')}</h2>
            <GenreTags
              genres={track.genres}
              legacyGenre={track.genre}
              fallback={tr('Âm nhạc độc lập')}
            />
          </section>
        </aside>
      </div>
    </div>
  );
}

function CommentIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 11a8 8 0 0 1-8 8H8l-5 3V11a9 9 0 0 1 18 0Z" />
    </svg>
  );
}

function TrackWaveformView({
  track,
  data,
  loading,
  error,
  retry,
  comments,
  current,
  playing,
  pending,
  onSeek,
  onComments,
  userId,
}: {
  track: Track;
  data?: TrackWaveform;
  loading: boolean;
  error: boolean;
  retry: () => void;
  comments: TrackComment[];
  current: number;
  playing: boolean;
  pending: boolean;
  onSeek: (seconds: number) => void;
  onComments: (comment?: TrackComment) => void;
  userId?: string;
}) {
  const { t: tr } = useI18n();
  const clip = useId().replace(/:/g, '');
  const [hovered, setHovered] = useState<string | null>(null),
    [dismissed, setDismissed] = useState<string | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showMarker = (id: string) => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    setHovered(id);
  };
  const leaveMarker = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setHovered(null), 220);
  };
  useEffect(
    () => () => {
      if (hoverTimer.current) clearTimeout(hoverTimer.current);
    },
    [],
  );
  const valid =
    !!data &&
    data.trackId === track.id &&
    data.sourceVersion === track.sourceVersion &&
    data.status === 'READY' &&
    Array.isArray(data.peaks) &&
    data.peaks.length === 512 &&
    data.peaks.every((v) => Number.isFinite(v) && v >= 0 && v <= 1) &&
    Number.isFinite(data.duration) &&
    data.duration! > 0;
  const duration = valid ? data.duration! : (track.duration ?? 0);
  const fraction = duration > 0 ? Math.max(0, Math.min(1, current / duration)) : 0;
  const automatic = playing
    ? comments
        .filter(
          (c) =>
            c.sourceVersion === track.sourceVersion &&
            c.atSeconds <= current &&
            current - c.atSeconds < 1,
        )
        .sort((a, b) => b.atSeconds - a.atSeconds || a.id.localeCompare(b.id))[0]
    : undefined;
  useEffect(() => setDismissed(null), [automatic?.id]);
  const selected =
    comments.find((c) => c.id === hovered) ?? (automatic?.id !== dismissed ? automatic : undefined);
  const visibleMarkers = useMemo(() => {
    if (!duration) return [];
    const buckets = new Map<number, TrackComment>();
    for (const comment of comments) {
      if (
        comment.sourceVersion !== track.sourceVersion ||
        !Number.isFinite(comment.atSeconds) ||
        comment.atSeconds < 0 ||
        comment.atSeconds > duration
      )
        continue;
      const bucket = Math.min(63, Math.floor((comment.atSeconds / duration) * 64));
      if (!buckets.has(bucket)) buckets.set(bucket, comment);
    }
    if (
      selected &&
      selected.sourceVersion === track.sourceVersion &&
      Number.isFinite(selected.atSeconds) &&
      selected.atSeconds >= 0 &&
      selected.atSeconds <= duration
    )
      buckets.set(Math.min(63, Math.floor((selected.atSeconds / duration) * 64)), selected);
    return [...buckets.values()].sort(
      (a, b) => a.atSeconds - b.atSeconds || a.id.localeCompare(b.id),
    );
  }, [comments, duration, track.sourceVersion, selected]);
  const seekKey = (event: KeyboardEvent<HTMLDivElement>) => {
    let next: number | undefined;
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = current + 5;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = current - 5;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = duration;
    if (next !== undefined) {
      event.preventDefault();
      if (valid && !pending) onSeek(Math.min(duration, Math.max(0, next)));
    }
  };
  return (
    <div className="sound-waveform-block">
      <div
        className={'sound-waveform ' + (!valid ? 'is-unavailable' : '')}
        dir="ltr"
        role={valid ? 'slider' : undefined}
        tabIndex={valid ? 0 : undefined}
        aria-label={tr('Dạng sóng âm thanh')}
        aria-valuemin={valid ? 0 : undefined}
        aria-valuemax={valid ? duration : undefined}
        aria-valuenow={valid ? Math.min(current, duration) : undefined}
        aria-valuetext={valid ? time(current) + ' / ' + time(duration) : undefined}
        aria-disabled={valid ? pending : undefined}
        onKeyDown={seekKey}
        onClick={(event) => {
          if (!valid || pending) return;
          const bounds = (
            event.currentTarget.querySelector('svg') ?? event.currentTarget
          ).getBoundingClientRect();
          onSeek(Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)) * duration);
        }}
      >
        {valid ? (
          <svg
            className="sound-waveform-bars"
            viewBox="0 0 1024 160"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <defs>
              <clipPath id={'sound-wave-' + clip}>
                <rect width={fraction * 1024} height="160" />
              </clipPath>
            </defs>
            <g className="sound-wave-unplayed">
              {data!.peaks!.map((peak, index) => (
                <rect
                  key={index}
                  x={index * 2}
                  y={80 - Math.max(1, peak * 72)}
                  width="1.35"
                  height={Math.max(2, peak * 144)}
                />
              ))}
            </g>
            <g className="sound-wave-played" clipPath={'url(#sound-wave-' + clip + ')'}>
              {data!.peaks!.map((peak, index) => (
                <rect
                  key={index}
                  x={index * 2}
                  y={80 - Math.max(1, peak * 72)}
                  width="1.35"
                  height={Math.max(2, peak * 144)}
                />
              ))}
            </g>
            <path d="M0 80H1024" className="sound-wave-axis" />
          </svg>
        ) : (
          <div className="sound-waveform-status" role="status">
            <span>
              {tr(
                error
                  ? 'Dạng sóng chưa khả dụng.'
                  : loading || data?.status === 'PENDING'
                    ? 'Đang chuẩn bị dạng sóng…'
                    : 'Dạng sóng chưa khả dụng.',
              )}
            </span>
            {!loading && (
              <button
                type="button"
                className="text-action"
                onClick={(event) => {
                  event.stopPropagation();
                  retry();
                }}
              >
                {tr('Thử lại')}
              </button>
            )}
          </div>
        )}
        <div className="sound-waveform-clock" aria-hidden="true">
          <span>{time(current)}</span>
          <span>{time(duration)}</span>
        </div>
      </div>
      {valid && visibleMarkers.length > 0 && (
        <div
          className="sound-waveform-markers"
          aria-label={tr('Bình luận trên dạng sóng')}
          dir="ltr"
        >
          {visibleMarkers.map((comment) => (
            <button
              key={comment.id}
              type="button"
              className={'sound-wave-marker ' + (selected?.id === comment.id ? 'is-active' : '')}
              style={{
                left: Math.max(1, Math.min(99, (comment.atSeconds / duration) * 100)) + '%',
              }}
              aria-label={
                tr('Bình luận tại {time}', { time: time(comment.atSeconds) }) +
                ' · ' +
                comment.user.displayName
              }
              onMouseEnter={() => showMarker(comment.id)}
              onMouseLeave={leaveMarker}
              onFocus={() => showMarker(comment.id)}
              onBlur={(event) => {
                if (
                  !event.currentTarget.parentElement?.parentElement?.contains(
                    event.relatedTarget as Node,
                  )
                )
                  setHovered(null);
              }}
              onClick={() => {
                showMarker(comment.id);
                if (!pending) onSeek(comment.atSeconds);
              }}
            >
              <Avatar name={comment.user.displayName} src={comment.user.avatarUrl} />
            </button>
          ))}
        </div>
      )}
      <div className="sound-waveform-comment-space">
        {selected && (
          <div
            className="sound-waveform-comment"
            onMouseEnter={() => showMarker(selected.id)}
            onMouseLeave={leaveMarker}
          >
            <div>
              <strong dir="auto">{selected.user.displayName}</strong>
              <span dir="auto">{selected.body}</span>
            </div>
            <div className="sound-wave-comment-actions">
              {userId ? (
                <button type="button" className="text-action" onClick={() => onComments(selected)}>
                  {tr('Trả lời')}
                </button>
              ) : (
                <Link className="text-action" href="/login">
                  {tr('Trả lời')}
                </Link>
              )}
              <CommentHeart comment={selected} trackId={track.id} userId={userId} />
              <button
                type="button"
                className="icon-button"
                aria-label={tr('Đóng bình luận trên dạng sóng')}
                onClick={() => {
                  setDismissed(selected.id);
                  setHovered(null);
                }}
              >
                <Icon name="close" size={14} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function DownloadTrack({ track, userId }: { track: Track; userId?: string }) {
  const { t: tr } = useI18n();
  const toast = useToast();
  const action = useGuardedAction();
  const download = () =>
    action.run(async (signal) => {
      try {
        const data = await api<{ url: string }>('/tracks/' + track.id + '/download', { signal });
        if (signal.aborted) return;
        const response = await fetch(data.url, { credentials: 'omit', mode: 'cors', signal });
        if (!response.ok) throw new Error(tr('Không thể tải tệp. Vui lòng thử lại.'));
        const blob = await response.blob();
        if (signal.aborted) return;
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = track.title + '.' + (track.outputCodec || 'audio');
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        toast('Đã tải bài hát.');
      } catch (error) {
        if (!signal.aborted)
          toast(error instanceof Error ? error.message : 'Có lỗi xảy ra. Hãy thử lại.', 'error');
      }
    });
  return (
    <button
      type="button"
      className="button secondary"
      disabled={action.pending || !userId || !track.downloadEnabled}
      onClick={() => void download()}
    >
      <Icon name="download" />
      {tr(action.pending ? 'Đang tải…' : 'Tải xuống')}
    </button>
  );
}

function PlaylistPicker({
  track,
  userId,
  onClose,
}: {
  track: Track;
  userId?: string;
  onClose: () => void;
}) {
  const { t: tr } = useI18n();
  const toast = useToast();
  const action = useGuardedAction();
  const heading = useRef<HTMLHeadingElement>(null);
  const lists = useQuery({
    queryKey: ['playlists', 'track-picker', userId ?? 'visitor'],
    queryFn: ({ signal }) => api<List<Playlist>>('/playlists', { signal }),
    enabled: !!userId,
  });
  useEffect(() => heading.current?.focus(), []);
  const add = (playlist: Playlist) =>
    action.run(async (signal) => {
      try {
        await api(`/playlists/${playlist.id}/tracks/${track.id}`, {
          method: 'PUT',
          body: {},
          signal,
        });
        if (!signal.aborted) {
          toast(tr('Đã thêm vào {title}', { title: playlist.title }));
          onClose();
        }
      } catch (error) {
        if (!signal.aborted)
          toast(error instanceof Error ? error.message : 'Có lỗi xảy ra. Hãy thử lại.', 'error');
      }
    });
  return (
    <section className="sound-playlist-picker surface compact">
      <div className="section-heading">
        <h2 ref={heading} tabIndex={-1}>
          {tr('Thêm vào playlist của bạn')}
        </h2>
        <button
          type="button"
          className="icon-button"
          onClick={onClose}
          aria-label={tr('Đóng chọn playlist')}
        >
          <Icon name="close" />
        </button>
      </div>
      {lists.isPending ? (
        <Loading />
      ) : lists.isError ? (
        <ErrorState error={lists.error} retry={() => void lists.refetch()} />
      ) : lists.data.items.length ? (
        <div className="action-row">
          {lists.data.items.map((playlist) => (
            <button
              key={playlist.id}
              type="button"
              className="button secondary"
              disabled={action.pending}
              onClick={() => void add(playlist)}
            >
              <Icon name="playlist" />
              {playlist.title}
            </button>
          ))}
        </div>
      ) : (
        <NavigationAction href="/playlists">{tr('Tạo playlist đầu tiên')}</NavigationAction>
      )}
    </section>
  );
}

function CommunitySidebar({
  data,
  track,
  userId,
}: {
  data: TrackCommunity;
  track: Track;
  userId?: string;
}) {
  const { t: tr, locale } = useI18n();
  const player = usePlayer();
  const formatter = new Intl.NumberFormat(getLanguage(locale).tag);
  const artist = data.artist;
  return (
    <>
      <section className="sound-artist-panel">
        <div className="sound-artist-summary">
          <Link href={'/artists/' + artist.id}>
            <Avatar name={artist.displayName} src={artist.avatarUrl} />
          </Link>
          <div>
            <Link className="sound-artist-name" href={'/artists/' + artist.id} dir="auto">
              {artist.displayName}
            </Link>
            <p className="sound-artist-bio" dir="auto">
              {artist.bio || tr('Nghệ sĩ trên InfoSound')}
            </p>
            <p className="sound-artist-counts">
              {tr('{count} người theo dõi', { count: formatter.format(artist.followerCount) })} ·{' '}
              {tr('{count} bài hát', { count: formatter.format(artist.trackCount) })}
            </p>
          </div>
        </div>
        <ArtistFollow artist={artist} trackId={track.id} userId={userId} />
      </section>
      <div className="sound-artist-stats">
        <div>
          <strong>{formatter.format(artist.playCount)}</strong>
          <span>{tr('Lượt nghe')}</span>
        </div>
        <div>
          <strong>{formatter.format(artist.likeCount)}</strong>
          <span>{tr('Lượt yêu thích')}</span>
        </div>
        <div>
          <strong>{formatter.format(artist.trackCount)}</strong>
          <span>{tr('Bài hát')}</span>
        </div>
      </div>
      <section className="sound-track-fans">
        <h2 className="sound-section-label">{tr('Người hâm mộ')}</h2>
        <p className="sound-sidebar-caption">{tr('Những người nghe bài hát này nhiều nhất')}</p>
        {data.fans.items.length ? (
          <ol>
            {data.fans.items.slice(0, 3).map((fan, index) => (
              <li key={fan.user.id}>
                <span className="sound-fan-rank">{formatter.format(index + 1)}</span>
                <Link className="sound-fan-person" href={'/profiles/' + fan.user.id}>
                  <Avatar name={fan.user.displayName} src={fan.user.avatarUrl} />
                  <span dir="auto" title={fan.user.displayName}>
                    {fan.user.displayName}
                  </span>
                </Link>
                <span className="sound-fan-plays">
                  {tr('{count} lượt nghe', { count: formatter.format(fan.playCount) })}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="sound-sidebar-empty">{tr('Chưa có người nghe được ghi nhận.')}</p>
        )}
      </section>
      <section className="sound-related">
        <div className="sound-section-label">
          <h2>{tr('Giai điệu liên quan')}</h2>
          <NavigationAction href={'/artists/' + artist.id}>{tr('Xem tất cả')}</NavigationAction>
        </div>
        {data.relatedTracks.length ? (
          <div className="sound-related-list">
            {data.relatedTracks.slice(0, 3).map((song) => (
              <article key={song.id} className="sound-related-song">
                <button
                  type="button"
                  className="sound-related-play"
                  disabled={player.pending || song.available === false}
                  aria-label={tr('Phát {title}', { title: song.title })}
                  onClick={() => void player.play(song)}
                >
                  <Artwork track={song} />
                  <span>
                    <Icon name="play" size={18} />
                  </span>
                </button>
                <div>
                  <Link
                    className="sound-related-title"
                    href={'/tracks/' + song.id}
                    dir="auto"
                    title={song.title}
                  >
                    {song.title}
                  </Link>
                  <Link
                    className="sound-related-author"
                    href={'/artists/' + song.authorId}
                    dir="auto"
                  >
                    {song.author.displayName}
                  </Link>
                </div>
                <TrackOptions track={song} />
              </article>
            ))}
          </div>
        ) : (
          <p className="sound-sidebar-empty">
            {tr('Các bài hát khác của nghệ sĩ này sẽ xuất hiện tại đây.')}
          </p>
        )}
      </section>
    </>
  );
}

function ArtistFollow({
  artist,
  trackId,
  userId,
}: {
  artist: TrackCommunity['artist'];
  trackId: string;
  userId?: string;
}) {
  const { t: tr } = useI18n();
  const queryClient = useQueryClient(),
    toast = useToast();
  const action = useGuardedAction();
  if (!userId)
    return (
      <Link className="button sound-follow-button" href="/login">
        {tr('Theo dõi')}
      </Link>
    );
  const follow = () =>
    action.run(async (signal) => {
      try {
        await api('/artists/' + artist.id + '/follow', {
          method: artist.following ? 'DELETE' : 'PUT',
          body: {},
          signal,
        });
        if (signal.aborted) return;
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['track-community', trackId] }),
          queryClient.invalidateQueries({ queryKey: ['artists'] }),
          queryClient.invalidateQueries({ queryKey: ['artist', artist.id] }),
          queryClient.invalidateQueries({ queryKey: ['profile', artist.id] }),
          queryClient.invalidateQueries({ queryKey: ['library'] }),
        ]);
        if (!signal.aborted) toast('Đã cập nhật theo dõi nghệ sĩ.');
      } catch (error) {
        if (!signal.aborted)
          toast(error instanceof Error ? error.message : 'Có lỗi xảy ra. Hãy thử lại.', 'error');
      }
    });
  return (
    <button
      type="button"
      className={'button sound-follow-button ' + (artist.following ? 'is-following' : '')}
      aria-pressed={artist.following}
      disabled={action.pending || userId === artist.id}
      onClick={() => void follow()}
    >
      {tr(artist.following ? 'Đang theo dõi' : 'Theo dõi')}
    </button>
  );
}

function TrackComments({
  track,
  userId,
  current,
  composerRef,
  onSeek,
  replyTarget,
  onClearReply,
}: {
  track: Track;
  userId?: string;
  current: number;
  composerRef: React.RefObject<HTMLTextAreaElement | null>;
  onSeek: (seconds: number) => void;
  replyTarget: TrackComment | null;
  onClearReply: () => void;
}) {
  const { t: tr, locale } = useI18n();
  const [page, setPage] = useState(1);
  const result = useQuery({
    queryKey: ['track-comments', 'list', track.id, track.sourceVersion, userId ?? 'visitor', page],
    queryFn: ({ signal }) =>
      api<CommentPage>('/tracks/' + track.id + '/comments?page=' + page + '&pageSize=20', {
        signal,
        auth: false,
      }),
  });
  useEffect(() => setPage(1), [track.sourceVersion]);
  const data = result.data?.sourceVersion === track.sourceVersion ? result.data : undefined;
  const replyRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (replyTarget) replyRef.current?.focus({ preventScroll: true });
  }, [replyTarget]);
  const externalReply = replyTarget?.sourceVersion === track.sourceVersion ? replyTarget : null;
  return (
    <CommentModerationScope trackId={track.id} userId={userId}>
      <div className="sound-comments-heading">
        <h2>
          {data
            ? tr('{count} bình luận', {
                count: new Intl.NumberFormat(getLanguage(locale).tag).format(data.total),
              })
            : tr('Bình luận')}
        </h2>
      </div>
      {userId ? (
        <CommentComposer
          track={track}
          current={current}
          inputRef={composerRef}
          onPosted={() => setPage(1)}
        />
      ) : (
        <Link className="sound-comment-login" href="/login">
          <CommentIcon />
          {tr('Đăng nhập để bình luận')}
        </Link>
      )}
      {userId && externalReply && (
        <CommentComposer
          key={externalReply.id}
          track={track}
          current={externalReply.atSeconds}
          parent={externalReply}
          inputRef={replyRef}
          onCancel={onClearReply}
          onPosted={onClearReply}
        />
      )}
      {result.isPending ? (
        <Loading />
      ) : result.isError ? (
        <ErrorState error={result.error} retry={() => void result.refetch()} />
      ) : data?.items.length ? (
        <>
          <div className="sound-comment-list">
            {data.items.map((comment) => (
              <CommentThread
                key={comment.id}
                comment={comment}
                track={track}
                userId={userId}
                onSeek={onSeek}
              />
            ))}
          </div>
          <CommentPagination
            page={page}
            pageSize={data.pageSize}
            total={data.total}
            setPage={setPage}
          />
        </>
      ) : (
        <div className="sound-comments-empty">
          <CommentIcon />
          <h3>{tr('Chưa có bình luận')}</h3>
          <p>{tr('Hãy là người đầu tiên chia sẻ cảm nhận về bài hát này.')}</p>
        </div>
      )}
    </CommentModerationScope>
  );
}

function CommentComposer({
  track,
  current,
  parent,
  inputRef,
  onPosted,
  onCancel,
}: {
  track: Track;
  current: number;
  parent?: TrackComment;
  inputRef?: React.RefObject<HTMLTextAreaElement | null>;
  onPosted: () => void;
  onCancel?: () => void;
}) {
  const { t: tr, locale } = useI18n();
  const { user } = useAuth();
  const player = usePlayer();
  const toast = useToast(),
    queryClient = useQueryClient();
  const action = useGuardedAction();
  const id = useId();
  const moderationRefresh = useCommentModerationRefresh();
  const localRef = useRef<HTMLTextAreaElement>(null),
    errorRef = useRef<HTMLParagraphElement>(null);
  const [body, setBody] = useState(''),
    [error, setError] = useState('');
  const version = useRef(track.sourceVersion);
  useEffect(() => {
    if (version.current !== track.sourceVersion) {
      version.current = track.sourceVersion;
      if (body.trim())
        setError('Âm thanh đã được thay thế ở phiên khác. Tải lại trang trước khi tiếp tục.');
    }
  }, [track.sourceVersion]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const atSeconds =
      parent?.atSeconds ?? Math.min(track.duration || 900, player.getPlaybackTime(track));
    if (!Number.isFinite(atSeconds) || atSeconds < 0 || atSeconds > (track.duration || 900)) {
      setError('Thông tin chưa hợp lệ. Kiểm tra các trường và thử lại.');
      return;
    }
    if (!body.trim()) {
      setError('Vui lòng nhập nội dung bình luận.');
      return;
    }
    if ([...body].length > 2000) {
      setError('Nội dung tối đa {count} ký tự.');
      return;
    }
    void action.run(async (signal) => {
      setError('');
      try {
        const receipt = await api<{
          status: 'PENDING' | 'VISIBLE' | 'HELD' | 'HIDDEN' | 'DELETED';
        }>('/tracks/' + track.id + '/comments', {
          method: 'POST',
          body: {
            body,
            sourceVersion: track.sourceVersion,
            atSeconds,
            ...(parent ? { parentId: parent.id } : {}),
          },
          signal,
        });
        if (signal.aborted) return;
        setBody('');
        if (moderationRefresh) moderationRefresh();
        else void queryClient.invalidateQueries({ queryKey: ['track-comments'] });
        toast(
          moderationSubmissionMessage(receipt.status, locale),
          receipt.status === 'HIDDEN' ? 'error' : undefined,
        );
        onPosted();
      } catch (reason) {
        if (!signal.aborted)
          setError(reason instanceof Error ? reason.message : 'Có lỗi xảy ra. Hãy thử lại.');
      }
    });
  };
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);
  return (
    <form className={'sound-comment-composer ' + (parent ? 'is-reply' : '')} onSubmit={submit}>
      <div className="sound-composer-avatar">
        {user && <Avatar name={user.displayName} src={user.avatarUrl} />}
      </div>
      <div className="sound-composer-fields">
        <label htmlFor={id + '-body'}>
          {parent
            ? tr('Trả lời {name}', { name: parent.user.displayName })
            : tr('Viết bình luận tại {time}', { time: time(current) })}
        </label>
        <textarea
          ref={inputRef ?? localRef}
          id={id + '-body'}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={parent ? 2 : 3}
          required
          disabled={action.pending}
          placeholder={tr(parent ? 'Viết trả lời…' : 'Chia sẻ cảm nhận về bài hát…')}
          aria-describedby={error ? id + '-error' : undefined}
        />
        {error && (
          <p
            className="sound-comment-error"
            role="alert"
            id={id + '-error'}
            ref={errorRef}
            tabIndex={-1}
          >
            {tr(error, { count: 2000 })}
          </p>
        )}
        <div className="sound-comment-submit">
          <span>{[...body].length}/2000</span>
          {onCancel && (
            <button
              type="button"
              className="text-action"
              disabled={action.pending}
              onClick={onCancel}
            >
              {tr('Hủy')}
            </button>
          )}
          <button
            type="submit"
            className="button"
            disabled={action.pending || !body.trim() || [...body].length > 2000}
          >
            {tr(action.pending ? 'Đang gửi…' : parent ? 'Gửi trả lời' : 'Gửi bình luận')}
          </button>
        </div>
      </div>
    </form>
  );
}

function CommentThread({
  comment,
  track,
  userId,
  onSeek,
}: {
  comment: TrackComment;
  track: Track;
  userId?: string;
  onSeek: (seconds: number) => void;
}) {
  const { t: tr } = useI18n();
  const [replying, setReplying] = useState(false),
    [expanded, setExpanded] = useState(false);
  return (
    <article className="sound-comment-thread">
      <CommentRow
        comment={comment}
        trackId={track.id}
        userId={userId}
        onSeek={onSeek}
        onReply={() => setReplying((v) => !v)}
      />
      {replying && userId && (
        <CommentComposer
          track={track}
          current={comment.atSeconds}
          parent={comment}
          onCancel={() => setReplying(false)}
          onPosted={() => {
            setReplying(false);
            setExpanded(true);
          }}
        />
      )}
      {comment.replyCount > 0 && (
        <button
          type="button"
          className="text-action sound-replies-toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? tr('Ẩn trả lời') : tr('Xem {count} trả lời', { count: comment.replyCount })}
        </button>
      )}
      {expanded && (
        <CommentReplies track={track} parent={comment} userId={userId} onSeek={onSeek} />
      )}
    </article>
  );
}
function CommentRow({
  comment,
  trackId,
  userId,
  onSeek,
  onReply,
}: {
  comment: TrackComment;
  trackId: string;
  userId?: string;
  onSeek: (seconds: number) => void;
  onReply?: () => void;
}) {
  const { t: tr, formatDateTime } = useI18n();
  return (
    <div className="sound-comment-row">
      <Link className="sound-comment-avatar" href={'/profiles/' + comment.user.id}>
        <Avatar name={comment.user.displayName} src={comment.user.avatarUrl} />
      </Link>
      <div className="sound-comment-content">
        <div className="sound-comment-meta">
          <Link href={'/profiles/' + comment.user.id} dir="auto">
            {comment.user.displayName}
          </Link>
          <button
            type="button"
            className="sound-comment-timestamp"
            onClick={() => onSeek(comment.atSeconds)}
            aria-label={tr('Tua đến {time}', { time: time(comment.atSeconds) })}
          >
            {time(comment.atSeconds)}
          </button>
          <time dateTime={comment.createdAt}>{formatDateTime(comment.createdAt)}</time>
        </div>
        <p dir="auto">{comment.body}</p>
        {onReply &&
          (userId ? (
            <button type="button" className="text-action sound-reply-button" onClick={onReply}>
              {tr('Trả lời')}
            </button>
          ) : (
            <Link className="text-action sound-reply-button" href="/login">
              {tr('Trả lời')}
            </Link>
          ))}
      </div>
      <div className="moderation-comment-controls">
        <CommentHeart comment={comment} trackId={trackId} userId={userId} />
        {userId && comment.canDelete === true && (
          <CommentOwnerMenu id={comment.id} viewerId={userId} />
        )}
      </div>
    </div>
  );
}
function CommentHeart({
  comment,
  trackId,
  userId,
}: {
  comment: TrackComment;
  trackId: string;
  userId?: string;
}) {
  const { t: tr } = useI18n();
  const queryClient = useQueryClient(),
    toast = useToast();
  const action = useGuardedAction();
  const label = tr(comment.liked ? 'Bỏ thích bình luận của {name}' : 'Thích bình luận của {name}', {
    name: comment.user.displayName,
  });
  if (!userId)
    return (
      <Link className="sound-comment-heart" href="/login" aria-label={label}>
        <Icon name="heart" size={16} />
        <span>{comment.likeCount || ''}</span>
      </Link>
    );
  const like = () =>
    action.run(async (signal) => {
      try {
        await api('/tracks/' + trackId + '/comments/' + comment.id + '/like', {
          method: comment.liked ? 'DELETE' : 'PUT',
          body: {},
          signal,
        });
        if (!signal.aborted) await queryClient.invalidateQueries({ queryKey: ['track-comments'] });
      } catch (error) {
        if (!signal.aborted)
          toast(error instanceof Error ? error.message : 'Có lỗi xảy ra. Hãy thử lại.', 'error');
      }
    });
  return (
    <button
      type="button"
      className={'sound-comment-heart ' + (comment.liked ? 'is-liked' : '')}
      aria-label={label}
      aria-pressed={comment.liked}
      disabled={action.pending}
      onClick={() => void like()}
    >
      <Icon name="heart" size={16} />
      <span>{comment.likeCount || ''}</span>
    </button>
  );
}
function CommentReplies({
  track,
  parent,
  userId,
  onSeek,
}: {
  track: Track;
  parent: TrackComment;
  userId?: string;
  onSeek: (seconds: number) => void;
}) {
  const [page, setPage] = useState(1);
  const result = useQuery({
    queryKey: [
      'track-comments',
      'replies',
      track.id,
      track.sourceVersion,
      parent.id,
      userId ?? 'visitor',
      page,
    ],
    queryFn: ({ signal }) =>
      api<CommentPage>(
        '/tracks/' + track.id + '/comments/' + parent.id + '/replies?page=' + page + '&pageSize=20',
        { signal, auth: false },
      ),
  });
  if (result.isPending) return <Loading />;
  if (result.isError)
    return <ErrorState error={result.error} retry={() => void result.refetch()} />;
  if (result.data.sourceVersion !== track.sourceVersion) return null;
  return (
    <div className="sound-comment-replies">
      {result.data.items.map((comment) => (
        <CommentRow
          key={comment.id}
          comment={comment}
          trackId={track.id}
          userId={userId}
          onSeek={onSeek}
        />
      ))}
      <CommentPagination
        page={page}
        pageSize={result.data.pageSize}
        total={result.data.total}
        setPage={setPage}
      />
    </div>
  );
}
function CommentPagination({
  page,
  pageSize,
  total,
  setPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  setPage: (value: number) => void;
}) {
  const { t: tr } = useI18n();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages < 2) return null;
  return (
    <nav className="sound-comment-pagination" aria-label={tr('Bình luận')}>
      <NavigationActionButton
        type="button"
        disabled={page <= 1}
        previous
        onClick={() => setPage(page - 1)}
      >
        {tr('Trang trước')}
      </NavigationActionButton>
      <span>{tr('Trang {page} / {pages}', { page, pages })}</span>
      <NavigationActionButton
        type="button"
        disabled={page >= pages}
        onClick={() => setPage(page + 1)}
      >
        {tr('Trang sau')}
      </NavigationActionButton>
    </nav>
  );
}
