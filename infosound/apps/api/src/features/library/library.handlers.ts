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
import { PlaylistHandlers } from '../playlists/playlists.handlers';

export class LibraryHandlers extends PlaylistHandlers {
  async library(user: Identity) {
    const [liked, followed, playlists] = await Promise.all([
      this.liked(user, {}),
      db.artistFollow.findMany({
        where: { userId: user.id },
        include: { author: { select: publicAuthorSelect } },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      this.playlists(user, {}),
    ]);
    return {
      likedTracks: liked.items,
      followedArtists: await Promise.all(
        followed.map(async (f) => ({
          ...(await withAvatar(f.author)),
          following: true,
          subscribed: f.notifyNewReleases,
        })),
      ),
      playlists: playlists.items,
    };
  }
  async liked(user: Identity, query: { page?: string; pageSize?: string }) {
    const { page, pageSize, take, skip } = pagination(query);
    const [items, total] = await Promise.all([
      db.trackLike.findMany({
        where: { userId: user.id },
        include: { track: { include: trackInclude } },
        orderBy: [{ createdAt: 'desc' }, { trackId: 'asc' }],
        take,
        skip,
      }),
      db.trackLike.count({ where: { userId: user.id } }),
    ]);
    return {
      items: await Promise.all(items.map((l) => viewTrack(l.track, user))),
      total,
      page,
      pageSize,
    };
  }
}
