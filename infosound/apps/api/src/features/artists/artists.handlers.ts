import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { playlistBody, orderBody, fullTrackView } from '../../openapi';
import { db, Prisma } from '@infosound/database';
import { playlistSchema, playlistUpdateSchema, orderSchema } from '@infosound/contracts';
import { Current, Identity, Public } from '../../security';
import {
  conflict,
  pagination,
  publicAuthorSelect,
  publicTrackWhere,
  trackInclude,
  uuid,
  validate,
  viewTrack,
} from '../../helpers';
import { withAvatar } from '../../user-view';
import { containsPattern, searchTrackIds } from '../../search';
import { popularArtistIds } from '../../artist-ranking';
import { artistSpotlights } from '../../artist-spotlight';
import {
  listModerationNotificationPage,
  projectCommentNotification,
  readModerationNotification,
} from '@infosound/comment-moderation/server';

export class ArtistHandlers {
  async artists(
    query: { page?: string; pageSize?: string; sort?: string; include?: string },
    user?: Identity,
  ) {
    const { page, pageSize, take, skip } = pagination(query);
    const sort = validate(z.enum(['latest', 'popular']), query.sort ?? 'latest');
    const include = validate(z.enum(['spotlight']).optional(), query.include);
    const project = async (
      items: Prisma.UserGetPayload<{ select: typeof publicAuthorSelect }>[],
    ) => {
      const details =
        include === 'spotlight'
          ? await artistSpotlights(
              items.map((item) => item.id),
              user,
            )
          : null;
      return Promise.all(
        items.map(async (item) => ({
          ...(await withAvatar(item)),
          ...(details?.get(item.id) ?? {}),
        })),
      );
    };
    const where = { role: 'AUTHOR' as const, active: true };
    if (sort === 'latest') {
      const [items, total] = await Promise.all([
        db.user.findMany({
          where,
          select: publicAuthorSelect,
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          skip,
          take,
        }),
        db.user.count({ where }),
      ]);
      return { items: await project(items), total, page, pageSize };
    }
    const [ids, total] = await Promise.all([
      popularArtistIds(take, skip),
      db.user.count({ where }),
    ]);
    // Hydration preserves SQL rank and rechecks public artist eligibility after the aggregate query.
    const items = await db.user.findMany({
      where: { ...where, id: { in: ids } },
      select: publicAuthorSelect,
    });
    const byId = new Map(items.map((item) => [item.id, item]));
    return {
      items: await project(
        ids.flatMap((id) => {
          const item = byId.get(id);
          return item ? [item] : [];
        }),
      ),
      total,
      page,
      pageSize,
    };
  }
  async artist(id: string, user?: Identity) {
    return this.publicProfile(id, user, true);
  }
  async profile(id: string, user?: Identity) {
    return this.publicProfile(id, user, false);
  }
  private async publicProfile(id: string, user: Identity | undefined, authorOnly: boolean) {
    const author = await db.user.findFirst({
      where: { id: uuid(id), active: true, ...(authorOnly ? { role: 'AUTHOR' as const } : {}) },
      select: publicAuthorSelect,
    });
    if (!author) throw new NotFoundException({ code: 'PROFILE_NOT_FOUND' });
    const [tracks, followers, relation] = await Promise.all([
      db.track.findMany({
        where: { authorId: id, ...publicTrackWhere },
        include: trackInclude,
        orderBy: [{ publishedAt: 'desc' }, { id: 'asc' }],
        take: 100,
      }),
      db.artistFollow.count({ where: { authorId: id } }),
      user
        ? db.artistFollow.findUnique({
            where: { userId_authorId: { userId: user.id, authorId: id } },
          })
        : null,
    ]);
    return {
      ...(await withAvatar(author)),
      tracks: await Promise.all(tracks.map((t) => viewTrack(t, user))),
      followerCount: followers,
      following: !!relation,
      subscribed: !!relation?.notifyNewReleases,
    };
  }
  private async followable(user: Identity, id: string) {
    if (user.id === id) conflict('SELF_FOLLOW', 'Bạn không thể theo dõi chính mình.');
    if (
      !(await db.user.findFirst({
        where: { id: uuid(id), role: 'AUTHOR', active: true },
        select: { id: true },
      }))
    )
      throw new NotFoundException({ code: 'ARTIST_NOT_FOUND' });
  }
  async follow(user: Identity, id: string) {
    await this.followable(user, id);
    await db.artistFollow.upsert({
      where: { userId_authorId: { userId: user.id, authorId: id } },
      create: { userId: user.id, authorId: id },
      update: {},
    });
    return { following: true };
  }
  async unfollow(user: Identity, id: string) {
    await db.artistFollow.deleteMany({ where: { userId: user.id, authorId: uuid(id) } });
    return { following: false, subscribed: false };
  }
  async subscribe(user: Identity, id: string) {
    await this.followable(user, id);
    const changed = await db.artistFollow.updateMany({
      where: { userId: user.id, authorId: id, notifyNewReleases: false },
      data: { notifyNewReleases: true, subscribedAt: new Date() },
    });
    if (
      !changed.count &&
      !(await db.artistFollow.findUnique({
        where: { userId_authorId: { userId: user.id, authorId: id } },
      }))
    )
      conflict('FOLLOW_REQUIRED', 'Hãy theo dõi nghệ sĩ trước khi bật thông báo.');
    return { following: true, subscribed: true };
  }
  async unsubscribe(user: Identity, id: string) {
    await db.artistFollow.updateMany({
      where: { userId: user.id, authorId: uuid(id) },
      data: { notifyNewReleases: false, subscribedAt: null },
    });
    return { subscribed: false };
  }
}
