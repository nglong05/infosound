'use client';
import { useI18n } from '@/components/locale-provider';
import { useState } from 'react';
import Link from '@/components/app-navigation';
import { NavigationAction } from '@/components/navigation-action';
import { useQuery } from '@tanstack/react-query';
import { api, time, type Track, type List } from '@/lib/api';
import { Icon } from '@/components/icons';
import { GenreTags } from '@/components/genre-tags';
import { PageTitle, Loading, ErrorState, Empty, Artwork } from '@/components/common';
import { stateLabels } from '@/features/studio/state-labels';

export function StudioList() {
  const { t: translate } = useI18n();
  const [filter, setFilter] = useState('ALL');
  const query = useQuery({
    queryKey: ['studio', filter],
    queryFn: () =>
      api<List<Track>>('/studio/tracks' + (filter === 'ALL' ? '' : '?state=' + filter)),
    refetchInterval: 5000,
  });
  return (
    <div className="studio-page studio-list-page">
      <PageTitle
        eyebrow={translate('AUTHOR STUDIO')}
        title={translate('Âm thanh của bạn. Sân khấu của bạn.')}
        description={translate(
          'Từ bản nháp đầu tiên đến khoảnh khắc phát hành. Quản lý tất cả tại đây.',
        )}
        action={
          <NavigationAction href="/studio/tracks/new">
            {translate('Tải bài hát lên')}
          </NavigationAction>
        }
      />
      <div className="studio-guide">
        <span className="step-number">01</span>
        <span>{translate('Tải tệp')}</span>
        <Icon name="arrow" size={16} />
        <span className="step-number">02</span>
        <span>{translate('Xử lý & kiểm tra')}</span>
        <Icon name="arrow" size={16} />
        <span className="step-number">03</span>
        <span>{translate('Chủ động phát hành')}</span>
      </div>
      <div className="section-heading">
        <h2>{translate('Bài hát của bạn')}</h2>
        <label className="filter-label">
          {translate('Trạng thái')}
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="ALL">{translate('Tất cả')}</option>
            {['DRAFT', 'QUEUED', 'PROCESSING', 'READY', 'FAILED'].map((state) => (
              <option value={state} key={state}>
                {translate(stateLabels[state])}
              </option>
            ))}
          </select>
        </label>
      </div>
      {query.isPending ? (
        <Loading />
      ) : query.isError ? (
        <ErrorState error={query.error} retry={() => void query.refetch()} />
      ) : query.data.items.length ? (
        <div className="studio-list">
          {query.data.items.map((t) => (
            <Link key={t.id} href={'/studio/tracks/' + t.id} className="studio-row">
              <div className="studio-thumb">
                <Artwork track={t} />
              </div>
              <div className="studio-track-title">
                <h3>{t.title}</h3>
                <p className="studio-genre-summary">
                  <GenreTags
                    genres={t.genres}
                    legacyGenre={t.genre}
                    fallback={translate('Chưa có thể loại')}
                  />
                  <span>· {time(t.duration)}</span>
                </p>
              </div>
              <span className={'status ' + t.processingState.toLowerCase()}>
                {translate(stateLabels[t.processingState] || t.processingState)}
              </span>
              <span className="publication">
                {translate(stateLabels[t.publicationState] || 'Chưa phát hành')}
              </span>
              <Icon name="arrow" />
            </Link>
          ))}
        </div>
      ) : (
        <Empty
          title={translate('Để thế giới nghe âm thanh của bạn')}
          description={translate(
            'Tải lên bản thu đầu tiên. Bài hát chỉ xuất hiện công khai sau khi bạn chủ động phát hành.',
          )}
          action={
            <NavigationAction href="/studio/tracks/new">
              {translate('Tải bài hát đầu tiên')}
            </NavigationAction>
          }
        />
      )}
      <p className="muted small studio-note">
        {translate(
          'Sẵn sàng xử lý (READY) và đã phát hành (PUBLISHED) là hai trạng thái riêng biệt. Bạn quyết định khi nào bài hát được chia sẻ.',
        )}
      </p>
    </div>
  );
}
