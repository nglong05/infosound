'use client';
import Link from './app-navigation';
import { useEffect, useId, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Artist, type List, type Track } from '@/lib/api';
import { Artwork, Empty, ErrorState, Loading, PageTitle } from './common';
import { Icon } from './icons';
import { TrackOptions } from './track-options';
import { useI18n } from './locale-provider';
import { useAuth, useToast } from './providers';
import {
  CommentViolationNotification,
  moderationNotificationFeedCopy,
  type CommentViolationNotice,
} from '@infosound/comment-moderation/browser';

type Notification =
  | CommentViolationNotice
  | {
      id: string;
      kind?: 'RELEASE';
      readAt?: string | null;
      createdAt: string;
      title?: string;
      trackId?: string;
      track?: Track;
      author?: Artist;
      releaseEvent?: { track?: Track };
    };
type ReadRequest = { id: string; ownerId: string };

/** The existing notification projection already includes the song's approved cover. */
export function NotificationFeed() {
  const { t: tr, locale, formatDateTime } = useI18n(),
    { user } = useAuth();
  const queryClient = useQueryClient(),
    toast = useToast(),
    feedId = useId();
  const owner = useRef(user?.id),
    alive = useRef(true),
    busy = useRef(false),
    requests = useRef(new Set<AbortController>());
  owner.current = user?.id;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      requests.current.forEach((request) => request.abort());
      requests.current.clear();
    };
  }, []);
  useEffect(
    () => () => {
      requests.current.forEach((request) => request.abort());
      requests.current.clear();
    },
    [user?.id],
  );
  const result = useQuery({
    queryKey: ['notifications', user?.id],
    queryFn: ({ signal }) => api<List<Notification>>('/notifications', { signal }),
    enabled: !!user,
    refetchInterval: 30000,
  });
  const mark = useMutation({
    mutationFn: async ({ id, ownerId }: ReadRequest) => {
      if (owner.current !== ownerId) throw new DOMException('Aborted', 'AbortError');
      const request = new AbortController();
      requests.current.add(request);
      try {
        return await api('/notifications/' + id + '/read', {
          method: 'PATCH',
          body: {},
          signal: request.signal,
        });
      } finally {
        requests.current.delete(request);
      }
    },
    onSuccess: (_, variables) => {
      if (alive.current && owner.current === variables.ownerId)
        void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
    onError: (error, variables) => {
      if (
        alive.current &&
        owner.current === variables.ownerId &&
        !(error instanceof DOMException && error.name === 'AbortError')
      )
        toast(error.message, 'error');
    },
    onSettled: () => {
      busy.current = false;
    },
  });
  const markRead = (id: string) => {
    if (busy.current || !user?.id) return;
    busy.current = true;
    mark.mutate({ id, ownerId: user.id });
  };
  const mixed = !!result.data?.items.some(
      (notification) => notification.kind === 'COMMENT_VIOLATION',
    ),
    copy = moderationNotificationFeedCopy(locale);
  return (
    <>
      <PageTitle
        eyebrow={mixed ? copy.eyebrow : tr('TỪ NHỮNG NGHỆ SĨ BẠN THEO DÕI')}
        title={mixed ? copy.title : tr('Có giai điệu mới cho bạn.')}
        description={
          mixed
            ? copy.description
            : tr(
                'Bật chuông trên trang nghệ sĩ để nhận thông báo phát hành. Theo dõi và thông báo hoàn toàn miễn phí.',
              )
        }
      />
      {result.isPending ? (
        <Loading />
      ) : result.isError ? (
        <ErrorState error={result.error} retry={() => void result.refetch()} />
      ) : result.data.items.length ? (
        <div className="notification-feed">
          {result.data.items.map((notification) => {
            if (notification.kind === 'COMMENT_VIOLATION')
              return (
                <CommentViolationNotification
                  key={notification.id}
                  titleId={feedId + '-' + notification.id}
                  locale={locale}
                  commentBody={notification.commentBody}
                  createdAt={notification.createdAt}
                  unread={!notification.readAt}
                  formatDateTime={formatDateTime}
                  readPending={mark.isPending}
                  onMarkRead={() => markRead(notification.id)}
                />
              );
            const track = notification.track || notification.releaseEvent?.track;
            const trackId = track?.id || notification.trackId,
              title = track?.title || notification.title || tr('Có bài phát hành mới');
            const titleId = feedId + '-' + notification.id,
              unread = !notification.readAt;
            return (
              <article
                key={notification.id}
                className="notification-feed-item"
                data-unread={unread ? 'true' : 'false'}
                aria-labelledby={titleId}
              >
                {trackId ? (
                  <Link
                    className="notification-feed-cover"
                    href={'/tracks/' + trackId}
                    tabIndex={-1}
                    aria-hidden="true"
                  >
                    <Artwork track={track} />
                  </Link>
                ) : (
                  <div className="notification-feed-cover">
                    <Artwork track={track} />
                  </div>
                )}
                <div className="notification-feed-content">
                  <div className="notification-feed-meta">
                    <span>
                      <Icon name="bell" size={14} />
                      {tr('Có bài phát hành mới')}
                    </span>
                    <time dateTime={notification.createdAt}>
                      {formatDateTime(notification.createdAt)}
                    </time>
                  </div>
                  <h2 id={titleId}>
                    {trackId ? (
                      <Link href={'/tracks/' + trackId} dir="auto">
                        {title}
                      </Link>
                    ) : (
                      <span dir="auto">{title}</span>
                    )}
                  </h2>
                  <p>
                    {tr('{artist} vừa chia sẻ một giai điệu mới.', {
                      artist:
                        track?.author?.displayName ||
                        notification.author?.displayName ||
                        tr('Nghệ sĩ bạn theo dõi'),
                    })}
                  </p>
                  <div className="notification-feed-actions">
                    {trackId && (
                      <Link className="notification-feed-listen" href={'/tracks/' + trackId}>
                        <Icon name="play" size={17} />
                        {tr('Nghe bài hát')}
                      </Link>
                    )}
                    {track && <TrackOptions track={track} />}
                    {unread && (
                      <button
                        type="button"
                        className="notification-feed-mark"
                        disabled={mark.isPending}
                        aria-busy={mark.isPending}
                        onClick={() => markRead(notification.id)}
                      >
                        <Icon name="check" size={16} />
                        {tr('Đánh dấu đã đọc')}
                      </button>
                    )}
                  </div>
                </div>
                {unread && <span className="notification-feed-unread" aria-hidden="true" />}
              </article>
            );
          })}
        </div>
      ) : (
        <Empty
          title={tr('Chưa có thông báo mới')}
          description={tr(
            'Những lần phát hành mới sẽ xuất hiện khi bạn theo dõi nghệ sĩ và bật thông báo.',
          )}
          icon="bell"
        />
      )}
    </>
  );
}
