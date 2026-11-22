'use client';
import { NavigationAction, NavigationActionButton } from './navigation-action';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api, type List, type Track } from '@/lib/api';
import { getLanguage } from '@/lib/languages';
import { useI18n } from './locale-provider';
import { useAuth } from './providers';
import {
  Empty,
  ErrorState,
  LikeButton,
  Loading,
  PageTitle,
  RequireAuth,
  TrackRows,
} from './common';
import { Icon } from './icons';

const pageSize = 20;
export function HistoryPage() {
  const { user } = useAuth();
  return (
    <RequireAuth>
      <HistoryList key={user?.id} userId={user?.id ?? ''} />
    </RequireAuth>
  );
}

function HistoryList({ userId }: { userId: string }) {
  const { t: tr, locale } = useI18n();
  const params = useSearchParams();
  const rawPage = params.get('page') || '1';
  const page = /^[1-9]\d{0,6}$/.test(rawPage) ? Math.min(10000, Number(rawPage)) : 1;
  const result = useQuery({
    queryKey: ['history', userId, page],
    queryFn: ({ signal }) =>
      api<List<Track>>(`/me/history?page=${page}&pageSize=${pageSize}`, { signal }),
    enabled: !!userId,
  });
  const pages = Math.max(1, Math.ceil((result.data?.total ?? 0) / pageSize));
  const formatter = new Intl.NumberFormat(getLanguage(locale).tag);
  return (
    <div className="history-page">
      <PageTitle
        eyebrow={tr('BỘ SƯU TẬP CÁ NHÂN')}
        title={tr('Những bài hát bạn đã nghe.')}
        description={tr('Nghe lại những giai điệu gần đây, từ mới nhất đến cũ nhất.')}
        action={<NavigationAction href="/library/liked">{tr('Bài đã thích')}</NavigationAction>}
      />
      <section className="catalog-section" aria-labelledby="history-title">
        <div className="section-heading">
          <h2 id="history-title">
            <Icon name="history" />
            {tr('Lịch sử')}
          </h2>
          {result.data && (
            <span className="muted">
              {tr(result.data.total === 1 ? '1 bài hát' : '{count} bài hát', {
                count: formatter.format(result.data.total),
              })}
            </span>
          )}
        </div>
        <p className="muted">
          {tr('Bài hát được lưu sau 30 giây nghe, hoặc nửa thời lượng với bài ngắn.')}
        </p>
        {result.isPending ? (
          <Loading />
        ) : result.isError ? (
          <ErrorState error={result.error} retry={() => void result.refetch()} />
        ) : (
          <>
            {result.data.items.length ? (
              <TrackRows
                tracks={result.data.items.slice(0, pageSize)}
                actions={(track) => <LikeButton track={track} />}
              />
            ) : (
              <Empty
                icon="history"
                title={tr(result.data.total ? 'Chưa có nội dung' : 'Chưa có bài hát trong lịch sử')}
                description={tr('Nghe một bài hát để bắt đầu lưu lịch sử tại đây.')}
                action={
                  <NavigationAction href={result.data.total ? '/history' : '/search'}>
                    {tr(result.data.total ? 'Lịch sử' : 'Tìm âm nhạc của bạn')}
                  </NavigationAction>
                }
              />
            )}
            {(pages > 1 || page > 1) && (
              <nav className="discovery-pagination" aria-label={tr('Lịch sử')}>
                {page > 1 ? (
                  <NavigationAction href={'/history?page=' + (page - 1)} previous>
                    {tr('Trang trước')}
                  </NavigationAction>
                ) : (
                  <NavigationActionButton type="button" disabled previous>
                    {tr('Trang trước')}
                  </NavigationActionButton>
                )}
                <span className="muted">
                  {tr('Trang {page} / {pages}', {
                    page: formatter.format(page),
                    pages: formatter.format(pages),
                  })}
                </span>
                {page < pages ? (
                  <NavigationAction href={'/history?page=' + (page + 1)}>
                    {tr('Trang sau')}
                  </NavigationAction>
                ) : (
                  <NavigationActionButton type="button" disabled>
                    {tr('Trang sau')}
                  </NavigationActionButton>
                )}
              </nav>
            )}
          </>
        )}
      </section>
    </div>
  );
}
