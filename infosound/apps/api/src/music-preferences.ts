import { BadRequestException } from '@nestjs/common';
import { db } from '@infosound/database';
import { z } from 'zod';
import { validate } from './helpers';

export const musicPreferencesSchema = z
  .object({
    genreIds: z.array(z.string().min(1).max(100)).max(50),
    artistIds: z
      .array(
        z
          .string()
          .uuid()
          .transform((value) => value.toLowerCase()),
      )
      .max(50),
  })
  .strict();
export type MusicPreferences = z.infer<typeof musicPreferencesSchema>;

export function readMusicPreferences(body: unknown): MusicPreferences {
  const value = validate(musicPreferencesSchema, body);
  return { genreIds: [...new Set(value.genreIds)], artistIds: [...new Set(value.artistIds)] };
}

/** Arrays contain catalog IDs only; stale catalog entries are removed on every read. */
export async function availableMusicPreferences(
  value: MusicPreferences,
): Promise<MusicPreferences> {
  const [genres, artists] = await Promise.all([
    db.genre.findMany({
      where: { id: { in: value.genreIds }, isSelectable: true },
      select: { id: true },
    }),
    db.user.findMany({
      where: { id: { in: value.artistIds }, role: 'AUTHOR', active: true },
      select: { id: true },
    }),
  ]);
  const genreIds = new Set(genres.map((item) => item.id)),
    artistIds = new Set(artists.map((item) => item.id));
  return {
    genreIds: value.genreIds.filter((id) => genreIds.has(id)),
    artistIds: value.artistIds.filter((id) => artistIds.has(id)),
  };
}

export async function validateMusicPreferences(body: unknown): Promise<MusicPreferences> {
  const value = readMusicPreferences(body),
    available = await availableMusicPreferences(value);
  if (
    available.genreIds.length !== value.genreIds.length ||
    available.artistIds.length !== value.artistIds.length
  ) {
    throw new BadRequestException({
      code: 'VALIDATION_FAILED',
      message: 'Một số lựa chọn không còn khả dụng. Hãy chọn lại.',
    });
  }
  return value;
}

export async function hasLikedGenrePreferences(userId: string): Promise<boolean> {
  const rows = await db.$queryRaw<{ value: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM track_likes liked
      JOIN tracks source ON source.id=liked.track_id AND source.publication_state='PUBLISHED'
        AND source.processing_state='READY' AND source.deleted_at IS NULL
      JOIN track_genres tg ON tg.track_id=source.id
      JOIN genres g ON g.id=tg.genre_id AND g.is_selectable=true
      WHERE liked.user_id=${userId}::uuid
    ) AS value`;
  return rows[0]?.value ?? false;
}

export async function musicPreferencesView(userId: string) {
  const [stored, hasLikedPreferences] = await Promise.all([
    db.musicPreference.findUnique({ where: { userId } }),
    hasLikedGenrePreferences(userId),
  ]);
  const available = stored
    ? await availableMusicPreferences(stored)
    : { genreIds: [], artistIds: [] };
  const status = !stored
    ? ('NEW' as const)
    : stored.genreIds.length || stored.artistIds.length
      ? ('SAVED' as const)
      : ('SKIPPED' as const);
  return { ...available, status, hasLikedPreferences };
}
