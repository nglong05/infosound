'use client';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api, type Artist, type List } from '@/lib/api';
import { getLanguage } from '@/lib/languages';
import { NavigationAction, NavigationActionButton } from './navigation-action';
import { Empty, ErrorState, Loading, PageTitle } from './common';
import { Icon } from './icons';
import { useI18n } from './locale-provider';
import { useAuth } from './providers';
import { TrendingArtistCard } from './trending-artists';

const pageSize = 20;

export function ArtistCatalogPage() {
  const { t } = useI18n(),
    { user, loading } = useAuth();
  const params = useSearchParams(),
    rawPage = params.get('page') || '1';
  const page = /^[1-9]\d{0,6}$/.test(rawPage) ? Math.min(10000, Number(rawPage)) : 1;
  return (
    <>
      <PageTitle
        title={t('Nghệ sĩ')}
        description={t('Nghe nhiều nhất')}
        action={<NavigationAction href="/">{t('Khám phá')}</NavigationAction>}
      />
      {loading ? (
        <Loading />
      ) : (
        <ArtistCatalog key={user?.id ?? 'visitor'} page={page} userId={user?.id} />
      )}
    </>
  );
}

function ArtistCatalog({ page, userId }: { page: number; userId?: string }) {
  const { t, locale } = useI18n();
  const artists = useQuery({
    queryKey: ['artists', 'popular', 'catalog', 'spotlight', userId ?? 'visitor', page],
    queryFn: ({ signal }) =>
      api<List<Artist>>(
        `/artists?sort=popular&page=${page}&pageSize=${pageSize}&include=spotlight`,
        { auth: false, signal },
      ),
  });
  const pages = Math.max(1, Math.ceil((artists.data?.total ?? 0) / pageSize));
  const formatter = new Intl.NumberFormat(getLanguage(locale).tag);
  return (
    <section className="artist-catalog" aria-label={t('Nghệ sĩ')}>
      {artists.isPending ? (
        <Loading />
      ) : artists.isError ? (
        <ErrorState error={artists.error} retry={() => void artists.refetch()} />
      ) : (
        <>
          {artists.data.items.length ? (
            <div className="trending-artist-grid">
              {artists.data.items.map((artist) => (
                <TrendingArtistCard key={artist.id} artist={artist} userId={userId} />
              ))}
            </div>
          ) : (
            <Empty
              title={t('Gặp gỡ những nghệ sĩ tiếp theo')}
              description={t('Hồ sơ nghệ sĩ sẽ xuất hiện khi cộng đồng bắt đầu chia sẻ âm nhạc.')}
              icon="user"
            />
          )}
          {(pages > 1 || page > 1) && (
            <nav className="discovery-pagination" aria-label={t('Nghệ sĩ')}>
              {page > 1 ? (
                <NavigationAction href={'/artists?page=' + (page - 1)} previous>
                  {t('Trang trước')}
                </NavigationAction>
              ) : (
                <NavigationActionButton type="button" disabled previous>
                  {t('Trang trước')}
                </NavigationActionButton>
              )}
              <span className="muted">
                {t('Trang {page} / {pages}', {
                  page: formatter.format(page),
                  pages: formatter.format(pages),
                })}
              </span>
              {page < pages ? (
                <NavigationAction href={'/artists?page=' + (page + 1)}>
                  {t('Trang sau')}
                </NavigationAction>
              ) : (
                <NavigationActionButton type="button" disabled>
                  {t('Trang sau')}
                </NavigationActionButton>
              )}
            </nav>
          )}
        </>
      )}
    </section>
  );
}
