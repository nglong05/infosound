'use client';
import { useState } from 'react';
import { useAppRouter as useRouter } from '@/components/app-navigation';
import { useI18n } from '@/components/locale-provider';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type Track, type Playlist } from '@/lib/api';
import { useAuth, usePlayer, useToast } from '@/components/providers';
import { Loading, ErrorState, Empty, TrackRows } from '@/components/common';
import { Icon } from '@/components/icons';

export function PlaylistDetail({ id }: { id: string }) {
  const { t: tr } = useI18n();
  const result = useQuery({
    queryKey: ['playlist', id],
    queryFn: () => api<Playlist>('/playlists/' + id),
  });
  const { user } = useAuth();
  const [editing, setEditing] = useState(false);
  const queryClient = useQueryClient();
  const player = usePlayer();
  const toast = useToast();
  const router = useRouter();
  const [addQuery, setAddQuery] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const search = useQuery({
    queryKey: ['playlist-search', searchTerm],
    queryFn: () => api<{ tracks: Track[] }>('/search?q=' + encodeURIComponent(searchTerm)),
    enabled: !!searchTerm,
  });
  const mutation = useMutation({
    mutationFn: ({
      path = '',
      method = 'PATCH',
      body,
    }: {
      path?: string;
      method?: string;
      body?: unknown;
    }) => api('/playlists/' + id + path, { method, body }),
    onSuccess: () => {
      void queryClient.invalidateQueries();
      toast('Đã cập nhật playlist.');
      setEditing(false);
    },
    onError: (e) => toast(e.message, 'error'),
  });
  if (result.isPending) return <Loading />;
  if (result.isError)
    return <ErrorState error={result.error} retry={() => void result.refetch()} />;
  const p = result.data;
  const owner = user?.id === p.ownerId;
  const tracks = p.tracks || [];
  const reorder = (index: number, offset: number) => {
    const order = tracks.map((t) => t.id);
    [order[index], order[index + offset]] = [order[index + offset], order[index]];
    mutation.mutate({
      path: '/order',
      method: 'PUT',
      body: { version: p.version, trackIds: order },
    });
  };
  return (
    <>
      <section className="playlist-hero">
        <div className="playlist-art large">
          <Icon name="playlist" size={80} />
        </div>
        <div>
          <span className="eyebrow">
            {tr('PLAYLIST')} · {p.isPublic ? tr('CÔNG KHAI') : tr('RIÊNG TƯ')}
          </span>
          <h1>{p.title}</h1>
          <p>{p.description || tr('Một bộ sưu tập dành cho những cảm xúc của bạn.')}</p>
          <span className="muted">
            {p.owner?.displayName || tr('Bộ sưu tập')} ·{' '}
            {tr(tracks.length === 1 ? '1 bài hát' : '{count} bài hát', { count: tracks.length })}
          </span>
          <div className="action-row">
            <button
              className="button"
              disabled={!tracks.some((t) => t.available !== false)}
              onClick={() => {
                const available = tracks.filter((t) => t.available !== false);
                if (available[0]) void player.playQueue(available[0], available);
              }}
            >
              <Icon name="play" />
              {tr('Phát playlist')}
            </button>
            {owner && (
              <>
                <button className="button secondary" onClick={() => setEditing((v) => !v)}>
                  {tr('Chỉnh sửa')}
                </button>
                <button
                  className="button danger"
                  disabled={mutation.isPending}
                  onClick={() => {
                    if (window.confirm(tr('Xóa playlist này? Các bài hát gốc sẽ được giữ nguyên.')))
                      void api('/playlists/' + id, { method: 'DELETE' })
                        .then(() => {
                          void queryClient.invalidateQueries();
                          router.push('/playlists');
                          toast('Đã xóa playlist.');
                        })
                        .catch((e) => toast(e.message, 'error'));
                  }}
                >
                  {tr('Xóa playlist')}
                </button>
              </>
            )}
          </div>
        </div>
      </section>
      {editing && owner && (
        <form
          className="surface form-stack narrow"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            mutation.mutate({
              body: {
                title: f.get('title'),
                description: f.get('description'),
                isPublic: f.get('isPublic') === 'on',
              },
            });
          }}
        >
          <label>
            {tr('Tên playlist')}
            <input name="title" required maxLength={120} defaultValue={p.title} />
          </label>
          <label>
            {tr('Mô tả')}
            <textarea name="description" maxLength={2000} defaultValue={p.description} />
          </label>
          <label className="checkbox-label">
            <input type="checkbox" name="isPublic" defaultChecked={p.isPublic} />
            {tr('Công khai playlist')}
          </label>
          <button className="button" disabled={mutation.isPending}>
            {tr('Lưu thay đổi')}
          </button>
        </form>
      )}
      {tracks.length ? (
        <TrackRows
          tracks={tracks}
          actions={(t, index) =>
            owner && (
              <div className="row-actions">
                <button
                  className="icon-button"
                  aria-label={tr('Đưa {title} lên trên', { title: t.title })}
                  disabled={index === 0 || mutation.isPending}
                  onClick={() => reorder(index, -1)}
                >
                  <Icon name="up" size={18} />
                </button>
                <button
                  className="icon-button"
                  aria-label={tr('Đưa {title} xuống dưới', { title: t.title })}
                  disabled={index === tracks.length - 1 || mutation.isPending}
                  onClick={() => reorder(index, 1)}
                >
                  <Icon name="down" size={18} />
                </button>
                <button
                  className="icon-button"
                  aria-label={tr('Xóa {title} khỏi playlist', { title: t.title })}
                  disabled={mutation.isPending}
                  onClick={() => mutation.mutate({ path: '/tracks/' + t.id, method: 'DELETE' })}
                >
                  <Icon name="close" size={18} />
                </button>
              </div>
            )
          }
        />
      ) : (
        <Empty
          title={tr('Playlist đang chờ giai điệu đầu tiên')}
          description={tr('Thêm bài hát bên dưới hoặc từ trang chi tiết bài hát.')}
          icon="playlist"
        />
      )}
      {owner && (
        <section className="surface compact">
          <h2>{tr('Thêm bài hát vào playlist')}</h2>
          <form
            className="search-form catalog-search playlist-track-search"
            onSubmit={(e) => {
              e.preventDefault();
              setSearchTerm(addQuery);
            }}
          >
            <label className="sr-only" htmlFor="playlist-add-query">
              {tr('Tìm bài hát để thêm')}
            </label>
            <button
              className="catalog-search-submit"
              type="submit"
              aria-label={tr('Tìm bài hát')}
              title={tr('Tìm bài hát')}
            >
              <Icon name="search" />
            </button>
            <input
              id="playlist-add-query"
              value={addQuery}
              onChange={(e) => setAddQuery(e.target.value)}
              placeholder={tr('Tên bài hát hoặc nghệ sĩ')}
              maxLength={100}
            />
          </form>
          {search.isFetching ? (
            <Loading />
          ) : search.isError ? (
            <ErrorState error={search.error} />
          ) : search.data ? (
            search.data.tracks.length ? (
              <TrackRows
                tracks={search.data.tracks}
                actions={(t) => (
                  <button
                    className="icon-button"
                    aria-label={tr('Thêm {title}', { title: t.title })}
                    disabled={mutation.isPending || tracks.some((track) => track.id === t.id)}
                    onClick={() =>
                      mutation.mutate({ path: '/tracks/' + t.id, method: 'PUT', body: {} })
                    }
                  >
                    <Icon name={tracks.some((track) => track.id === t.id) ? 'check' : 'plus'} />
                  </button>
                )}
              />
            ) : (
              <p className="muted">{tr('Chưa tìm thấy bài hát phù hợp.')}</p>
            )
          ) : null}
        </section>
      )}
    </>
  );
}
