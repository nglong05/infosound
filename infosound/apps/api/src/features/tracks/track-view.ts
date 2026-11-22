import { db, Prisma } from '@infosound/database';
import { mediaUrl } from '@infosound/storage';
import type { Identity } from '../../security';
import { withAvatar } from '../../user-view';

export const publicTrackWhere = {
  publicationState: 'PUBLISHED' as const,
  processingState: 'READY' as const,
  deletedAt: null,
};
export const publicAuthorSelect = {
  id: true,
  displayName: true,
  bio: true,
  role: true,
  avatarKey: true,
  avatarVersionId: true,
} as const;
export const trackInclude = {
  author: { select: publicAuthorSelect },
  genres: {
    include: { genre: { select: { id: true, name: true } } },
    orderBy: { position: 'asc' as const },
  },
  _count: { select: { likes: true } },
} satisfies Prisma.TrackInclude;
export type IncludedTrack = Prisma.TrackGetPayload<{ include: typeof trackInclude }>;
export async function viewTrack(track: IncludedTrack, identity?: Identity, force = false) {
  const available =
    track.deletedAt === null &&
    track.processingState === 'READY' &&
    track.publicationState === 'PUBLISHED';
  if (!available && !force && track.authorId !== identity?.id)
    return { id: track.id, title: 'Bài hát không khả dụng', available: false };
  let coverUrl: string | null = null;
  if (track.artworkAssetId) {
    const art = await db.trackAsset.findUnique({ where: { id: track.artworkAssetId } });
    if (art) coverUrl = await mediaUrl(art.bucket, art.key, { versionId: art.versionId });
  }
  const liked = identity
    ? !!(await db.trackLike.findUnique({
        where: { userId_trackId: { userId: identity.id, trackId: track.id } },
        select: { trackId: true },
      }))
    : false;
  const genres = track.genres.map((item) => item.genre);
  return {
    id: track.id,
    title: track.title,
    description: track.description,
    genres,
    genre: genres.map((item) => item.name).join(', '),
    authorId: track.authorId,
    author: await withAvatar(track.author),
    downloadEnabled: track.downloadEnabled,
    processingState: track.processingState,
    publicationState: track.publicationState,
    sourceVersion: track.sourceVersion,
    duration: track.duration,
    sampleRate: track.sampleRate,
    bitDepth: track.bitDepth,
    channels: track.channels,
    sourceCodec: track.sourceCodec,
    outputCodec: track.outputCodec,
    lossyTranscode: track.lossyTranscode,
    provenance: track.provenance,
    createdAt: track.createdAt,
    publishedAt: track.publishedAt,
    coverUrl,
    playCount: track.playCount,
    likeCount: track._count.likes,
    liked,
    available,
  };
}
