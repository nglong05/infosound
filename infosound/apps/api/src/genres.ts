import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@infosound/database';

export type GenreSelection = { id: string; name: string };
type GenreInput = { genre?: string; genreIds?: string[] };
const unavailable = () =>
  new BadRequestException({
    code: 'GENRE_NOT_AVAILABLE',
    message: 'Một số thể loại không còn khả dụng. Hãy chọn lại.',
  });

/** Caller validates the contract and locks the owned track before preserving legacy IDs. */
export async function resolveGenreSelection(
  tx: Prisma.TransactionClient,
  input: GenreInput,
  trackId?: string,
): Promise<GenreSelection[] | undefined> {
  if (input.genreIds !== undefined) {
    const rows = await tx.genre.findMany({
      where: {
        id: { in: input.genreIds },
        OR: [{ isSelectable: true }, ...(trackId ? [{ tracks: { some: { trackId } } }] : [])],
      },
      select: { id: true, name: true },
    });
    if (rows.length !== input.genreIds.length) throw unavailable();
    const byId = new Map(rows.map((row) => [row.id, row]));
    return input.genreIds.map((id) => byId.get(id)!);
  }
  if (input.genre === undefined) return undefined;
  // The database owns the same conservative aliases/composite rules used during backfill.
  const [resolved] = await tx.$queryRaw<
    { ids: string[] }[]
  >`SELECT public.infosound_resolve_legacy_genre(${input.genre}) AS ids`;
  const ids = resolved?.ids ?? [];
  if (ids.length === 1 && ids[0]!.startsWith('legacy-')) {
    const label = input.genre.replace(/^[\t\n\v\f\r ]+|[\t\n\v\f\r ]+$/g, '');
    await tx.genre.createMany({
      data: [{ id: ids[0]!, name: label, aliases: [], isSelectable: false, sortOrder: 10000 }],
      skipDuplicates: true,
    });
    const existing = await tx.genre.findUnique({
      where: { id: ids[0]! },
      select: { name: true, isSelectable: true },
    });
    if (!existing || existing.name !== label || existing.isSelectable) throw unavailable();
  }
  const rows = await tx.genre.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true },
  });
  if (rows.length !== ids.length) throw unavailable();
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.map((id) => byId.get(id)!);
}

export const genreProjection = (genres: readonly GenreSelection[]) =>
  genres.map((genre) => genre.name).join(', ');

export async function replaceTrackGenres(
  tx: Prisma.TransactionClient,
  trackId: string,
  genres: readonly GenreSelection[],
) {
  await tx.trackGenre.deleteMany({ where: { trackId } });
  if (genres.length)
    await tx.trackGenre.createMany({
      data: genres.map((genre, position) => ({ trackId, genreId: genre.id, position })),
    });
}
