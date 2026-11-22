import { db, Prisma } from '@infosound/database';
import type { MusicPreferences } from './music-preferences';
import { publicTrackWhere } from './helpers';

export type RecommendationSelection = { ids: string[]; hasPreferences: boolean };
export type RecommendationSource = 'PREFERENCES' | 'LIKES' | 'POPULAR';

/** All preferences and scores remain inside one database statement/snapshot. */
export async function recommendationTrackIds(userId: string): Promise<RecommendationSelection> {
  const rows = await db.$queryRaw<{ id: string | null; hasPreferences: boolean }[]>`
    WITH preferences AS MATERIALIZED (
      SELECT tg.genre_id,count(DISTINCT liked.track_id) AS weight
      FROM track_likes liked
      JOIN tracks source ON source.id=liked.track_id
        AND source.publication_state='PUBLISHED' AND source.processing_state='READY' AND source.deleted_at IS NULL
      JOIN track_genres tg ON tg.track_id=source.id
      JOIN genres g ON g.id=tg.genre_id AND g.is_selectable=true
      WHERE liked.user_id=${userId}::uuid
      GROUP BY tg.genre_id
    ), ranked AS (
      SELECT candidate.id,candidate.published_at,max(p.weight) AS strongest_weight,
        sum(p.weight) AS total_weight,count(*) AS matched_genres
      FROM preferences p
      JOIN track_genres tg ON tg.genre_id=p.genre_id
      JOIN tracks candidate ON candidate.id=tg.track_id
        AND candidate.publication_state='PUBLISHED' AND candidate.processing_state='READY' AND candidate.deleted_at IS NULL
      WHERE NOT EXISTS (SELECT 1 FROM track_likes own_like WHERE own_like.user_id=${userId}::uuid AND own_like.track_id=candidate.id)
      GROUP BY candidate.id,candidate.published_at
    ), candidates AS (
      SELECT * FROM ranked
      ORDER BY strongest_weight DESC,total_weight DESC,matched_genres DESC,published_at DESC NULLS LAST,id ASC
      LIMIT 5
    )
    SELECT c.id,EXISTS (SELECT 1 FROM preferences) AS "hasPreferences"
    FROM (VALUES (1)) AS fallback(value)
    LEFT JOIN candidates c ON true
    ORDER BY c.strongest_weight DESC NULLS LAST,c.total_weight DESC NULLS LAST,c.matched_genres DESC NULLS LAST,c.published_at DESC NULLS LAST,c.id ASC`;
  return {
    ids: rows.flatMap((row) => (row.id ? [row.id] : [])),
    hasPreferences: rows[0]?.hasPreferences ?? false,
  };
}

/** Explicit choices match either an artist or a canonical genre; no scores leave SQL. */
export async function explicitRecommendationTrackIds(
  preferences: MusicPreferences,
  userId?: string,
): Promise<RecommendationSelection> {
  const genreArray = preferences.genreIds.length
    ? Prisma.sql`ARRAY[${Prisma.join(preferences.genreIds)}]::text[]`
    : Prisma.sql`ARRAY[]::text[]`;
  const artistArray = preferences.artistIds.length
    ? Prisma.sql`ARRAY[${Prisma.join(preferences.artistIds)}]::uuid[]`
    : Prisma.sql`ARRAY[]::uuid[]`;
  const excludeLiked = userId
    ? Prisma.sql`AND NOT EXISTS (SELECT 1 FROM track_likes liked WHERE liked.user_id=${userId}::uuid AND liked.track_id=candidate.id)`
    : Prisma.empty;
  const rows = await db.$queryRaw<{ id: string | null; hasPreferences: boolean }[]>`
    WITH selected_genres AS MATERIALIZED (
      SELECT id FROM genres WHERE is_selectable=true AND id=ANY(${genreArray})
    ), selected_artists AS MATERIALIZED (
      SELECT id FROM users WHERE role='AUTHOR' AND active=true AND id=ANY(${artistArray})
    ), matches AS (
      SELECT candidate.id,candidate.published_at,candidate.play_count,
        EXISTS (SELECT 1 FROM selected_artists WHERE id=candidate.author_id) AS artist_match,
        (SELECT count(*) FROM track_genres tg JOIN selected_genres g ON g.id=tg.genre_id WHERE tg.track_id=candidate.id) AS genre_matches
      FROM tracks candidate
      WHERE candidate.publication_state='PUBLISHED' AND candidate.processing_state='READY' AND candidate.deleted_at IS NULL
        ${excludeLiked}
    ), candidates AS (
      SELECT * FROM matches WHERE artist_match OR genre_matches>0
      ORDER BY (genre_matches+artist_match::integer) DESC,artist_match DESC,play_count DESC,published_at DESC NULLS LAST,id ASC
      LIMIT 5
    )
    SELECT candidate.id,(EXISTS (SELECT 1 FROM selected_genres) OR EXISTS (SELECT 1 FROM selected_artists)) AS "hasPreferences"
    FROM (VALUES (1)) AS fallback(value)
    LEFT JOIN candidates candidate ON true
    ORDER BY (candidate.genre_matches+candidate.artist_match::integer) DESC NULLS LAST,candidate.artist_match DESC NULLS LAST,
      candidate.play_count DESC NULLS LAST,candidate.published_at DESC NULLS LAST,candidate.id ASC`;
  return {
    ids: rows.flatMap((row) => (row.id ? [row.id] : [])),
    hasPreferences: rows[0]?.hasPreferences ?? false,
  };
}

export async function popularRecommendationTrackIds(): Promise<string[]> {
  const tracks = await db.track.findMany({
    where: publicTrackWhere,
    select: { id: true },
    orderBy: [{ playCount: 'desc' }, { publishedAt: 'desc' }, { id: 'asc' }],
    take: 5,
  });
  return tracks.map((track) => track.id);
}

export async function userRecommendationSelection(
  userId: string,
): Promise<{ ids: string[]; source: RecommendationSource }> {
  const stored = await db.musicPreference.findUnique({ where: { userId } });
  if (stored && (stored.genreIds.length || stored.artistIds.length)) {
    const explicit = await explicitRecommendationTrackIds(stored, userId);
    if (explicit.hasPreferences) return { ids: explicit.ids, source: 'PREFERENCES' };
  }
  const liked = await recommendationTrackIds(userId);
  if (liked.hasPreferences) return { ids: liked.ids, source: 'LIKES' };
  return { ids: await popularRecommendationTrackIds(), source: 'POPULAR' };
}

export async function previewRecommendationSelection(
  preferences: MusicPreferences,
): Promise<{ ids: string[]; source: RecommendationSource }> {
  const explicit = await explicitRecommendationTrackIds(preferences);
  return explicit.hasPreferences
    ? { ids: explicit.ids, source: 'PREFERENCES' }
    : { ids: await popularRecommendationTrackIds(), source: 'POPULAR' };
}
