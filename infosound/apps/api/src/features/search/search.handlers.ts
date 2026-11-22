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

export class SearchHandlers {
  async search(query: { q?: string; page?: string; pageSize?: string }, user?: Identity) {
    const term = validate(z.string(), query.q ?? '')
      .replace(/[\x00-\x1f\x7f]/g, ' ')
      .trim()
      .slice(0, 120);
    if (!term) return { tracks: [], artists: [], playlists: [] };
    const pattern = containsPattern(term);
    const { take, skip } = pagination(query);
    const [trackIds, artistIds, playlistIds] = await Promise.all([
      searchTrackIds(term, take, skip),
      db.$queryRaw<
        { id: string }[]
      >`SELECT id FROM users WHERE role='AUTHOR' AND active=true AND infosound_unaccent(lower(display_name)) LIKE infosound_unaccent(lower(${pattern})) ORDER BY display_name,id LIMIT ${take} OFFSET ${skip}`,
      db.$queryRaw<
        { id: string }[]
      >`SELECT id FROM playlists WHERE is_public=true AND infosound_unaccent(lower(title)) LIKE infosound_unaccent(lower(${pattern})) ORDER BY created_at DESC,id LIMIT ${take} OFFSET ${skip}`,
    ]);
    const tracks = await db.track.findMany({
      where: { id: { in: trackIds.map((i) => i.id) }, ...publicTrackWhere },
      include: trackInclude,
    });
    const artists = await db.user.findMany({
      where: { id: { in: artistIds.map((i) => i.id) } },
      select: publicAuthorSelect,
    });
    const playlists = await db.playlist.findMany({
      where: { id: { in: playlistIds.map((i) => i.id) }, isPublic: true },
      include: { owner: { select: publicAuthorSelect }, _count: { select: { tracks: true } } },
    });
    return {
      tracks: await Promise.all(
        trackIds.flatMap((hit) => {
          const track = tracks.find((t) => t.id === hit.id);
          if (!track || (hit.searchMatch === 'lyrics' && track.sourceVersion !== hit.sourceVersion))
            return [];
          return [
            viewTrack(track, user).then((value) => ({ ...value, searchMatch: hit.searchMatch })),
          ];
        }),
      ),
      artists: await Promise.all(artists.map((a) => withAvatar(a))),
      playlists: await Promise.all(
        playlists.map(async (p) => ({
          ...p,
          owner: await withAvatar(p.owner),
          trackCount: p._count.tracks,
        })),
      ),
    };
  }
}
