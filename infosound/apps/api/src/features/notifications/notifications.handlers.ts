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

export class NotificationHandlers {
  async notifications(user: Identity, query: { page?: string; pageSize?: string }) {
    const { page, pageSize } = pagination(query);
    const feed = await listModerationNotificationPage(db, user.id, page, pageSize);
    const releases = await db.notification.findMany({
      where: {
        recipientId: user.id,
        id: { in: feed.items.filter((item) => item.kind === 'RELEASE').map((item) => item.id) },
      },
      include: { releaseEvent: { include: { track: { include: trackInclude } } } },
    });
    const byId = new Map(releases.map((item) => [item.id, item]));
    const items = await Promise.all(
      feed.items.map(async (item) => {
        if (item.kind === 'COMMENT_VIOLATION') return projectCommentNotification(item);
        const n = byId.get(item.id);
        if (!n) return null;
        return {
          id: n.id,
          kind: 'RELEASE' as const,
          readAt: n.readAt,
          createdAt: n.createdAt,
          trackId: n.releaseEvent.trackId,
          track: await viewTrack(n.releaseEvent.track, user),
        };
      }),
    );
    return { ...feed, items: items.filter((item) => item !== null) };
  }
  async read(user: Identity, id: string) {
    const notificationId = uuid(id);
    const changed = await db.notification.updateMany({
      where: { id: notificationId, recipientId: user.id },
      data: { readAt: new Date() },
    });
    if (!changed.count && !(await readModerationNotification(db, user.id, notificationId)))
      throw new NotFoundException({ code: 'NOTIFICATION_NOT_FOUND' });
    return { read: true };
  }
}
