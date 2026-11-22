'use client';
import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AppForm as Form } from '@/components/app-navigation';
import { useI18n } from '@/components/locale-provider';
import { useQuery } from '@tanstack/react-query';
import { api, type Track, type Artist, type Playlist } from '@/lib/api';
import {
  PageTitle,
  Loading,
  ErrorState,
  Empty,
  TrackCards,
  PlaylistCards,
} from '@/components/common';
import { Icon } from '@/components/icons';
import { SearchArtists } from '@/components/followed-artists';

export function Search() {
  const { t: tr } = useI18n();
  const params = useSearchParams();
  const q = params.get('q') || '';
  const [tab, setTab] = useState('tracks');
  const result = useQuery({
    queryKey: ['search', q],
    queryFn: () =>
      api<{ tracks: Track[]; artists: Artist[]; playlists: Playlist[] }>(
        '/search?q=' + encodeURIComponent(q),
        { auth: false },
      ),
  });
  return (
    <>
      <PageTitle
        eyebrow={tr('LUÔN CÓ ĐIỀU MỚI ĐỂ NGHE')}
        title={q ? tr('Kết quả cho “{query}”', { query: q }) : tr('Khám phá theo cách của bạn')}
        description={tr(
          'Nhập tên bài hát, nghệ sĩ, playlist hoặc một đoạn lời bạn nhớ. Hỗ trợ tìm tiếng Việt có và không dấu.',
        )}
      />
      <Form action="/search" className="search-form catalog-search">
        <label className="sr-only" htmlFor="search-query">
          {tr('Từ khóa tìm kiếm')}
        </label>
        <button
          className="catalog-search-submit"
          type="submit"
          aria-label={tr('Tìm kiếm')}
          title={tr('Tìm kiếm')}
        >
          <Icon name="search" />
        </button>
        <input
          id="search-query"
          name="q"
          defaultValue={q}
          key={q}
          placeholder={tr('Tìm bài hát, nghệ sĩ, playlist hoặc lời bài hát…')}
          maxLength={120}
        />
      </Form>
      <div className="tabs" role="tablist" aria-label={tr('Loại kết quả')}>
        {[
          ['tracks', tr('Bài hát')],
          ['artists', tr('Nghệ sĩ')],
          ['playlists', tr('Playlist')],
        ].map(([key, label]) => (
          <button
            key={key}
            role="tab"
            id={'tab-' + key}
            aria-selected={tab === key}
            aria-controls={'panel-' + key}
            onClick={() => setTab(key)}
            className={tab === key ? 'active' : ''}
          >
            {label}
            <span>{result.data?.[key as 'tracks' | 'artists' | 'playlists'].length ?? '—'}</span>
          </button>
        ))}
      </div>
      <section role="tabpanel" id={'panel-' + tab} aria-labelledby={'tab-' + tab}>
        {result.isPending ? (
          <Loading />
        ) : result.isError ? (
          <ErrorState error={result.error} retry={() => void result.refetch()} />
        ) : tab === 'tracks' ? (
          result.data.tracks.length ? (
            <TrackCards tracks={result.data.tracks} />
          ) : (
            <Empty
              title={tr('Chưa tìm thấy bài hát')}
              description={tr(
                'Thử một từ khóa khác hoặc quay lại sau khi nghệ sĩ phát hành bài mới.',
              )}
            />
          )
        ) : tab === 'artists' ? (
          result.data.artists.length ? (
            <SearchArtists artists={result.data.artists} />
          ) : (
            <Empty
              title={tr('Chưa tìm thấy nghệ sĩ')}
              description={tr('Thử tìm theo tên hiển thị của nghệ sĩ.')}
              icon="user"
            />
          )
        ) : result.data.playlists.length ? (
          <PlaylistCards playlists={result.data.playlists} />
        ) : (
          <Empty
            title={tr('Chưa tìm thấy playlist công khai')}
            description={tr('Các playlist riêng tư chỉ được hiển thị với chủ sở hữu.')}
            icon="playlist"
          />
        )}
      </section>
    </>
  );
}
