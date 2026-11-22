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
import { playlistBody, orderBody, fullTrackView } from './openapi';
import { db, Prisma } from '@infosound/database';
import { playlistSchema, playlistUpdateSchema, orderSchema } from '@infosound/contracts';
import { Current, Identity, Public } from './security';
import {
  conflict,
  pagination,
  publicAuthorSelect,
  publicTrackWhere,
  trackInclude,
  uuid,
  validate,
  viewTrack,
} from './helpers';
import { withAvatar } from './user-view';
import { containsPattern, searchTrackIds } from './search';
import { popularArtistIds } from './artist-ranking';
import { artistSpotlights } from './artist-spotlight';
import {
  listModerationNotificationPage,
  projectCommentNotification,
  readModerationNotification,
} from '@infosound/comment-moderation/server';
import { SearchHandlers } from './features/search/search.handlers';
import { ArtistHandlers } from './features/artists/artists.handlers';
import { PlaylistHandlers } from './features/playlists/playlists.handlers';
import { LibraryHandlers } from './features/library/library.handlers';
import { NotificationHandlers } from './features/notifications/notifications.handlers';

@ApiTags('InfoSound library and community')
@Controller('api/v1')
export class SocialController {
  private readonly searchHandlers = new SearchHandlers();
  private readonly artistsHandlers = new ArtistHandlers();
  private readonly playlistsHandlers = new PlaylistHandlers();
  private readonly libraryHandlers = new LibraryHandlers();
  private readonly notificationsHandlers = new NotificationHandlers();
  @Public()
  @Get('search')
  @ApiOperation({
    summary:
      'Search public tracks by title or partial/fuzzy saved lyrics, plus artists and public playlists',
  })
  @ApiQuery({
    name: 'q',
    required: false,
    type: String,
    description:
      'Up to120 characters; lyrics are case/accent insensitive, partial from3 normalized characters and fuzzy from5.',
  })
  @ApiOkResponse({
    schema: {
      type: 'object',
      required: ['tracks', 'artists', 'playlists'],
      properties: {
        tracks: {
          type: 'array',
          items: {
            ...fullTrackView,
            properties: {
              ...fullTrackView.properties,
              searchMatch: {
                type: 'string',
                enum: ['title', 'lyrics'],
                description:
                  'Best matching field; no lyric text or private search index is returned.',
              },
            },
          },
        },
        artists: { type: 'array', items: { type: 'object' } },
        playlists: { type: 'array', items: { type: 'object' } },
      },
    },
  })
  async search(
    @Query() query: { q?: string; page?: string; pageSize?: string },
    @Current() user?: Identity,
  ) {
    return this.searchHandlers.search(query, user);
  }
  @Public()
  @Get('artists')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary:
      'List active artists; popular orders by public-song listens, then newest public release, without exposing ranking metrics',
  })
  @ApiQuery({
    name: 'sort',
    required: false,
    enum: ['latest', 'popular'],
    description:
      'Latest artist registrations by default; popular uses total qualified listens of public READY songs, then latest public release and artist ID.',
  })
  @ApiQuery({
    name: 'include',
    required: false,
    enum: ['spotlight'],
    description:
      'Optional card details: public followerCount, current-user following and topTrack (public READY track by listens, then newest release and ID), or null when none. Default projection is unchanged.',
  })
  @ApiOkResponse({
    schema: {
      type: 'object',
      required: ['items', 'total', 'page', 'pageSize'],
      properties: {
        items: {
          type: 'array',
          maxItems: 100,
          items: {
            type: 'object',
            required: ['id', 'displayName', 'bio', 'role', 'avatarUrl'],
            properties: {
              id: { type: 'string', format: 'uuid' },
              displayName: { type: 'string' },
              bio: { type: 'string' },
              role: { type: 'string', enum: ['AUTHOR'] },
              avatarUrl: { type: 'string', nullable: true },
              followerCount: {
                type: 'integer',
                minimum: 0,
                description: 'Only with include=spotlight; total followers, not their identities.',
              },
              following: {
                type: 'boolean',
                description:
                  'Only with include=spotlight; current user follows this artist, otherwise false. Self is false.',
              },
              topTrack: {
                ...fullTrackView,
                nullable: true,
                description:
                  'Only with include=spotlight; public top-listened song or null; uses the existing public track projection.',
              },
            },
          },
        },
        total: { type: 'integer', minimum: 0 },
        page: { type: 'integer', minimum: 1 },
        pageSize: { type: 'integer', minimum: 1, maximum: 100 },
      },
    },
  })
  async artists(
    @Query() query: { page?: string; pageSize?: string; sort?: string; include?: string },
    @Current() user?: Identity,
  ) {
    return this.artistsHandlers.artists(query, user);
  }
  @Public() @Get('artists/:id') async artist(@Param('id') id: string, @Current() user?: Identity) {
    return this.artistsHandlers.artist(id, user);
  }
  @Public() @Get('profiles/:id') async profile(
    @Param('id') id: string,
    @Current() user?: Identity,
  ) {
    return this.artistsHandlers.profile(id, user);
  }
  @Put('artists/:id/follow') async follow(@Current() user: Identity, @Param('id') id: string) {
    return this.artistsHandlers.follow(user, id);
  }
  @Delete('artists/:id/follow') async unfollow(@Current() user: Identity, @Param('id') id: string) {
    return this.artistsHandlers.unfollow(user, id);
  }
  @Put('artists/:id/subscription') async subscribe(
    @Current() user: Identity,
    @Param('id') id: string,
  ) {
    return this.artistsHandlers.subscribe(user, id);
  }
  @Delete('artists/:id/subscription') async unsubscribe(
    @Current() user: Identity,
    @Param('id') id: string,
  ) {
    return this.artistsHandlers.unsubscribe(user, id);
  }
  @Get('library') async library(@Current() user: Identity) {
    return this.libraryHandlers.library(user);
  }
  @Get('library/liked') async liked(
    @Current() user: Identity,
    @Query() query: { page?: string; pageSize?: string },
  ) {
    return this.libraryHandlers.liked(user, query);
  }
  @Get('playlists') async playlists(
    @Current() user: Identity,
    @Query() query: { page?: string; pageSize?: string },
  ) {
    return this.playlistsHandlers.playlists(user, query);
  }
  @Post('playlists') @ApiBody({ schema: playlistBody }) async createPlaylist(
    @Current() user: Identity,
    @Body() body: unknown,
  ) {
    return this.playlistsHandlers.createPlaylist(user, body);
  }
  @Public() @Get('playlists/:id') async playlist(
    @Param('id') id: string,
    @Current() user?: Identity,
  ) {
    return this.playlistsHandlers.playlist(id, user);
  }
  @Patch('playlists/:id')
  @ApiBody({ schema: { ...playlistBody, required: [] } })
  async updatePlaylist(@Current() user: Identity, @Param('id') id: string, @Body() body: unknown) {
    return this.playlistsHandlers.updatePlaylist(user, id, body);
  }
  @Delete('playlists/:id') async deletePlaylist(
    @Current() user: Identity,
    @Param('id') id: string,
  ) {
    return this.playlistsHandlers.deletePlaylist(user, id);
  }
  @Put('playlists/:id/tracks/:trackId') async addTrack(
    @Current() user: Identity,
    @Param('id') id: string,
    @Param('trackId') trackId: string,
  ) {
    return this.playlistsHandlers.addTrack(user, id, trackId);
  }
  @Delete('playlists/:id/tracks/:trackId') async removeTrack(
    @Current() user: Identity,
    @Param('id') id: string,
    @Param('trackId') trackId: string,
  ) {
    return this.playlistsHandlers.removeTrack(user, id, trackId);
  }
  @Put('playlists/:id/order') @ApiBody({ schema: orderBody }) async reorder(
    @Current() user: Identity,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.playlistsHandlers.reorder(user, id, body);
  }
  @Get('notifications')
  @Header('Cache-Control', 'private, no-store')
  async notifications(
    @Current() user: Identity,
    @Query() query: { page?: string; pageSize?: string },
  ) {
    return this.notificationsHandlers.notifications(user, query);
  }
  @Patch('notifications/:id/read') async read(@Current() user: Identity, @Param('id') id: string) {
    return this.notificationsHandlers.read(user, id);
  }
}
