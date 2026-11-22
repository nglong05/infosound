import { Body, Controller, Delete, Get, Header, Param, Post, Put, Query } from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { z } from 'zod';
import { Current, type Identity, Public } from './security';
import { throttle, uuid, validate } from './helpers';
import {
  commentInput,
  commentsForTrack,
  createTrackComment,
  likeTrackComment,
  markersForTrack,
  trackCommunity,
} from './track-community';
import { fullTrackView } from './openapi';
import { moderationCall } from './moderation.controller';

const userView = {
  type: 'object' as const,
  required: ['id', 'displayName', 'role', 'avatarUrl'],
  properties: {
    id: { type: 'string' as const, format: 'uuid' },
    displayName: { type: 'string' as const },
    role: { type: 'string' as const, enum: ['USER', 'AUTHOR'] },
    avatarUrl: { type: 'string' as const, nullable: true },
  },
};
const commentView = {
  type: 'object' as const,
  required: [
    'id',
    'body',
    'atSeconds',
    'sourceVersion',
    'parentId',
    'createdAt',
    'user',
    'likeCount',
    'liked',
    'replyCount',
    'canDelete',
  ],
  properties: {
    id: { type: 'string' as const, format: 'uuid' },
    body: {
      type: 'string' as const,
      minLength: 1,
      maxLength: 2000,
      description: 'Plain text; never render as HTML.',
    },
    atSeconds: { type: 'number' as const, minimum: 0, maximum: 900 },
    sourceVersion: { type: 'integer' as const, minimum: 1 },
    parentId: { type: 'string' as const, format: 'uuid', nullable: true },
    createdAt: { type: 'string' as const, format: 'date-time' },
    user: userView,
    likeCount: { type: 'integer' as const, minimum: 0 },
    liked: { type: 'boolean' as const },
    replyCount: { type: 'integer' as const, minimum: 0 },
    canDelete: {
      type: 'boolean' as const,
      description: 'Server-authorized self or track-owner deletion.',
    },
  },
};
const commentPageView = {
  type: 'object' as const,
  required: ['items', 'total', 'page', 'pageSize', 'sourceVersion'],
  properties: {
    items: { type: 'array' as const, maxItems: 50, items: commentView },
    total: { type: 'integer' as const, minimum: 0 },
    page: { type: 'integer' as const, minimum: 1 },
    pageSize: { type: 'integer' as const, minimum: 1, maximum: 50 },
    sourceVersion: { type: 'integer' as const, minimum: 1 },
  },
};
const likeView = {
  type: 'object' as const,
  required: ['liked', 'likeCount'],
  properties: {
    liked: { type: 'boolean' as const },
    likeCount: { type: 'integer' as const, minimum: 0 },
  },
};
const createdCommentView = {
  ...commentView,
  required: [...commentView.required, 'status', 'contentVersion', 'moderationRevision'],
  properties: {
    ...commentView.properties,
    status: { type: 'string' as const, enum: ['PENDING', 'VISIBLE', 'HELD', 'HIDDEN', 'DELETED'] },
    contentVersion: { type: 'integer' as const, minimum: 1 },
    moderationRevision: { type: 'integer' as const, minimum: 1 },
  },
};

@ApiTags('InfoSound track community')
@Controller('api/v1/tracks/:id')
export class TrackCommunityController {
  @Public()
  @Get('community')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary:
      'Public artist statistics, at most3 real qualified-listen fans and3 public songs by the same artist',
  })
  @ApiOkResponse({
    schema: {
      type: 'object',
      required: ['sourceVersion', 'artist', 'fans', 'relatedTracks'],
      properties: {
        sourceVersion: { type: 'integer', minimum: 1 },
        artist: {
          ...userView,
          required: [
            ...userView.required,
            'bio',
            'followerCount',
            'following',
            'trackCount',
            'playCount',
            'likeCount',
          ],
          properties: {
            ...userView.properties,
            bio: { type: 'string' },
            followerCount: { type: 'integer', minimum: 0 },
            following: { type: 'boolean' },
            trackCount: { type: 'integer', minimum: 0 },
            playCount: { type: 'integer', minimum: 0 },
            likeCount: { type: 'integer', minimum: 0 },
          },
        },
        fans: {
          type: 'object',
          required: ['items', 'historicalCountsLimited'],
          properties: {
            items: {
              type: 'array',
              maxItems: 3,
              items: {
                type: 'object',
                required: ['user', 'playCount'],
                properties: { user: userView, playCount: { type: 'integer', minimum: 1 } },
              },
            },
            historicalCountsLimited: {
              type: 'boolean',
              enum: [true],
              description:
                'Old checkpoints establish only one known qualified play per listener; previous repetitions were not recorded.',
            },
          },
        },
        relatedTracks: { type: 'array', maxItems: 3, items: fullTrackView },
      },
    },
  })
  async summary(@Param('id') id: string, @Current() identity?: Identity) {
    return trackCommunity(uuid(id), identity);
  }

  @Public()
  @Get('comments/markers')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary:
      'At most200 representative current-source root comments distributed over the waveform; no replies as markers',
  })
  @ApiOkResponse({
    schema: {
      type: 'object',
      required: ['items', 'total', 'sourceVersion', 'truncated'],
      properties: {
        items: { type: 'array', maxItems: 200, items: commentView },
        total: { type: 'integer', minimum: 0 },
        sourceVersion: { type: 'integer', minimum: 1 },
        truncated: { type: 'boolean' },
      },
    },
  })
  async markers(@Param('id') id: string, @Current() identity?: Identity) {
    return markersForTrack(uuid(id), identity);
  }

  @Public()
  @Get('comments')
  @Header('Cache-Control', 'private, no-store')
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Default1; maximum10000.' })
  @ApiQuery({
    name: 'pageSize',
    required: false,
    type: Number,
    description: 'Default20; maximum50.',
  })
  @ApiOkResponse({ schema: commentPageView })
  async comments(@Param('id') id: string, @Query() query: unknown, @Current() identity?: Identity) {
    return commentsForTrack(uuid(id), query, identity);
  }

  @Public()
  @Get('comments/:commentId/replies')
  @Header('Cache-Control', 'private, no-store')
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Default1; maximum10000.' })
  @ApiQuery({
    name: 'pageSize',
    required: false,
    type: Number,
    description: 'Default20; maximum50.',
  })
  @ApiOkResponse({ schema: commentPageView })
  async replies(
    @Param('id') id: string,
    @Param('commentId') commentId: string,
    @Query() query: unknown,
    @Current() identity?: Identity,
  ) {
    return commentsForTrack(uuid(id), query, identity, uuid(commentId));
  }

  @Post('comments')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary:
      'Create a timestamped plain-text comment or one-level reply for the current source; reply inherits parent time',
  })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['body', 'sourceVersion', 'atSeconds'],
      properties: {
        body: { type: 'string', minLength: 1, maxLength: 2000 },
        sourceVersion: { type: 'integer', minimum: 1 },
        atSeconds: { type: 'number', minimum: 0, maximum: 900 },
        parentId: { type: 'string', format: 'uuid' },
      },
    },
  })
  @ApiCreatedResponse({ schema: createdCommentView })
  async create(@Param('id') id: string, @Current() identity: Identity, @Body() body: unknown) {
    return moderationCall(() =>
      createTrackComment(uuid(id), identity, validate(commentInput, body)),
    );
  }

  @Put('comments/:commentId/like')
  @Header('Cache-Control', 'private, no-store')
  @ApiOkResponse({ schema: likeView })
  async like(
    @Param('id') id: string,
    @Param('commentId') commentId: string,
    @Current() identity: Identity,
    @Body() body: unknown,
  ) {
    throttle(`track-comment-likes:${identity.id}`, 60);
    validate(z.object({}).strict(), body ?? {});
    return likeTrackComment(uuid(id), uuid(commentId), identity, true);
  }

  @Delete('comments/:commentId/like')
  @Header('Cache-Control', 'private, no-store')
  @ApiOkResponse({ schema: likeView })
  async unlike(
    @Param('id') id: string,
    @Param('commentId') commentId: string,
    @Current() identity: Identity,
    @Body() body: unknown,
  ) {
    throttle(`track-comment-likes:${identity.id}`, 60);
    validate(z.object({}).strict(), body ?? {});
    return likeTrackComment(uuid(id), uuid(commentId), identity, false);
  }
}
