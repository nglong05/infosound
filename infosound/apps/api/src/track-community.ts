import { BadRequestException, NotFoundException } from '@nestjs/common';
import { db, Prisma } from '@infosound/database';
import { z } from 'zod';
import {
  conflict,
  publicAuthorSelect,
  publicTrackWhere,
  trackInclude,
  validate,
  viewTrack,
} from './helpers';
import type { Identity } from './security';
import { withAvatar } from './user-view';
import { moderation } from './moderation.controller';

const commentUserSelect = {
  id: true,
  displayName: true,
  role: true,
  avatarKey: true,
  avatarVersionId: true,
} as const;
const visibleComment = { moderationStatus: 'VISIBLE', deletedAt: null } as const;
const commentInclude = {
  user: { select: commentUserSelect },
  _count: {
    select: { likes: true, replies: { where: { ...visibleComment, user: { active: true } } } },
  },
} satisfies Prisma.TrackCommentInclude;
type IncludedComment = Prisma.TrackCommentGetPayload<{ include: typeof commentInclude }>;
type PublicTrack = { id: string; sourceVersion: number; duration: number | null; authorId: string };
const publicCommunityWhere = {
  ...publicTrackWhere,
  author: { active: true, role: 'AUTHOR' as const },
};
export const commentInput = z
  .object({
    body: z
      .string()
      .min(1)
      .refine(
        (value) =>
          value.trim().length > 0 && [...value].length <= moderation.config.maxCommentChars,
      )
      .refine((value) => !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)),
    sourceVersion: z.number().int().min(1).max(2147483647),
    atSeconds: z.number().finite().min(0).max(900),
    parentId: z.string().uuid().optional(),
  })
  .strict();
const pageInput = z
  .object({
    page: z.coerce.number().int().min(1).max(10000).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();
export function commentPage(query: unknown) {
  const { page, pageSize } = validate(pageInput, query);
  return { page, pageSize, take: pageSize, skip: (page - 1) * pageSize };
}

async function publicTrack(
  client: Prisma.TransactionClient,
  trackId: string,
  lock = false,
): Promise<PublicTrack> {
  if (lock) await client.$queryRaw`SELECT id FROM tracks WHERE id=${trackId}::uuid FOR SHARE`;
  const track = await client.track.findFirst({
    where: { id: trackId, ...publicCommunityWhere },
    select: { id: true, sourceVersion: true, duration: true, authorId: true },
  });
  if (!track)
    throw new NotFoundException({
      code: 'TRACK_UNAVAILABLE',
      message: 'Bài hát hiện không khả dụng.',
    });
  return track;
}
async function recheck(track: PublicTrack) {
  if (
    !(await db.track.findFirst({
      where: { id: track.id, sourceVersion: track.sourceVersion, ...publicCommunityWhere },
      select: { id: true },
    }))
  )
    throw new NotFoundException({
      code: 'TRACK_UNAVAILABLE',
      message: 'Bài hát hiện không khả dụng.',
    });
}
async function projectComments(
  comments: IncludedComment[],
  identity?: Identity,
  trackAuthorId?: string,
) {
  const mine =
    identity && comments.length
      ? await db.trackCommentLike.findMany({
          where: { userId: identity.id, commentId: { in: comments.map((comment) => comment.id) } },
          select: { commentId: true },
        })
      : [];
  const liked = new Set(mine.map((item) => item.commentId));
  return Promise.all(
    comments.map(async (comment) => ({
      id: comment.id,
      body: comment.body,
      atSeconds: comment.atSeconds,
      sourceVersion: comment.sourceVersion,
      parentId: comment.parentId,
      createdAt: comment.createdAt,
      user: await withAvatar(comment.user),
      likeCount: comment._count.likes,
      liked: liked.has(comment.id),
      replyCount: comment._count.replies,
      canDelete:
        !!identity &&
        (identity.id === comment.userId ||
          (identity.role === 'AUTHOR' && identity.id === trackAuthorId)),
    })),
  );
}

export async function commentsForTrack(
  trackId: string,
  query: unknown,
  identity?: Identity,
  parentId?: string,
) {
  const { page, pageSize, take, skip } = commentPage(query);
  const result = await db.$transaction(
    async (tx) => {
      const track = await publicTrack(tx, trackId);
      if (
        parentId &&
        !(await tx.trackComment.findFirst({
          where: {
            id: parentId,
            trackId,
            sourceVersion: track.sourceVersion,
            parentId: null,
            ...visibleComment,
            user: { active: true },
          },
          select: { id: true },
        }))
      )
        throw new NotFoundException({
          code: 'COMMENT_NOT_FOUND',
          message: 'Bình luận không còn khả dụng.',
        });
      const where = {
        trackId,
        sourceVersion: track.sourceVersion,
        parentId: parentId ?? null,
        ...visibleComment,
        user: { active: true },
      };
      const [comments, total] = await Promise.all([
        tx.trackComment.findMany({
          where,
          include: commentInclude,
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          take,
          skip,
        }),
        tx.trackComment.count({ where }),
      ]);
      return { track, comments, total };
    },
    { isolationLevel: 'RepeatableRead' },
  );
  const items = await projectComments(result.comments, identity, result.track.authorId);
  await recheck(result.track);
  return { items, total: result.total, page, pageSize, sourceVersion: result.track.sourceVersion };
}

export async function markersForTrack(trackId: string, identity?: Identity) {
  const result = await db.$transaction(
    async (tx) => {
      const track = await publicTrack(tx, trackId);
      const where = {
        trackId,
        sourceVersion: track.sourceVersion,
        parentId: null,
        ...visibleComment,
        user: { active: true },
      };
      const total = await tx.trackComment.count({ where });
      if (total <= 200)
        return {
          track,
          total,
          comments: await tx.trackComment.findMany({
            where,
            include: commentInclude,
            orderBy: [{ atSeconds: 'asc' }, { id: 'asc' }],
            take: 200,
          }),
        };
      // For busy recordings, one newest root comment per time bucket covers the
      // whole recording while bounding payload/DOM work; small lists retain all.
      const ids = await tx.$queryRaw<{ id: string }[]>`
      SELECT chosen.id FROM (
        SELECT DISTINCT ON (least(199,floor(c.at_seconds/greatest(coalesce(t.duration,1),1)*200))) c.id,c.at_seconds
        FROM track_comments c JOIN users u ON u.id=c.user_id JOIN tracks t ON t.id=c.track_id
        WHERE c.track_id=${trackId}::uuid AND c.source_version=${track.sourceVersion}
          AND c.parent_id IS NULL AND u.active=true AND c.moderation_status='VISIBLE' AND c.deleted_at IS NULL
        ORDER BY least(199,floor(c.at_seconds/greatest(coalesce(t.duration,1),1)*200)),c.created_at DESC,c.id ASC
      ) chosen ORDER BY chosen.at_seconds,chosen.id LIMIT 200`;
      const comments = await tx.trackComment.findMany({
        where: { ...where, id: { in: ids.map((item) => item.id) } },
        include: commentInclude,
        orderBy: [{ atSeconds: 'asc' }, { id: 'asc' }],
      });
      return { track, comments, total };
    },
    { isolationLevel: 'RepeatableRead' },
  );
  const items = await projectComments(result.comments, identity, result.track.authorId);
  await recheck(result.track);
  return {
    items,
    total: result.total,
    sourceVersion: result.track.sourceVersion,
    truncated: result.total > items.length,
  };
}

export async function createTrackComment(
  trackId: string,
  identity: Identity,
  input: z.infer<typeof commentInput>,
) {
  const stored = await db.$transaction(async (tx) => {
    const track = await publicTrack(tx, trackId, true);
    await moderation.lockTrack(tx, track.id);
    await moderation.rateLimit(tx, identity.id);
    if (track.sourceVersion !== input.sourceVersion)
      conflict('SOURCE_VERSION_CHANGED', 'Nguồn âm thanh đã thay đổi. Hãy tải lại bài hát.');
    if (
      track.duration === null ||
      !Number.isFinite(track.duration) ||
      track.duration <= 0 ||
      input.atSeconds > track.duration
    )
      throw new BadRequestException({
        code: 'COMMENT_TIMING_INVALID',
        message: 'Mốc bình luận vượt quá thời lượng bài hát.',
      });
    let atSeconds = Math.round(input.atSeconds * 1000) / 1000;
    if (atSeconds > track.duration) atSeconds = track.duration;
    if (input.parentId) {
      await tx.$queryRaw`SELECT id FROM track_comments WHERE id=${input.parentId}::uuid FOR UPDATE`;
      const parent = await tx.trackComment.findFirst({
        where: {
          id: input.parentId,
          trackId,
          sourceVersion: track.sourceVersion,
          parentId: null,
          ...visibleComment,
          user: { active: true },
        },
        select: { id: true, atSeconds: true },
      });
      if (!parent)
        throw new NotFoundException({
          code: 'COMMENT_NOT_FOUND',
          message: 'Bình luận không còn khả dụng.',
        });
      atSeconds = parent.atSeconds;
    }
    const comment = await tx.trackComment.create({
      data: {
        trackId,
        userId: identity.id,
        sourceVersion: track.sourceVersion,
        body: input.body,
        atSeconds,
        parentId: input.parentId ?? null,
        moderationStatus: 'PENDING',
        decisionSource: 'SYSTEM',
      },
      include: commentInclude,
    });
    await moderation.enqueue(tx, comment.id);
    return tx.trackComment.findUniqueOrThrow({
      where: { id: comment.id },
      include: commentInclude,
    });
  });
  return {
    ...(await projectComments([stored], identity))[0],
    status: stored.moderationStatus,
    contentVersion: stored.contentVersion,
    moderationRevision: stored.moderationRevision,
  };
}

export async function likeTrackComment(
  trackId: string,
  commentId: string,
  identity: Identity,
  liked: boolean,
) {
  return db.$transaction(async (tx) => {
    const track = await publicTrack(tx, trackId, true);
    const comment = await tx.trackComment.findFirst({
      where: {
        id: commentId,
        trackId,
        sourceVersion: track.sourceVersion,
        ...visibleComment,
        user: { active: true },
        OR: [{ parentId: null }, { parent: { ...visibleComment, user: { active: true } } }],
      },
      select: { id: true },
    });
    if (!comment)
      throw new NotFoundException({
        code: 'COMMENT_NOT_FOUND',
        message: 'Bình luận không còn khả dụng.',
      });
    if (liked)
      await tx.trackCommentLike.createMany({
        data: [{ userId: identity.id, commentId }],
        skipDuplicates: true,
      });
    else await tx.trackCommentLike.deleteMany({ where: { userId: identity.id, commentId } });
    return { liked, likeCount: await tx.trackCommentLike.count({ where: { commentId } }) };
  });
}

export async function trackCommunity(trackId: string, identity?: Identity) {
  const result = await db.$transaction(
    async (tx) => {
      const track = await publicTrack(tx, trackId);
      const artist = await tx.user.findFirstOrThrow({
        where: { id: track.authorId, role: 'AUTHOR', active: true },
        select: publicAuthorSelect,
      });
      const songWhere = { authorId: track.authorId, ...publicTrackWhere };
      const [followerCount, relation, stats, likeCount, fans, related] = await Promise.all([
        tx.artistFollow.count({ where: { authorId: track.authorId } }),
        identity
          ? tx.artistFollow.findUnique({
              where: { userId_authorId: { userId: identity.id, authorId: track.authorId } },
              select: { authorId: true },
            })
          : null,
        tx.track.aggregate({ where: songWhere, _count: true, _sum: { playCount: true } }),
        tx.trackLike.count({ where: { track: songWhere } }),
        tx.trackListen.findMany({
          where: { trackId, user: { active: true } },
          select: { qualifiedPlays: true, user: { select: commentUserSelect } },
          orderBy: [{ qualifiedPlays: 'desc' }, { lastCountedAt: 'desc' }, { userId: 'asc' }],
          take: 3,
        }),
        tx.track.findMany({
          where: { ...songWhere, id: { not: trackId } },
          include: trackInclude,
          orderBy: [
            { playCount: 'desc' },
            { publishedAt: { sort: 'desc', nulls: 'last' } },
            { id: 'asc' },
          ],
          take: 3,
        }),
      ]);
      return {
        track,
        artist,
        followerCount,
        following: !!relation && identity?.id !== track.authorId,
        stats,
        likeCount,
        fans,
        related,
      };
    },
    { isolationLevel: 'RepeatableRead' },
  );
  // Hydrate through current public filters, so a recently hidden related track
  // cannot regain visibility through an earlier snapshot.
  const related = await db.track.findMany({
    where: { id: { in: result.related.map((track) => track.id) }, ...publicCommunityWhere },
    include: trackInclude,
  });
  const byId = new Map(related.map((track) => [track.id, track]));
  const [artist, fans, relatedTracks] = await Promise.all([
    withAvatar(result.artist),
    Promise.all(
      result.fans.map(async (fan) => ({
        user: await withAvatar(fan.user),
        playCount: fan.qualifiedPlays,
      })),
    ),
    Promise.all(
      result.related.flatMap((track) => {
        const current = byId.get(track.id);
        return current ? [viewTrack(current, identity)] : [];
      }),
    ),
  ]);
  await recheck(result.track);
  return {
    sourceVersion: result.track.sourceVersion,
    artist: {
      ...artist,
      followerCount: result.followerCount,
      following: result.following,
      trackCount: result.stats._count,
      playCount: result.stats._sum.playCount ?? 0,
      likeCount: result.likeCount,
    },
    fans: { items: fans, historicalCountsLimited: true },
    relatedTracks,
  };
}
