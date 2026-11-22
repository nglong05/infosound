'use client';
import { NavigationAction } from '@/components/navigation-action';
import { useI18n } from '@/components/locale-provider';
import { useQuery } from '@tanstack/react-query';
import { api, type List, type Track } from '@/lib/api';
import { useAuth, RecordVisual } from '@/components/providers';
import { Loading, ErrorState, Empty, TrackCards } from '@/components/common';
import { DiscoveryChart } from '@/components/discovery-catalog';
import { RecommendationsSection } from '@/components/recommendations';
import { TrendingArtistsSection } from '@/components/trending-artists';

export function Home() {
  const { t: tr } = useI18n();
  const { user, loading } = useAuth();
  const isAuthor = !loading && user?.role === 'AUTHOR';
  const result = useQuery({
    queryKey: ['tracks', 'latest', 'home'],
    queryFn: () => api<List<Track>>('/tracks?sort=latest&page=1&pageSize=5', { auth: false }),
  });
  return (
    <>
      <section className="discovery-intro">
        <div className="intro-copy">
          <span className="eyebrow">
            <span className="live-dot" />
            {tr('KHÔNG GIAN ÂM NHẠC ĐỘC LẬP')}
          </span>
          <h1>
            {tr('Tìm giai điệu.')}
            <br />
            <span>{tr('Chạm cảm xúc.')}</span>
          </h1>
          <p>
            {tr('Lắng nghe những âm thanh mới.')}
            <br />
            {tr('Kết nối với những người đứng sau giai điệu.')}
          </p>
          <NavigationAction href="/search">{tr('Tìm nhạc mới')}</NavigationAction>
        </div>
        <RecordVisual />
      </section>
      <DiscoveryChart />
      <RecommendationsSection />
      <section className="catalog-section" aria-labelledby="home-releases-title">
        <div className="section-heading">
          <div>
            <span className="eyebrow">{tr('NHỮNG GIAI ĐIỆU VỪA ĐẾN')}</span>
            <h2 id="home-releases-title">
              {tr('Mới phát hành')}
              <span className="heading-dot">.</span>
            </h2>
          </div>
          <NavigationAction
            href="/new-releases"
            aria-labelledby="home-releases-all home-releases-title"
          >
            <span id="home-releases-all">{tr('Xem tất cả')}</span>
          </NavigationAction>
        </div>
        {result.isPending ? (
          <Loading />
        ) : result.isError ? (
          <ErrorState error={result.error} retry={() => void result.refetch()} />
        ) : result.data.items.length ? (
          <TrackCards tracks={result.data.items.slice(0, 5)} />
        ) : (
          <Empty
            title={tr(
              isAuthor ? 'Giai điệu đầu tiên đang chờ được chia sẻ' : 'Chưa có bài hát công khai',
            )}
            description={tr(
              isAuthor
                ? 'InfoSound vừa mở cửa. Hãy trở thành nghệ sĩ đầu tiên tải lên và phát hành âm nhạc của mình.'
                : 'Bài hát sẽ xuất hiện sau khi nghệ sĩ hoàn tất xử lý và phát hành.',
            )}
            action={
              isAuthor ? (
                <NavigationAction href="/studio">{tr('Đến Author Studio')}</NavigationAction>
              ) : undefined
            }
          />
        )}
      </section>
      <TrendingArtistsSection />
    </>
  );
}
