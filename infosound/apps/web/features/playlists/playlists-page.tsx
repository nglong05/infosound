'use client';
import { useState } from 'react';
import { useAppRouter as useRouter } from '@/components/app-navigation';
import { useI18n } from '@/components/locale-provider';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type List, type Playlist } from '@/lib/api';
import { useToast } from '@/components/providers';
import { PageTitle, Loading, ErrorState, Empty, PlaylistCards } from '@/components/common';
import { Icon } from '@/components/icons';

export function Playlists() {
  const { t: tr } = useI18n();
  const result = useQuery({
    queryKey: ['playlists'],
    queryFn: () => api<List<Playlist>>('/playlists'),
  });
  const [creating, setCreating] = useState(false);
  const queryClient = useQueryClient();
  const toast = useToast();
  const router = useRouter();
  const mutation = useMutation({
    mutationFn: (body: unknown) => api<Playlist>('/playlists', { method: 'POST', body }),
    onSuccess: (p) => {
      void queryClient.invalidateQueries();
      toast('Đã tạo playlist.');
      router.push('/playlists/' + p.id);
    },
    onError: (e) => toast(e.message, 'error'),
  });
  return (
    <>
      <PageTitle
        eyebrow={tr('SẮP XẾP NHỮNG CẢM XÚC')}
        title={tr('Playlist của bạn.')}
        description={tr('Một bộ sưu tập cho buổi sáng. Một giai điệu cho đêm muộn.')}
        action={
          <button className="button" onClick={() => setCreating((v) => !v)}>
            <Icon name={creating ? 'close' : 'plus'} />
            {creating ? tr('Đóng biểu mẫu') : tr('Tạo playlist')}
          </button>
        }
      />
      {creating && (
        <form
          className="surface form-stack narrow"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            mutation.mutate({
              title: f.get('title'),
              description: f.get('description'),
              isPublic: f.get('isPublic') === 'on',
            });
          }}
        >
          <h2>{tr('Playlist mới')}</h2>
          <label>
            {tr('Tên playlist')}
            <input
              name="title"
              required
              maxLength={120}
              placeholder={tr('Ví dụ: Một chiều bình yên')}
            />
          </label>
          <label>
            {tr('Mô tả')}
            <textarea name="description" maxLength={2000} rows={3} />
          </label>
          <label className="checkbox-label">
            <input type="checkbox" name="isPublic" />
            {tr('Công khai playlist với cộng đồng')}
          </label>
          <button disabled={mutation.isPending} className="button">
            {mutation.isPending ? tr('Đang tạo…') : tr('Tạo playlist')}
          </button>
        </form>
      )}
      {result.isPending ? (
        <Loading />
      ) : result.isError ? (
        <ErrorState error={result.error} retry={() => void result.refetch()} />
      ) : result.data.items.length ? (
        <PlaylistCards playlists={result.data.items} />
      ) : (
        <Empty
          title={tr('Mỗi playlist là một câu chuyện')}
          description={tr(
            'Tạo playlist đầu tiên, rồi thêm bài hát từ trang chi tiết của từng bài.',
          )}
          icon="playlist"
        />
      )}
    </>
  );
}
