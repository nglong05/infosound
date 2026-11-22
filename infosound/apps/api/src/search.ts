import { ServiceUnavailableException } from '@nestjs/common';
import { db, Prisma } from '@infosound/database';

export type SearchTrackHit = { id: string; searchMatch: 'title' | 'lyrics'; sourceVersion: number };

/** Escape SQL LIKE metacharacters; values still travel as query parameters. */
export function containsPattern(value: string): string {
  return `%${value.replace(/[\\%_]/g, '\\$&')}%`;
}

export async function searchTrackIds(
  term: string,
  take: number,
  skip: number,
): Promise<SearchTrackHit[]> {
  const pattern = containsPattern(term);
  try {
    return await db.$transaction(
      async (tx) => {
        // LOCAL settings cannot leak into subsequent requests on the pooled connection.
        await tx.$executeRaw`SET LOCAL pg_trgm.word_similarity_threshold = '0.55'`;
        await tx.$executeRaw`SET LOCAL statement_timeout = '2500ms'`;
        return tx.$queryRaw<SearchTrackHit[]>`
        WITH query AS MATERIALIZED (
          SELECT public.infosound_search_normalize(${term}) AS text
        ), matches AS (
          SELECT t.id,t.source_version,t.published_at,'title'::text AS kind,
            CASE WHEN public.infosound_unaccent(lower(t.title))=public.infosound_unaccent(lower(${term})) THEN 0 ELSE 1 END AS tier,
            1::real AS score
          FROM tracks t
          WHERE t.publication_state='PUBLISHED' AND t.processing_state='READY' AND t.deleted_at IS NULL
            AND public.infosound_unaccent(lower(t.title)) LIKE public.infosound_unaccent(lower(${pattern}))
          UNION ALL
          SELECT t.id,t.source_version,t.published_at,'lyrics'::text AS kind,
            CASE WHEN l.search_text LIKE '%' || query.text || '%' THEN 2 ELSE 3 END AS tier,
            public.word_similarity(query.text,l.search_text) AS score
          FROM track_lyrics l
          JOIN tracks t ON t.id=l.track_id AND t.source_version=l.source_version
          CROSS JOIN query
          WHERE t.publication_state='PUBLISHED' AND t.processing_state='READY' AND t.deleted_at IS NULL
            AND length(query.text)>=3
            AND (l.search_text LIKE '%' || query.text || '%'
              OR (length(query.text)>=5 AND l.search_text %> query.text))
        ), best AS (
          SELECT DISTINCT ON (id) id,source_version,published_at,kind,tier,score
          FROM matches ORDER BY id,tier,score DESC
        )
        SELECT id,kind AS "searchMatch",source_version AS "sourceVersion"
        FROM best ORDER BY tier,score DESC,published_at DESC NULLS LAST,id
        LIMIT ${take} OFFSET ${skip}`;
      },
      { maxWait: 2000, timeout: 5000 },
    );
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === 'P2028' ||
        error.code === 'P2024' ||
        (error.code === 'P2010' && error.meta?.code === '57014'))
    ) {
      throw new ServiceUnavailableException({
        code: 'SEARCH_BUSY',
        message: 'Tìm kiếm đang bận. Vui lòng thử lại.',
      });
    }
    throw error;
  }
}
