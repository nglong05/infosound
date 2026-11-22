import { db } from '@infosound/database';

/** Rank only public, playable songs. Aggregate values stay private to this query. */
export async function popularArtistIds(take: number, skip: number): Promise<string[]> {
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT u.id
    FROM users u
    LEFT JOIN tracks t ON t.author_id=u.id
      AND t.publication_state='PUBLISHED' AND t.processing_state='READY' AND t.deleted_at IS NULL
    WHERE u.role='AUTHOR' AND u.active=true
    GROUP BY u.id
    ORDER BY coalesce(sum(t.play_count),0) DESC,max(t.published_at) DESC NULLS LAST,u.id ASC
    LIMIT ${take} OFFSET ${skip}`;
  return rows.map((row) => row.id);
}
