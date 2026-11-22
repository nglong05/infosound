'use client';
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type Artist, type Track } from '@/lib/api';
import { useAuth } from './providers';
import { TrendingArtistCard } from './trending-artists';
import { Loading } from './common';

// Only nearby cards hydrate; bound outstanding profile reads per browser tab.
type WaitingRead = { signal: AbortSignal; start: () => void; abort: () => void };
const waiting: WaitingRead[] = [];
let activeReads = 0;
function nextRead() {
  while (activeReads < 4 && waiting.length) {
    const item = waiting.shift()!;
    item.signal.removeEventListener('abort', item.abort);
    if (item.signal.aborted) {
      item.abort();
      continue;
    }
    activeReads++;
    item.start();
  }
}
async function readArtist(id: string, signal: AbortSignal) {
  await new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const item: WaitingRead = {
      signal,
      start: resolve,
      abort: () => {
        const index = waiting.indexOf(item);
        if (index >= 0) waiting.splice(index, 1);
        reject(new DOMException('Aborted', 'AbortError'));
      },
    };
    waiting.push(item);
    signal.addEventListener('abort', item.abort, { once: true });
    nextRead();
  });
  try {
    return await api<Artist>('/artists/' + id, { auth: false, signal });
  } finally {
    activeReads--;
    nextRead();
  }
}

// The existing profile API exposes at most100 public tracks in release/ID order.
// The featured row selects from that bounded set; no global ranking is claimed.
function featuredTrack(artist: Artist): Track | null {
  return (artist.tracks ?? [])
    .filter(
      (track) =>
        track.authorId === artist.id &&
        track.processingState === 'READY' &&
        track.publicationState === 'PUBLISHED',
    )
    .reduce<Track | null>(
      (best, track) => (!best || (track.playCount ?? 0) > (best.playCount ?? 0) ? track : best),
      null,
    );
}

/** Preserve every followed artist; the shared grid wraps after five columns. */
export function FollowedArtists({ artists }: { artists: Artist[] }) {
  const { user, loading } = useAuth();
  if (loading || !user) return null;
  return (
    <ArtistCardGrid key={user.id} artists={artists} userId={user.id} scope="followed-library" />
  );
}
/** Search keeps its complete result order while reusing the same artist presentation. */
export function SearchArtists({ artists }: { artists: Artist[] }) {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  return (
    <ArtistCardGrid
      key={user?.id ?? 'visitor'}
      artists={artists}
      userId={user?.id}
      scope="search-results"
    />
  );
}
type ArtistCardScope = 'followed-library' | 'search-results';
function ArtistCardGrid({
  artists,
  userId,
  scope,
}: {
  artists: Artist[];
  userId?: string;
  scope: ArtistCardScope;
}) {
  return (
    <div
      className={
        'trending-artist-grid ' +
        (scope === 'followed-library' ? 'followed-artist-grid' : 'search-artist-grid')
      }
    >
      {artists.map((artist) => (
        <NearbyArtistCard key={artist.id} artist={artist} userId={userId} scope={scope} />
      ))}
    </div>
  );
}
function NearbyArtistCard({
  artist,
  userId,
  scope,
}: {
  artist: Artist;
  userId?: string;
  scope: ArtistCardScope;
}) {
  const host = useRef<HTMLDivElement>(null),
    [visible, setVisible] = useState(false);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => setVisible(entries.some((entry) => entry.isIntersecting)),
      { rootMargin: '200px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const details = useQuery({
    queryKey: ['artists', scope, 'profile', userId ?? 'visitor', artist.id],
    queryFn: ({ signal }) => readArtist(artist.id, signal),
    enabled: visible,
    staleTime: 30_000,
  });
  const value = details.data
    ? {
        ...artist,
        ...details.data,
        ...(scope === 'followed-library'
          ? { following: artist.following, subscribed: artist.subscribed }
          : {}),
        topTrack: featuredTrack(details.data),
      }
    : artist;
  return (
    <div
      ref={host}
      className={scope === 'followed-library' ? 'followed-artist-item' : 'search-artist-item'}
    >
      <TrendingArtistCard
        artist={value}
        userId={userId}
        relationKnown={scope === 'followed-library' || !!details.data}
        detailsPending={!details.data && !details.isError}
        detailsError={!details.data && details.isError}
        onRetry={() => void details.refetch()}
      />
    </div>
  );
}
