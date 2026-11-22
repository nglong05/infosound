import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Put,
} from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { db } from '@infosound/database';
import {
  lyricsDocumentSchema,
  lyricsUpdateSchema,
  type TrackLyricsResponse,
} from '@infosound/contracts';
import { Author, Current, type Identity, Public } from './security';
import { conflict, publicTrackWhere, throttle, uuid, validate } from './helpers';

const lyricsDocumentView = {
  type: 'object' as const,
  additionalProperties: false,
  required: ['version', 'lines'],
  properties: {
    version: { type: 'integer' as const, enum: [1] },
    lines: {
      type: 'array' as const,
      minItems: 1,
      maxItems: 2000,
      items: {
        type: 'object' as const,
        additionalProperties: false,
        required: ['startMs', 'text'],
        properties: {
          startMs: { type: 'integer' as const, minimum: 0, maximum: 86400000 },
          text: { type: 'string' as const, maxLength: 500 },
        },
      },
    },
  },
};
const lyricsView = {
  type: 'object' as const,
  required: ['trackId', 'sourceVersion', 'lyrics', 'updatedAt'],
  properties: {
    trackId: { type: 'string' as const, format: 'uuid' },
    sourceVersion: { type: 'integer' as const, minimum: 1 },
    lyrics: { ...lyricsDocumentView, nullable: true },
    updatedAt: { type: 'string' as const, format: 'date-time', nullable: true },
  },
};

@ApiTags('InfoSound synchronized lyrics')
@Controller('api/v1')
export class LyricsController {
  @Public()
  @Get('tracks/:id/lyrics')
  @ApiOperation({
    summary:
      'Lời đồng bộ của bài đã phát hành hoặc bài thuộc nghệ sĩ hiện tại; null khi chưa có hoặc đã thay nguồn audio',
  })
  @ApiOkResponse({ schema: lyricsView })
  async read(
    @Param('id') id: string,
    @Current() identity?: Identity,
  ): Promise<TrackLyricsResponse> {
    const track = await db.track.findFirst({
      where: {
        id: uuid(id),
        deletedAt: null,
        OR: [publicTrackWhere, ...(identity ? [{ authorId: identity.id }] : [])],
      },
      select: { id: true, sourceVersion: true, lyrics: true },
    });
    if (!track)
      throw new NotFoundException({ code: 'TRACK_NOT_FOUND', message: 'Không tìm thấy bài hát.' });
    const stored = track.lyrics;
    const parsed =
      stored?.sourceVersion === track.sourceVersion
        ? lyricsDocumentSchema.safeParse({ version: 1, lines: stored.lines })
        : null;
    return {
      trackId: track.id,
      sourceVersion: track.sourceVersion,
      lyrics: parsed?.success ? parsed.data : null,
      updatedAt: parsed?.success ? stored!.updatedAt.toISOString() : null,
    };
  }

  @Author()
  @Put('studio/tracks/:id/lyrics')
  @ApiOperation({
    summary: 'Lưu lời đồng bộ có giới hạn64KiB cho đúng sourceVersion; chỉ nghệ sĩ sở hữu bài',
  })
  @ApiBody({
    schema: {
      ...lyricsDocumentView,
      required: ['version', 'lines', 'sourceVersion'],
      properties: {
        ...lyricsDocumentView.properties,
        sourceVersion: { type: 'integer', minimum: 1 },
      },
    },
  })
  @ApiOkResponse({ schema: lyricsView })
  async save(
    @Param('id') id: string,
    @Current() identity: Identity,
    @Body() body: unknown,
  ): Promise<TrackLyricsResponse> {
    throttle(`lyrics-save:${identity.id}`, 20);
    const trackId = uuid(id),
      input = validate(lyricsUpdateSchema, body);
    return db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM tracks WHERE id=${trackId}::uuid AND author_id=${identity.id}::uuid AND deleted_at IS NULL FOR UPDATE`;
      const track = await tx.track.findFirst({
        where: { id: trackId, authorId: identity.id, deletedAt: null },
        select: { id: true, sourceVersion: true, duration: true, processingState: true },
      });
      if (!track)
        throw new NotFoundException({
          code: 'TRACK_NOT_FOUND',
          message: 'Không tìm thấy bài hát.',
        });
      if (track.sourceVersion !== input.sourceVersion)
        conflict(
          'SOURCE_VERSION_CHANGED',
          'Nguồn âm thanh đã thay đổi. Hãy tải lại bài hát trước khi lưu lời.',
        );
      if (
        track.processingState === 'READY' &&
        track.duration !== null &&
        Number.isFinite(track.duration) &&
        input.lines[input.lines.length - 1].startMs > Math.ceil(track.duration * 1000)
      )
        throw new BadRequestException({
          code: 'LYRICS_TIMING_INVALID',
          message: 'Mốc lời bài hát vượt quá thời lượng âm thanh.',
        });
      const stored = await tx.trackLyrics.upsert({
        where: { trackId },
        create: { trackId, sourceVersion: track.sourceVersion, lines: input.lines },
        update: { sourceVersion: track.sourceVersion, lines: input.lines },
      });
      return {
        trackId,
        sourceVersion: track.sourceVersion,
        lyrics: { version: 1, lines: input.lines },
        updatedAt: stored.updatedAt.toISOString(),
      };
    });
  }

  @Author()
  @Delete('studio/tracks/:id/lyrics')
  @ApiOperation({ summary: 'Xóa lời đồng bộ; giữ nguyên bài và audio, chỉ nghệ sĩ sở hữu bài' })
  @ApiOkResponse({ schema: lyricsView })
  async remove(
    @Param('id') id: string,
    @Current() identity: Identity,
  ): Promise<TrackLyricsResponse> {
    throttle(`lyrics-delete:${identity.id}`, 20);
    const trackId = uuid(id);
    return db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM tracks WHERE id=${trackId}::uuid AND author_id=${identity.id}::uuid AND deleted_at IS NULL FOR UPDATE`;
      const track = await tx.track.findFirst({
        where: { id: trackId, authorId: identity.id, deletedAt: null },
        select: { sourceVersion: true },
      });
      if (!track)
        throw new NotFoundException({
          code: 'TRACK_NOT_FOUND',
          message: 'Không tìm thấy bài hát.',
        });
      await tx.trackLyrics.deleteMany({ where: { trackId } });
      return { trackId, sourceVersion: track.sourceVersion, lyrics: null, updatedAt: null };
    });
  }
}
