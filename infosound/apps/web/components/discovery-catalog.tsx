'use client';
import Link from './app-navigation';
import { NavigationAction, NavigationActionButton } from './navigation-action';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api, quality, time, type List, type Track } from '@/lib/api';
import { getLanguage } from '@/lib/languages';
import { useI18n } from './locale-provider';
import { usePlayer } from './providers';
import { Artwork, Empty, ErrorState, Loading, PageTitle } from './common';
import { Icon } from './icons';
import { TrackOptions } from './track-options';

/** API ordering is authoritative; do not re-sort a paginated catalog in the browser. */
function CatalogRows({
  tracks,
  offset = 0,
  popular = false,
}: {
  tracks: Track[];
  offset?: number;
  popular?: boolean;
}) {
  const { t: tr, locale } = useI18n();
  const player = usePlayer();
  const formatter = new Intl.NumberFormat(getLanguage(locale).tag);
  return (
    <ol className="discovery-track-list" start={offset + 1} role="list">
      {tracks.map((track, index) => (
        <li
          className="discovery-track-row"
          data-top={popular && offset + index < 3 ? 'true' : undefined}
          key={track.id}
        >
          <span className="discovery-rank" aria-hidden="true">
            {String(offset + index + 1).padStart(2, '0')}
          </span>
          <button
            className="icon-button discovery-play"
            type="button"
            disabled={track.available === false}
            aria-label={tr('Phát {title}', { title: track.title })}
            onClick={() => void player.play(track)}
          >
            <Icon name="play" size={18} />
          </button>
          <Link
            href={'/tracks/' + track.id}
            className="discovery-art"
            aria-label={tr('Xem {title}', { title: track.title })}
          >
            <Artwork track={track} />
          </Link>
          <div className="discovery-track-info">
            <Link className="discovery-track-title" href={'/tracks/' + track.id}>
              {track.title}
            </Link>
            <Link className="muted" href={'/artists/' + track.authorId}>
              {track.author?.displayName || tr('Nghệ sĩ')}
            </Link>
            {popular && (
              <span className="discovery-play-count">
                {tr('{count} lượt nghe', {
                  count: formatter.format(Math.max(0, track.playCount ?? 0)),
                })}
              </span>
            )}
          </div>
          <span className="discovery-quality muted">{tr(quality(track))}</span>
          <span className="discovery-duration muted">{time(track.duration)}</span>
          <TrackOptions track={track} />
        </li>
      ))}
    </ol>
  );
}

function NoTracks() {
  const { t: tr } = useI18n();
  return (
    <Empty
      title={tr('Chưa có bài hát công khai')}
      description={tr('Bài hát sẽ xuất hiện sau khi nghệ sĩ hoàn tất xử lý và phát hành.')}
    />
  );
}

export function DiscoveryChart() {
  const { t: tr } = useI18n();
  const result = useQuery({
    queryKey: ['tracks', 'popular', 'home'],
    queryFn: () => api<List<Track>>('/tracks?sort=popular&page=1&pageSize=5', { auth: false }),
  });
  return (
    <section className="catalog-section discovery-chart" aria-labelledby="home-charts-title">
      <div className="section-heading">
        <div>
          <span className="eyebrow">{tr('Nghe nhiều nhất')}</span>
          <h2 id="home-charts-title">
            {tr('Bảng xếp hạng')}
            <span className="heading-dot">.</span>
          </h2>
        </div>
        <NavigationAction href="/charts" aria-labelledby="home-charts-all home-charts-title">
          <span id="home-charts-all">{tr('Xem tất cả')}</span>
        </NavigationAction>
      </div>
      {result.isPending ? (
        <Loading />
      ) : result.isError ? (
        <ErrorState error={result.error} retry={() => void result.refetch()} />
      ) : result.data.items.length ? (
        <CatalogRows tracks={result.data.items.slice(0, 5)} popular />
      ) : (
        <NoTracks />
      )}
    </section>
  );
}

const pageSize = 20;
export function CatalogPage({ popular = false }: { popular?: boolean }) {
  const { t: tr, locale } = useI18n();
  const params = useSearchParams();
  const rawPage = params.get('page') || '1';
  const page = /^[1-9]\d{0,6}$/.test(rawPage) ? Math.min(10000, Number(rawPage)) : 1;
  const sort = popular ? 'popular' : 'latest',
    path = popular ? '/charts' : '/new-releases';
  const result = useQuery({
    queryKey: ['tracks', 'catalog', sort, page],
    queryFn: () =>
      api<List<Track>>(`/tracks?sort=${sort}&page=${page}&pageSize=${pageSize}`, { auth: false }),
  });
  const pages = Math.max(1, Math.ceil((result.data?.total ?? 0) / pageSize));
  const formatter = new Intl.NumberFormat(getLanguage(locale).tag);
  return (
    <>
      <PageTitle
        title={tr(popular ? 'Bảng xếp hạng' : 'Mới phát hành')}
        description={tr(popular ? 'Nghe nhiều nhất' : 'Lắng nghe những âm thanh mới.')}
        action={<NavigationAction href="/">{tr('Khám phá')}</NavigationAction>}
      />
      <section
        className="discovery-catalog"
        aria-label={tr(popular ? 'Bảng xếp hạng' : 'Mới phát hành')}
      >
        {result.isPending ? (
          <Loading />
        ) : result.isError ? (
          <ErrorState error={result.error} retry={() => void result.refetch()} />
        ) : (
          <>
            {result.data.items.length ? (
              <CatalogRows
                tracks={result.data.items}
                offset={(page - 1) * pageSize}
                popular={popular}
              />
            ) : (
              <NoTracks />
            )}
            {(pages > 1 || page > 1) && (
              <nav
                className="discovery-pagination"
                aria-label={tr(popular ? 'Bảng xếp hạng' : 'Mới phát hành')}
              >
                {page > 1 ? (
                  <NavigationAction href={path + '?page=' + (page - 1)} previous>
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
                  <NavigationAction href={path + '?page=' + (page + 1)}>
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
    </>
  );
}
