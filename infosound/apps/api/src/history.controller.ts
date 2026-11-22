import { Controller, Get, Header, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { db } from '@infosound/database';
import { Current, Identity } from './security';
import { pagination, publicTrackWhere, trackInclude, viewTrack } from './helpers';
import { trackPageView } from './openapi';

@ApiTags('InfoSound listening history')
@ApiBearerAuth()
@Controller('api/v1/me')
export class HistoryController {
  @Get('history')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'List the authenticated user’s most recently qualified public songs, once per song',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'One-based page, capped at10000.',
  })
  @ApiQuery({
    name: 'pageSize',
    required: false,
    type: Number,
    description: 'Default20, maximum100.',
  })
  @ApiOkResponse({ schema: trackPageView })
  async history(@Current() user: Identity, @Query() query: { page?: string; pageSize?: string }) {
    const { page, pageSize, take, skip } = pagination({
      ...query,
      pageSize: query.pageSize ?? '20',
    });
    // History belongs to the listener. Even a song's author cannot list a hidden song here.
    // Source replacement keeps the same logical song in history, showing its current public version.
    const where = { userId: user.id, track: publicTrackWhere };
    const [listens, total] = await db.$transaction(
      [
        db.trackListen.findMany({
          where,
          include: { track: { include: trackInclude } },
          orderBy: [{ lastListenedAt: 'desc' }, { trackId: 'asc' }],
          take,
          skip,
        }),
        db.trackListen.count({ where }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    return {
      items: await Promise.all(listens.map((item) => viewTrack(item.track, user))),
      total,
      page,
      pageSize,
    };
  }
}
