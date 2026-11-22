import { Body, Controller, Get, Header, HttpCode, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { db } from '@infosound/database';
import { Current, Identity, Public } from './security';
import { publicTrackWhere, trackInclude, viewTrack } from './helpers';
import { fullTrackView } from './openapi';
import {
  previewRecommendationSelection,
  RecommendationSource,
  userRecommendationSelection,
} from './recommendations';
import {
  musicPreferencesView,
  readMusicPreferences,
  validateMusicPreferences,
} from './music-preferences';

const preferencesBody = {
  type: 'object' as const,
  additionalProperties: false,
  required: ['genreIds', 'artistIds'],
  properties: {
    genreIds: {
      type: 'array' as const,
      maxItems: 50,
      items: { type: 'string' as const, minLength: 1, maxLength: 100 },
    },
    artistIds: {
      type: 'array' as const,
      maxItems: 50,
      items: { type: 'string' as const, format: 'uuid' },
    },
  },
};
const preferencesView = {
  type: 'object' as const,
  required: ['genreIds', 'artistIds', 'status', 'hasLikedPreferences'],
  properties: {
    ...preferencesBody.properties,
    status: { type: 'string' as const, enum: ['NEW', 'SAVED', 'SKIPPED'] },
    hasLikedPreferences: { type: 'boolean' as const },
  },
};
const recommendationsView = {
  type: 'object' as const,
  required: ['items', 'reason', 'source'],
  properties: {
    items: { type: 'array' as const, maxItems: 5, items: fullTrackView },
    reason: { type: 'string' as const, enum: ['MATCHED', 'POPULAR', 'NO_MATCHES'] },
    source: { type: 'string' as const, enum: ['PREFERENCES', 'LIKES', 'POPULAR'] },
  },
};

@ApiTags('InfoSound recommendations')
@Controller('api/v1')
export class RecommendationsController {
  @ApiBearerAuth()
  @Get('recommendations')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary:
      'Recommend five songs using saved choices, then liked genres, otherwise public popular songs',
  })
  @ApiOkResponse({ schema: recommendationsView })
  async recommendations(@Current() user: Identity) {
    return this.hydrate(await userRecommendationSelection(user.id), user);
  }

  @Public()
  @Post('recommendations/preview')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary:
      'Preview five public recommendations from visitor choices without saving a preference profile',
  })
  @ApiBody({ schema: preferencesBody })
  @ApiOkResponse({ schema: recommendationsView })
  async preview(@Body() body: unknown) {
    return this.hydrate(await previewRecommendationSelection(readMusicPreferences(body)));
  }

  @ApiBearerAuth()
  @Get('me/music-preferences')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary:
      'Read only the current account’s survey status and currently available catalog choices',
  })
  @ApiOkResponse({ schema: preferencesView })
  preferences(@Current() user: Identity) {
    return musicPreferencesView(user.id);
  }

  @ApiBearerAuth()
  @Put('me/music-preferences')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Save current account’s favorite genres/artists; two empty arrays skip the survey',
  })
  @ApiBody({ schema: preferencesBody })
  @ApiOkResponse({ schema: preferencesView })
  async savePreferences(@Current() user: Identity, @Body() body: unknown) {
    const value = await validateMusicPreferences(body);
    await db.musicPreference.upsert({
      where: { userId: user.id },
      create: { userId: user.id, ...value },
      update: value,
    });
    return musicPreferencesView(user.id);
  }

  private async hydrate(
    selected: { ids: string[]; source: RecommendationSource },
    user?: Identity,
  ) {
    // Recheck current visibility and likes after selection; never allow an owner override.
    const tracks = await db.track.findMany({
      where: {
        id: { in: selected.ids },
        ...publicTrackWhere,
        ...(user && selected.source !== 'POPULAR' ? { likes: { none: { userId: user.id } } } : {}),
      },
      include: trackInclude,
    });
    const byId = new Map(tracks.map((track) => [track.id, track]));
    const items = await Promise.all(
      selected.ids.flatMap((id) => {
        const track = byId.get(id);
        return track ? [viewTrack(track, user)] : [];
      }),
    );
    return {
      items,
      reason:
        selected.source === 'POPULAR'
          ? ('POPULAR' as const)
          : items.length
            ? ('MATCHED' as const)
            : ('NO_MATCHES' as const),
      source: selected.source,
    };
  }
}
