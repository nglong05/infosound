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

export class PlaylistHandlers {
  async playlists(user: Identity, query: { page?: string; pageSize?: string }) {
    const { page, pageSize, take, skip } = pagination(query);
    const [items, total] = await Promise.all([
      db.playlist.findMany({
        where: { ownerId: user.id },
        include: { owner: { select: publicAuthorSelect }, _count: { select: { tracks: true } } },
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        skip,
        take,
      }),
      db.playlist.count({ where: { ownerId: user.id } }),
    ]);
    return {
      items: await Promise.all(
        items.map(async (p) => ({
          ...p,
          owner: await withAvatar(p.owner),
          trackCount: p._count.tracks,
        })),
      ),
      total,
      page,
      pageSize,
    };
  }
  async createPlaylist(user: Identity, body: unknown) {
    return db.playlist.create({ data: { ownerId: user.id, ...validate(playlistSchema, body) } });
  }
  private async requirePlaylist(id: string, user: Identity) {
    const playlist = await db.playlist.findFirst({ where: { id: uuid(id), ownerId: user.id } });
    if (!playlist) throw new NotFoundException({ code: 'PLAYLIST_NOT_FOUND' });
    return playlist;
  }
  async playlist(id: string, user?: Identity) {
    const playlist = await db.playlist.findFirst({
      where: { id: uuid(id), OR: [{ isPublic: true }, ...(user ? [{ ownerId: user.id }] : [])] },
      include: {
        owner: { select: publicAuthorSelect },
        tracks: {
          include: { track: { include: trackInclude } },
          orderBy: [{ position: 'asc' }, { trackId: 'asc' }],
        },
      },
    });
    if (!playlist) throw new NotFoundException({ code: 'PLAYLIST_NOT_FOUND' });
    return {
      ...playlist,
      owner: await withAvatar(playlist.owner),
      tracks: await Promise.all(
        playlist.tracks.map(async (item) => ({
          ...(await viewTrack(item.track, user)),
          position: item.position,
        })),
      ),
      isOwner: playlist.ownerId === user?.id,
    };
  }
  async updatePlaylist(user: Identity, id: string, body: unknown) {
    await this.requirePlaylist(id, user);
    await db.playlist.update({
      where: { id },
      data: { ...validate(playlistUpdateSchema, body), version: { increment: 1 } },
    });
    return this.playlist(id, user);
  }
  async deletePlaylist(user: Identity, id: string) {
    await this.requirePlaylist(id, user);
    await db.playlist.delete({ where: { id } });
    return { message: 'Đã xóa danh sách phát.' };
  }
  async addTrack(user: Identity, id: string, trackId: string) {
    await this.requirePlaylist(id, user);
    if (!(await db.track.findFirst({ where: { id: uuid(trackId), ...publicTrackWhere } })))
      throw new NotFoundException({ code: 'TRACK_UNAVAILABLE' });
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM playlists WHERE id=${id}::uuid FOR UPDATE`;
      if (
        await tx.playlistTrack.findUnique({
          where: { playlistId_trackId: { playlistId: id, trackId } },
        })
      )
        return;
      const count = await tx.playlistTrack.count({ where: { playlistId: id } });
      if (count >= 500) conflict('PLAYLIST_FULL', 'Danh sách phát tối đa 500 bài.');
      const last = await tx.playlistTrack.aggregate({
        where: { playlistId: id },
        _max: { position: true },
      });
      await tx.playlistTrack.create({
        data: { playlistId: id, trackId, position: (last._max.position ?? -1) + 1 },
      });
      await tx.playlist.update({ where: { id }, data: { version: { increment: 1 } } });
    });
    return this.playlist(id, user);
  }
  async removeTrack(user: Identity, id: string, trackId: string) {
    await this.requirePlaylist(id, user);
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM playlists WHERE id=${id}::uuid FOR UPDATE`;
      await tx.playlistTrack.deleteMany({ where: { playlistId: id, trackId: uuid(trackId) } });
      await tx.playlist.update({ where: { id }, data: { version: { increment: 1 } } });
    });
    return this.playlist(id, user);
  }
  async reorder(user: Identity, id: string, body: unknown) {
    await this.requirePlaylist(id, user);
    const input = validate(orderSchema, body);
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM playlists WHERE id=${id}::uuid FOR UPDATE`;
      const playlist = await tx.playlist.findUniqueOrThrow({ where: { id } });
      if (playlist.version !== input.version)
        conflict(
          'PLAYLIST_VERSION_CONFLICT',
          'Danh sách phát vừa thay đổi. Hãy tải lại và thử lại.',
        );
      const tracks = await tx.playlistTrack.findMany({
        where: { playlistId: id },
        select: { trackId: true },
      });
      if (
        tracks.length !== input.trackIds.length ||
        tracks.some((t) => !input.trackIds.includes(t.trackId))
      )
        conflict('PLAYLIST_TRACKS_MISMATCH', 'Danh sách bài không khớp.');
      for (let i = 0; i < input.trackIds.length; i++)
        await tx.playlistTrack.update({
          where: { playlistId_trackId: { playlistId: id, trackId: input.trackIds[i]! } },
          data: { position: i },
        });
      await tx.playlist.update({ where: { id }, data: { version: { increment: 1 } } });
    });
    return this.playlist(id, user);
  }
}
