import { db, Prisma } from '@infosound/database';
import { publicTrackWhere, trackInclude, viewTrack } from './helpers';
import type { Identity } from './security';

/** Enrich only the already-public, bounded artist page; never return ranking scores. */
export async function artistSpotlights(artistIds: string[], identity?: Identity) {
  if (!artistIds.length) return new Map();
  const [followers, relations, featured] = await Promise.all([
    db.artistFollow.groupBy({
      by: ['authorId'],
      where: { authorId: { in: artistIds } },
      _count: { _all: true },
    }),
    identity
      ? db.artistFollow.findMany({
          where: { userId: identity.id, authorId: { in: artistIds } },
          select: { authorId: true },
        })
      : [],
    db.$queryRaw<{ authorId: string; id: string }[]>`
      SELECT u.id AS "authorId", top_track.id
      FROM users u
      JOIN LATERAL (
        SELECT t.id FROM tracks t
        WHERE t.author_id=u.id AND t.publication_state='PUBLISHED'
          AND t.processing_state='READY' AND t.deleted_at IS NULL
        ORDER BY t.play_count DESC,t.published_at DESC NULLS LAST,t.id ASC
        LIMIT 1
      ) top_track ON true
      WHERE u.id IN (${Prisma.join(artistIds.map((id) => Prisma.sql`${id}::uuid`))})
        AND u.role='AUTHOR' AND u.active=true`,
  ]);
  // A track/artist may become private or inactive between selection and hydration.
  const tracks = await db.track.findMany({
    where: {
      id: { in: featured.map((item) => item.id) },
      ...publicTrackWhere,
      author: { role: 'AUTHOR', active: true },
    },
    include: trackInclude,
  });
  const counts = new Map(followers.map((item) => [item.authorId, item._count._all]));
  const following = new Set(relations.map((item) => item.authorId));
  const trackById = new Map(tracks.map((track) => [track.id, track]));
  const topByAuthor = new Map(featured.map((item) => [item.authorId, item.id]));
  return new Map(
    await Promise.all(
      artistIds.map(async (artistId) => {
        const topId = topByAuthor.get(artistId),
          track = topId ? trackById.get(topId) : undefined;
        return [
          artistId,
          {
            followerCount: counts.get(artistId) ?? 0,
            following: identity?.id !== artistId && following.has(artistId),
            topTrack:
              track && track.authorId === artistId ? await viewTrack(track, identity) : null,
          },
        ] as const;
      }),
    ),
  );
}
