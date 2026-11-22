'use client';
import { useState, useEffect, useRef } from 'react';
import { NavigationAction } from '@/components/navigation-action';
import { useI18n } from '@/components/locale-provider';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Artist, type User } from '@/lib/api';
import { useAuth, useToast } from '@/components/providers';
import { Loading, ErrorState, Empty, Avatar, TrackCards } from '@/components/common';
import { Icon } from '@/components/icons';

export function ArtistDetail({ id, profile = false }: { id: string; profile?: boolean }) {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  return (
    <ArtistProfile
      key={(profile ? 'profile' : 'artist') + ':' + id + ':' + (user?.id ?? 'visitor')}
      id={id}
      profile={profile}
      user={user}
    />
  );
}

function ArtistProfile({ id, profile, user }: { id: string; profile: boolean; user: User | null }) {
  const { t: tr } = useI18n();
  const result = useQuery({
    queryKey: [profile ? 'profile' : 'artist', id, user?.id ?? 'visitor'],
    queryFn: ({ signal }) => api<Artist>((profile ? '/profiles/' : '/artists/') + id, { signal }),
  });
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
  const updateRelation = async (action: 'follow' | 'subscription', remove?: boolean) => {
    if (!user || user.id === id || busy.current) return;
    busy.current = true;
    setPending(true);
    const controller = new AbortController();
    request.current = controller;
    try {
      await api(`/artists/${id}/${action}`, {
        method: remove ? 'DELETE' : 'PUT',
        body: {},
        signal: controller.signal,
      });
      if (!alive.current || controller.signal.aborted) return;
      await queryClient.invalidateQueries();
      if (alive.current && !controller.signal.aborted) toast('Đã cập nhật theo dõi nghệ sĩ.');
    } catch (error) {
      if (alive.current && !controller.signal.aborted && error instanceof Error)
        toast(error.message, 'error');
    } finally {
      if (request.current === controller) {
        request.current = null;
        busy.current = false;
        if (alive.current) setPending(false);
      }
    }
  };
  if (result.isPending) return <Loading />;
  if (result.isError)
    return <ErrorState error={result.error} retry={() => void result.refetch()} />;
  const a = result.data;
  return (
    <>
      <section className="artist-hero">
        <Avatar name={a.displayName} src={a.avatarUrl} className="artist-avatar large" />
        <div>
          <span className="eyebrow">
            {a.role === 'AUTHOR' ? tr('NGHỆ SĨ INFOSOUND') : tr('NGƯỜI NGHE INFOSOUND')}
          </span>
          <h1>{a.displayName}</h1>
          <p>{a.bio || tr('Một hành trình âm nhạc trên InfoSound.')}</p>
          {a.role === 'AUTHOR' && (
            <>
              <span className="muted">
                {tr(a.followerCount === 1 ? '1 người theo dõi' : '{count} người theo dõi', {
                  count: a.followerCount ?? 0,
                })}
              </span>
              <div className="action-row">
                {user ? (
                  <>
                    <button
                      disabled={pending || user.id === id}
                      className="button"
                      aria-pressed={!!a.following}
                      onClick={() => void updateRelation('follow', a.following)}
                    >
                      <Icon name={a.following ? 'check' : 'plus'} />
                      {a.following ? tr('Đang theo dõi') : tr('Theo dõi')}
                    </button>
                    <button
                      className="button secondary"
                      aria-pressed={!!a.subscribed}
                      disabled={pending || !a.following}
                      onClick={() => void updateRelation('subscription', a.subscribed)}
                    >
                      <Icon name="bell" />
                      {a.subscribed ? tr('Đang bật thông báo') : tr('Bật thông báo')}
                    </button>
                  </>
                ) : (
                  <NavigationAction href="/login">{tr('Đăng nhập để theo dõi')}</NavigationAction>
                )}
              </div>
              <p className="small muted">
                {tr(
                  'Theo dõi để kết nối; bật chuông để nhận thông báo bài mới. Tắt chuông vẫn giữ theo dõi. Không có thanh toán.',
                )}
              </p>
            </>
          )}
        </div>
      </section>
      <div className="section-heading">
        <h2>{tr('Bài đã phát hành')}</h2>
        <span className="muted">
          {tr((a.tracks?.length ?? 0) === 1 ? '1 bài hát' : '{count} bài hát', {
            count: a.tracks?.length ?? 0,
          })}
        </span>
      </div>
      {a.tracks?.length ? (
        <TrackCards tracks={a.tracks} />
      ) : (
        <Empty
          title={tr('Chưa có bài hát công khai')}
          description={tr('Bài hát sẽ xuất hiện sau khi nghệ sĩ hoàn tất xử lý và phát hành.')}
        />
      )}
    </>
  );
}
