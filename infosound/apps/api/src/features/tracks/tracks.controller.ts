import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
  BadRequestException,
  ForbiddenException,
  Req,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ApiBody, ApiOperation, ApiTags, ApiQuery, ApiOkResponse } from '@nestjs/swagger';
import {
  metadataBody,
  uploadBody,
  imageUploadBody,
  fullTrackView,
  trackPageView,
} from '../../openapi';
import { db, Prisma } from '@infosound/database';
import {
  uploadSchema,
  imageUploadSchema,
  metadataSchema,
  genreIdSchema,
  hashToken,
  PIPELINE_VERSION,
} from '@infosound/contracts';
import {
  storageClient,
  uploadUrl,
  imageUploadUrl,
  mediaUrl,
  mediaHeadUrl,
  HeadObjectCommand,
  CopyObjectCommand,
  PutObjectCommand,
} from '@infosound/storage';
import { Author, Current, Identity, Public, type AuthRequest } from '../../security';
import {
  conflict,
  pagination,
  publicAuthorSelect,
  publicTrackWhere,
  requireOwner,
  trackInclude,
  throttle,
  uuid,
  validate,
  viewTrack,
} from '../../helpers';
import { normalizeImage, runImageJob } from '../../image-processing';
import { imageDeletePayload, readImageSnapshot } from '../../image-storage';
import { reserveImageQuota } from '../../image-quota';
import { genreProjection, replaceTrackGenres, resolveGenreSelection } from '../../genres';
import { countListen, createListenToken } from '../../listens';
import { visitorListener, visitorListenHash } from '../../visitor-listener';

@ApiTags('InfoSound tracks and Studio')
@Controller('api/v1')
export class TracksController {
  @Public()
  @Get('genres')
  @ApiOperation({ summary: 'List selectable music genres and search aliases' })
  @ApiOkResponse({
    schema: {
      type: 'object',
      required: ['items'],
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            required: ['id', 'name', 'aliases'],
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              aliases: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
    },
  })
  async genres() {
    return {
      items: await db.genre.findMany({
        where: { isSelectable: true },
        select: { id: true, name: true, aliases: true },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      }),
    };
  }
  @Public()
  @Get('tracks')
  @ApiOkResponse({ schema: trackPageView })
  @ApiQuery({
    name: 'genreId',
    required: false,
    type: String,
    description: 'Exact genre ID; matches one of the track memberships.',
  })
  @ApiQuery({
    name: 'sort',
    required: false,
    enum: ['latest', 'popular'],
    description:
      'Latest releases by default; popular ranks by all-time qualified listens, then release time and ID.',
  })
  async tracks(
    @Query() query: { page?: string; pageSize?: string; genreId?: string; sort?: string },
    @Current() identity?: Identity,
  ) {
    const { page, pageSize, skip, take } = pagination(query);
    const genreId =
      query.genreId === undefined ? undefined : validate(genreIdSchema, query.genreId);
    const sort = validate(z.enum(['latest', 'popular']), query.sort ?? 'latest');
    const where: Prisma.TrackWhereInput = {
      ...publicTrackWhere,
      ...(genreId ? { genres: { some: { genreId } } } : {}),
    };
    const orderBy: Prisma.TrackOrderByWithRelationInput[] =
      sort === 'popular'
        ? [{ playCount: 'desc' }, { publishedAt: 'desc' }, { id: 'asc' }]
        : [{ publishedAt: 'desc' }, { id: 'asc' }];
    const [items, total] = await Promise.all([
      db.track.findMany({ where, include: trackInclude, orderBy, skip, take }),
      db.track.count({ where }),
    ]);
    return {
      items: await Promise.all(items.map((t) => viewTrack(t, identity))),
      total,
      page,
      pageSize,
    };
  }
  @Public()
  @Get('tracks/:id')
  @ApiOkResponse({ schema: fullTrackView })
  async track(@Param('id') id: string, @Current() identity?: Identity) {
    const item = await db.track.findFirst({
      where: {
        id: uuid(id),
        deletedAt: null,
        OR: [publicTrackWhere, ...(identity ? [{ authorId: identity.id }] : [])],
      },
      include: trackInclude,
    });
    if (!item)
      throw new NotFoundException({ code: 'TRACK_NOT_FOUND', message: 'Không tìm thấy bài hát.' });
    return viewTrack(item, identity);
  }
  @Author()
  @Get('studio/tracks')
  @ApiOkResponse({ schema: trackPageView })
  async studio(
    @Current() user: Identity,
    @Query() query: { page?: string; pageSize?: string; state?: string },
  ) {
    const { page, pageSize, skip, take } = pagination(query);
    const state = z
      .enum(['DRAFT', 'QUEUED', 'PROCESSING', 'READY', 'FAILED'])
      .safeParse(query.state);
    const where: Prisma.TrackWhereInput = {
      authorId: user.id,
      deletedAt: null,
      ...(state.success ? { processingState: state.data } : {}),
    };
    const [items, total] = await Promise.all([
      db.track.findMany({
        where,
        include: trackInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip,
        take,
      }),
      db.track.count({ where }),
    ]);
    return {
      items: await Promise.all(items.map((t) => viewTrack(t, user, true))),
      total,
      page,
      pageSize,
    };
  }
  @Author()
  @Get('studio/tracks/:id')
  @ApiOkResponse({ schema: fullTrackView })
  async studioTrack(@Current() user: Identity, @Param('id') id: string) {
    await requireOwner(id, user);
    return this.track(id, user);
  }
  @Author()
  @Post('tracks/uploads')
  @ApiBody({ schema: uploadBody })
  async upload(@Current() user: Identity, @Body() body: unknown) {
    return this.initializeUpload(user, body);
  }
  @Author()
  @Post('tracks/:id/audio/uploads')
  @ApiBody({ schema: uploadBody })
  async replaceAudio(@Current() user: Identity, @Param('id') id: string, @Body() body: unknown) {
    return this.initializeUpload(user, body, uuid(id));
  }
  @Author()
  @Post('tracks/:id/artwork/uploads')
  @ApiBody({ schema: imageUploadBody })
  async artwork(@Current() user: Identity, @Param('id') id: string, @Body() body: unknown) {
    return this.initializeUpload(user, body, uuid(id), true);
  }

  private async initializeUpload(user: Identity, body: unknown, trackId?: string, artwork = false) {
    const input = validate(uploadSchema, body);
    if (!trackId && !input.title)
      throw new BadRequestException({ code: 'TITLE_REQUIRED', message: 'Hãy nhập tên bài hát.' });
    if (artwork) {
      validate(imageUploadSchema, {
        filename: input.filename,
        size: input.size,
        contentType: input.contentType,
        idempotencyKey: input.idempotencyKey,
      });
      throttle(`artwork-init:${user.id}`, 10, 600000);
    }
    if (
      !artwork &&
      ![
        'audio/wav',
        'audio/x-wav',
        'audio/wave',
        'audio/flac',
        'audio/x-flac',
        'audio/mpeg',
        'application/octet-stream',
      ].includes(input.contentType)
    )
      throw new BadRequestException({
        code: 'AUDIO_FORMAT',
        message: 'Chỉ hỗ trợ WAV PCM, FLAC hoặc MP3.',
      });
    const payloadHash = hashToken(JSON.stringify({ input, trackId: trackId ?? null, artwork }));
    let session = await db.uploadSession.findUnique({
      where: { userId_idempotencyKey: { userId: user.id, idempotencyKey: input.idempotencyKey } },
    });
    if (session) {
      if (session.payloadHash !== payloadHash)
        conflict('IDEMPOTENCY_CONFLICT', 'Mã yêu cầu đã được dùng cho dữ liệu khác.');
      if (session.expiresAt < new Date() || (artwork && session.completedAt))
        conflict('UPLOAD_EXPIRED', 'Phiên tải lên đã hết hạn. Hãy tạo phiên mới.');
    } else {
      session = await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM users WHERE id=${user.id}::uuid FOR UPDATE`;
        const duplicate = await tx.uploadSession.findUnique({
          where: {
            userId_idempotencyKey: { userId: user.id, idempotencyKey: input.idempotencyKey },
          },
        });
        if (duplicate) {
          if (duplicate.payloadHash !== payloadHash)
            conflict('IDEMPOTENCY_CONFLICT', 'Mã yêu cầu đã được dùng.');
          if (artwork && (duplicate.expiresAt <= new Date() || duplicate.completedAt))
            conflict('UPLOAD_EXPIRED', 'Phiên ảnh đã kết thúc. Hãy chọn lại ảnh.');
          return duplicate;
        }
        if (artwork && trackId) {
          await tx.$queryRaw`SELECT id FROM tracks WHERE id=${trackId}::uuid AND author_id=${user.id}::uuid FOR UPDATE`;
          if (
            !(await tx.track.findFirst({
              where: { id: trackId, authorId: user.id, deletedAt: null },
              select: { id: true },
            }))
          )
            throw new NotFoundException({ code: 'TRACK_NOT_FOUND' });
          const superseded = await tx.uploadSession.findMany({
            where: {
              userId: user.id,
              trackId,
              kind: 'ARTWORK',
              completedAt: null,
              expiresAt: { gt: new Date() },
            },
            select: { id: true, objectKey: true },
          });
          if (superseded.length) {
            await tx.uploadSession.updateMany({
              where: { id: { in: superseded.map((item) => item.id) }, completedAt: null },
              data: { expiresAt: new Date() },
            });
            for (const old of superseded)
              await tx.outboxEvent.create({
                data: {
                  type: 'OBJECT_DELETE',
                  payload: imageDeletePayload('uploads-quarantine', old.objectKey, null),
                },
              });
          }
        }
        const pending = await tx.uploadSession.aggregate({
          where: { userId: user.id, completedAt: null, expiresAt: { gt: new Date() } },
          _sum: { declaredSize: true },
          _count: true,
        });
        const used = await tx.trackAsset.aggregate({
          where: { kind: 'ORIGINAL', track: { authorId: user.id, deletedAt: null } },
          _sum: { size: true },
        });
        if (
          pending._count >= 3 ||
          Number(pending._sum.declaredSize ?? 0) + Number(used._sum.size ?? 0) + input.size >
            Number(process.env.AUTHOR_QUOTA_BYTES ?? 1073741824)
        )
          conflict('QUOTA_EXCEEDED', 'Đã đạt giới hạn dung lượng hoặc số phiên tải lên đang chờ.');
        let track;
        if (trackId) {
          track = await tx.track.findFirst({
            where: { id: trackId, authorId: user.id, deletedAt: null },
          });
          if (!track) throw new NotFoundException({ code: 'TRACK_NOT_FOUND' });
          if (!artwork) {
            if (track.publicationState === 'PUBLISHED')
              conflict('UNPUBLISH_REQUIRED', 'Gỡ phát hành trước khi thay tệp âm thanh.');
            track = await tx.track.update({
              where: { id: track.id },
              data: {
                sourceVersion: { increment: 1 },
                processingState: 'DRAFT',
                playbackAssetId: null,
              },
            });
          }
        } else {
          const genres = (await resolveGenreSelection(tx, input)) ?? [];
          track = await tx.track.create({
            data: {
              authorId: user.id,
              title: input.title!,
              description: input.description ?? '',
              genre: genreProjection(genres),
              downloadEnabled: input.downloadEnabled ?? false,
            },
          });
          await replaceTrackGenres(tx, track.id, genres);
        }
        if (artwork) await reserveImageQuota(tx, user.id, input.size);
        return tx.uploadSession.create({
          data: {
            userId: user.id,
            trackId: track.id,
            sourceVersion: track.sourceVersion,
            kind: artwork ? 'ARTWORK' : 'ORIGINAL',
            objectKey: artwork
              ? `images/cover/${user.id}/${randomUUID()}`
              : `pending/${user.id}/${randomUUID()}`,
            declaredSize: BigInt(input.size),
            contentType: input.contentType,
            filename: input.filename,
            idempotencyKey: input.idempotencyKey,
            payloadHash,
            expiresAt: new Date(Date.now() + 300000),
          },
        });
      });
    }
    if (artwork && !session.objectKey.startsWith(`images/cover/${user.id}/`))
      conflict('UPLOAD_EXPIRED', 'Phiên ảnh cũ đã kết thúc. Hãy chọn lại ảnh để tạo phiên mới.');
    const expiresAt = artwork
      ? new Date(Math.min(session.expiresAt.getTime(), Date.now() + 120000))
      : session.expiresAt;
    const url = artwork
      ? await imageUploadUrl(
          session.objectKey,
          session.contentType,
          Number(session.declaredSize),
          Math.ceil((expiresAt.getTime() - Date.now()) / 1000),
        )
      : await uploadUrl(
          session.objectKey,
          session.contentType,
          Math.floor((session.expiresAt.getTime() - Date.now()) / 1000),
        );
    return {
      uploadId: session.id,
      trackId: session.trackId,
      url,
      expiresAt,
      headers: artwork
        ? { 'Content-Type': session.contentType, 'If-None-Match': '*' }
        : { 'Content-Type': session.contentType },
    };
  }
  @Author()
  @Delete('uploads/:id')
  @ApiOperation({ summary: 'Hủy phiên ảnh bìa đang chờ, giữ nguyên ảnh bìa và âm thanh hiện tại' })
  async cancelArtworkUpload(@Current() user: Identity, @Param('id') id: string) {
    throttle(`artwork-cancel:${user.id}`, 20, 600000);
    const uploadId = uuid(id);
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id=${user.id}::uuid FOR UPDATE`;
      const upload = await tx.uploadSession.findFirst({
        where: { id: uploadId, userId: user.id, kind: 'ARTWORK' },
      });
      if (!upload || upload.completedAt || upload.expiresAt <= new Date()) return;
      await tx.uploadSession.update({ where: { id: upload.id }, data: { expiresAt: new Date() } });
      await tx.outboxEvent.create({
        data: {
          type: 'OBJECT_DELETE',
          payload: imageDeletePayload('uploads-quarantine', upload.objectKey, null),
        },
      });
    });
    return {
      message:
        'Phiên ảnh bìa đã được hủy nếu còn chờ. Ảnh bìa và âm thanh hiện tại được giữ nguyên.',
    };
  }
  @Author()
  @Post('uploads/:id/complete')
  @HttpCode(202)
  async complete(@Current() user: Identity, @Param('id') id: string) {
    const upload = await db.uploadSession.findFirst({ where: { id: uuid(id), userId: user.id } });
    if (!upload) throw new NotFoundException({ code: 'UPLOAD_NOT_FOUND' });
    if (upload.completedAt)
      return {
        trackId: upload.trackId,
        taskId: upload.taskId,
        processingState: upload.kind === 'ARTWORK' ? 'READY' : 'QUEUED',
      };
    if (upload.expiresAt < new Date()) conflict('UPLOAD_EXPIRED', 'Phiên tải lên đã hết hạn.');
    const track = await requireOwner(upload.trackId, user);
    if (track.sourceVersion !== upload.sourceVersion)
      conflict('SOURCE_VERSION_CHANGED', 'Nguồn âm thanh đã được thay thế.');
    if (upload.kind === 'ARTWORK') return this.completeArtwork(user, upload);
    const client = storageClient('API');
    let head;
    try {
      head = await client.send(
        new HeadObjectCommand({ Bucket: upload.bucket, Key: upload.objectKey }),
      );
    } catch {
      throw new BadRequestException({
        code: 'UPLOAD_MISSING',
        message: 'Chưa nhận được tệp tải lên.',
      });
    }
    const size = Number(head.ContentLength ?? 0);
    if (!size || size !== Number(upload.declaredSize) || size > 256 * 1024 * 1024)
      throw new BadRequestException({
        code: 'UPLOAD_SIZE_MISMATCH',
        message: 'Dung lượng tệp không khớp hoặc vượt giới hạn.',
      });
    if (!head.ETag)
      conflict(
        'STORAGE_CONTRACT_UNAVAILABLE',
        'Storage chưa cung cấp điều kiện chốt tệp. Vui lòng thử lại sau.',
      );
    const sealedKey = `sealed/${track.id}/${track.sourceVersion}/${randomUUID()}`;
    let sealedVersionId: string | undefined;
    try {
      const sourcePath = `/${upload.bucket}/${encodeURIComponent(upload.objectKey).replace(/%2F/g, '/')}`;
      const pinnedSource = head.VersionId
        ? `${sourcePath}?versionId=${encodeURIComponent(head.VersionId)}`
        : sourcePath;
      const copied = await client.send(
        new CopyObjectCommand({
          Bucket: 'audio-originals',
          Key: sealedKey,
          CopySource: pinnedSource,
          CopySourceIfMatch: head.ETag,
          MetadataDirective: 'REPLACE',
          ContentType: upload.contentType,
        }),
      );
      const sealed = await client.send(
        new HeadObjectCommand({
          Bucket: 'audio-originals',
          Key: sealedKey,
          VersionId: copied.VersionId,
        }),
      );
      if (sealed.ContentLength !== head.ContentLength) throw new Error('COPY_SIZE_MISMATCH');
      if (copied.VersionId && sealed.VersionId && copied.VersionId !== sealed.VersionId)
        throw new Error('COPY_VERSION_MISMATCH');
      sealedVersionId = copied.VersionId ?? sealed.VersionId;
    } catch {
      conflict('SOURCE_CHANGED', 'Tệp đang thay đổi. Hãy tải lên và hoàn tất lại.');
    }
    const result = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM upload_sessions WHERE id=${upload.id}::uuid FOR UPDATE`;
      const current = await tx.uploadSession.findUniqueOrThrow({ where: { id: upload.id } });
      if (current.completedAt)
        return { trackId: track.id, taskId: current.taskId, processingState: 'QUEUED' };
      await tx.$queryRaw`SELECT id FROM tracks WHERE id=${track.id}::uuid FOR UPDATE`;
      const latest = await tx.track.findUniqueOrThrow({ where: { id: track.id } });
      if (latest.deletedAt || latest.sourceVersion !== upload.sourceVersion)
        conflict('SOURCE_VERSION_CHANGED', 'Nguồn âm thanh đã thay đổi.');
      const asset = await tx.trackAsset.create({
        data: {
          trackId: track.id,
          sourceVersion: track.sourceVersion,
          pipelineVersion: PIPELINE_VERSION,
          kind: 'ORIGINAL',
          bucket: 'audio-originals',
          key: sealedKey,
          versionId: sealedVersionId,
          size: BigInt(size),
          contentType: upload.contentType,
        },
      });
      const task = await tx.processingTask.create({
        data: {
          trackId: track.id,
          sourceVersion: track.sourceVersion,
          pipelineVersion: PIPELINE_VERSION,
          sourceBucket: asset.bucket,
          sourceKey: asset.key,
          sourceVersionId: asset.versionId,
        },
      });
      await tx.outboxEvent.create({
        data: { type: 'AUDIO_PROCESS', payload: { taskId: task.id } },
      });
      await tx.track.update({
        where: { id: track.id },
        data: { processingState: 'QUEUED', pipelineVersion: PIPELINE_VERSION },
      });
      await tx.uploadSession.update({
        where: { id: upload.id },
        data: { completedAt: new Date(), taskId: task.id },
      });
      return { trackId: track.id, taskId: task.id, processingState: 'QUEUED' };
    });
    return result;
  }
  private async completeArtwork(
    user: Identity,
    upload: Prisma.UploadSessionGetPayload<Record<string, never>>,
  ) {
    throttle(`artwork-complete:${user.id}`, 10, 600000);
    return runImageJob(async () => {
      const snapshot = await readImageSnapshot(
        upload.objectKey,
        Number(upload.declaredSize),
        upload.contentType,
      );
      const output = await normalizeImage(snapshot.input, upload.contentType, 'cover');
      const key = `cover/${upload.trackId}/${randomUUID()}.webp`,
        client = storageClient('API');
      let versionId: string | null = null,
        attached = false;
      try {
        const stored = await client.send(
          new PutObjectCommand({
            Bucket: 'artwork',
            Key: key,
            Body: output,
            ContentType: 'image/webp',
            CacheControl: 'private, max-age=300',
          }),
          { abortSignal: AbortSignal.timeout(10000) },
        );
        versionId = stored.VersionId ?? null;
        attached = await db.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM users WHERE id=${user.id}::uuid FOR UPDATE`;
          await tx.$queryRaw`SELECT id FROM upload_sessions WHERE id=${upload.id}::uuid FOR UPDATE`;
          const current = await tx.uploadSession.findUniqueOrThrow({ where: { id: upload.id } });
          if (current.completedAt) return false;
          if (current.expiresAt <= new Date())
            conflict('UPLOAD_EXPIRED', 'Phiên ảnh đã hết hạn. Hãy chọn lại ảnh.');
          await tx.$queryRaw`SELECT id FROM tracks WHERE id=${upload.trackId}::uuid FOR UPDATE`;
          const track = await tx.track.findFirst({
            where: {
              id: upload.trackId,
              authorId: user.id,
              deletedAt: null,
              sourceVersion: upload.sourceVersion,
            },
          });
          if (!track) conflict('SOURCE_VERSION_CHANGED', 'Bài hát đã thay đổi.');
          const previous = track.artworkAssetId
            ? await tx.trackAsset.findUnique({ where: { id: track.artworkAssetId } })
            : null;
          const checksum = createHash('sha256').update(output).digest('hex');
          const asset = await tx.trackAsset.upsert({
            where: {
              trackId_sourceVersion_pipelineVersion_kind: {
                trackId: track.id,
                sourceVersion: track.sourceVersion,
                pipelineVersion: PIPELINE_VERSION,
                kind: 'ARTWORK',
              },
            },
            create: {
              trackId: track.id,
              sourceVersion: track.sourceVersion,
              pipelineVersion: PIPELINE_VERSION,
              kind: 'ARTWORK',
              bucket: 'artwork',
              key,
              versionId,
              size: BigInt(output.length),
              contentType: 'image/webp',
              checksum,
              verified: true,
            },
            update: { key, versionId, size: BigInt(output.length), checksum, verified: true },
          });
          await tx.track.update({ where: { id: track.id }, data: { artworkAssetId: asset.id } });
          await tx.uploadSession.update({
            where: { id: upload.id },
            data: { completedAt: new Date() },
          });
          if (previous && previous.key !== key)
            await tx.outboxEvent.create({
              data: {
                type: 'OBJECT_DELETE',
                payload: imageDeletePayload('artwork', previous.key, previous.versionId),
              },
            });
          await tx.outboxEvent.create({
            data: {
              type: 'OBJECT_DELETE',
              payload: imageDeletePayload(
                'uploads-quarantine',
                upload.objectKey,
                snapshot.versionId,
              ),
            },
          });
          return true;
        });
      } finally {
        client.destroy();
        if (!attached)
          try {
            await db.outboxEvent.create({
              data: {
                type: 'OBJECT_DELETE',
                payload: imageDeletePayload('artwork', key, versionId),
              },
            });
          } catch {
            /* Orphan sweep retries reference-aware cleanup. */
          }
      }
      return { trackId: upload.trackId, taskId: null, processingState: 'READY' };
    });
  }
  @Author()
  @Get('tracks/:id/processing')
  async processing(@Current() user: Identity, @Param('id') id: string) {
    const track = await requireOwner(id, user);
    const task = await db.processingTask.findUnique({
      where: {
        trackId_sourceVersion_pipelineVersion: {
          trackId: track.id,
          sourceVersion: track.sourceVersion,
          pipelineVersion: track.pipelineVersion,
        },
      },
      select: { id: true, status: true, attempts: true, errorCode: true, updatedAt: true },
    });
    return {
      trackId: track.id,
      processingState: track.processingState,
      publicationState: track.publicationState,
      task,
    };
  }
  @Author()
  @Patch('tracks/:id')
  @ApiBody({ schema: metadataBody })
  @ApiOkResponse({ schema: fullTrackView })
  async update(@Current() user: Identity, @Param('id') id: string, @Body() body: unknown) {
    const track = await requireOwner(id, user),
      input = validate(metadataSchema, body);
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM tracks WHERE id=${track.id}::uuid AND author_id=${user.id}::uuid AND deleted_at IS NULL FOR UPDATE`;
      if (
        !(await tx.track.findFirst({
          where: { id: track.id, authorId: user.id, deletedAt: null },
          select: { id: true },
        }))
      )
        throw new NotFoundException({
          code: 'TRACK_NOT_FOUND',
          message: 'Không tìm thấy bài hát.',
        });
      const genres = await resolveGenreSelection(tx, input, track.id);
      const { genre: _legacyGenre, genreIds: _genreIds, ...metadata } = input;
      if (genres !== undefined) await replaceTrackGenres(tx, track.id, genres);
      await tx.track.update({
        where: { id: track.id },
        data: { ...metadata, ...(genres !== undefined ? { genre: genreProjection(genres) } : {}) },
      });
    });
    return this.track(track.id, user);
  }
  @Author()
  @Post('tracks/:id/retry-processing')
  @HttpCode(202)
  async retry(@Current() user: Identity, @Param('id') id: string) {
    const track = await requireOwner(id, user);
    return db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM processing_tasks WHERE track_id=${track.id}::uuid AND source_version=${track.sourceVersion} AND pipeline_version=${track.pipelineVersion} FOR UPDATE`;
      const task = await tx.processingTask.findUnique({
        where: {
          trackId_sourceVersion_pipelineVersion: {
            trackId: track.id,
            sourceVersion: track.sourceVersion,
            pipelineVersion: track.pipelineVersion,
          },
        },
      });
      if (!task || task.status !== 'FAILED')
        conflict('RETRY_NOT_ALLOWED', 'Không thể thử lại công việc này.');
      if (
        ![
          'PROCESSING_TEMPORARY_FAILURE',
          'PROCESSING_CANCELLED',
          'ATTEMPTS_EXHAUSTED',
          'INVALID_AUDIO',
        ].includes(task.errorCode ?? '')
      )
        conflict(
          'REPLACE_SOURCE_REQUIRED',
          'Tệp không hợp lệ hoặc nguồn đã thay đổi. Hãy thay tệp âm thanh.',
        );
      throttle(`processing-retry-v2:${user.id}`, 1, 10000);
      await tx.processingTask.update({
        where: { id: task.id },
        data: {
          status: 'QUEUED',
          attempts: 0,
          errorCode: null,
          runToken: null,
          leaseExpiresAt: null,
          nextAttemptAt: new Date(),
        },
      });
      const current = await tx.track.updateMany({
        where: {
          id: track.id,
          authorId: user.id,
          sourceVersion: track.sourceVersion,
          pipelineVersion: track.pipelineVersion,
          deletedAt: null,
        },
        data: { processingState: 'QUEUED' },
      });
      if (!current.count) conflict('SOURCE_VERSION_CHANGED', 'Nguồn âm thanh đã thay đổi.');
      await tx.outboxEvent.create({
        data: { type: 'AUDIO_PROCESS', payload: { taskId: task.id } },
      });
      return { taskId: task.id, processingState: 'QUEUED', retryAfterSeconds: 10 };
    });
  }
  @Author()
  @Post('tracks/:id/publish')
  async publish(@Current() user: Identity, @Param('id') id: string) {
    const track = await requireOwner(id, user);
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM tracks WHERE id=${track.id}::uuid FOR UPDATE`;
      const current = await tx.track.findUniqueOrThrow({ where: { id: track.id } });
      if (current.deletedAt || current.processingState !== 'READY' || !current.playbackAssetId)
        conflict('TRACK_NOT_READY', 'Bài hát chưa sẵn sàng để phát hành.');
      const asset = await tx.trackAsset.findFirst({
        where: {
          id: current.playbackAssetId,
          sourceVersion: current.sourceVersion,
          verified: true,
        },
      });
      if (!asset) conflict('TRACK_NOT_READY', 'Tệp nghe chưa sẵn sàng.');
      await tx.track.update({
        where: { id: track.id },
        data: { publicationState: 'PUBLISHED', publishedAt: current.publishedAt ?? new Date() },
      });
      if (!(await tx.releaseEvent.findUnique({ where: { trackId: track.id } }))) {
        const release = await tx.releaseEvent.create({
          data: { trackId: track.id, authorId: user.id },
        });
        await tx.outboxEvent.create({
          data: { type: 'RELEASE', payload: { releaseEventId: release.id } },
        });
      }
    });
    return this.track(track.id, user);
  }
  @Author() @Post('tracks/:id/unpublish') async unpublish(
    @Current() user: Identity,
    @Param('id') id: string,
  ) {
    const track = await requireOwner(id, user);
    await db.track.update({ where: { id: track.id }, data: { publicationState: 'UNPUBLISHED' } });
    return this.track(track.id, user);
  }
  @Author() @Delete('tracks/:id') async remove(@Current() user: Identity, @Param('id') id: string) {
    const track = await requireOwner(id, user);
    await db.track.update({
      where: { id: track.id },
      data: { deletedAt: new Date(), publicationState: 'UNPUBLISHED' },
    });
    return { message: 'Đã xóa bài hát.' };
  }
  @Public()
  @Get('tracks/:id/playback') async playback(
    @Current() user: Identity | undefined, @Param('id') id: string,
    @Req() req: AuthRequest, @Res({ passthrough: true }) res: Response,
  ) {
    if (!user) throttle(`visitor-playback-ip:${req.ip}`, 120);
    return this.signedPlayback(user, id, false, req, res);
  }
  @Get('tracks/:id/download') async download(@Current() user: Identity, @Param('id') id: string) {
    return this.signedPlayback(user, id, true);
  }
  @Public()
  @Post('tracks/:id/listens')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Record a qualified account or browser-visitor listen; one per listener/track/source in30 minutes',
  })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['token'],
      properties: { token: { type: 'string', minLength: 1, maxLength: 4096 } },
    },
  })
  @ApiOkResponse({
    schema: { type: 'object', required: ['counted'], properties: { counted: { type: 'boolean' } } },
  })
  async listen(@Current() user: Identity | undefined, @Param('id') id: string, @Body() body: unknown, @Req() req: AuthRequest) {
    if (req.headers['x-infosound-csrf'] !== '1') {
      throw new ForbiddenException({ code: 'CSRF_HEADER_REQUIRED', message: 'Thiếu xác nhận yêu cầu.' });
    }
    const input = validate(z.object({ token: z.string().min(1).max(4096) }).strict(), body);
    const listener = user ?? visitorListener(req);
    if ('visitorId' in listener) {
      throttle(`visitor-listen-ip:${req.ip}`, 120);
      throttle(`visitor-listen:${visitorListenHash(listener.visitorId)}`, 60);
    } else throttle(`listen:${listener.id}`, 60);
    return countListen(listener, uuid(id), input.token);
  }
  private async signedPlayback(user: Identity | undefined, id: string, download: boolean, req?: AuthRequest, res?: Response) {
    const track = await db.track.findFirst({
      where: { id: uuid(id), ...publicTrackWhere, author: { active: true } },
      include: trackInclude,
    });
    if (!track)
      throw new NotFoundException({
        code: 'TRACK_UNAVAILABLE',
        message: 'Bài hát hiện không khả dụng.',
      });
    if (download && !track.downloadEnabled)
      conflict('DOWNLOAD_DISABLED', 'Nghệ sĩ chưa cho phép tải xuống.');
    const asset = track.playbackAssetId
      ? await db.trackAsset.findUnique({ where: { id: track.playbackAssetId } })
      : null;
    if (!asset?.verified || asset.trackId !== track.id || asset.sourceVersion !== track.sourceVersion)
      throw new NotFoundException({ code: 'ASSET_UNAVAILABLE' });
    const extension = track.outputCodec === 'flac' ? 'flac' : 'mp3';
    const listen = download || req?.method === 'HEAD'
      ? null : createListenToken(user ?? visitorListener(req!, res), track);
    return {
      url: await mediaUrl(asset.bucket, asset.key, {
        versionId: asset.versionId,
        filename: download ? `${track.title}.${extension}` : undefined,
      }),
      headUrl: await mediaHeadUrl(asset.bucket, asset.key, asset.versionId),
      expiresAt: new Date(Date.now() + 300000),
      contentType: asset.contentType,
      checksum: asset.checksum,
      track: await viewTrack(track, user),
      ...(listen ? { listen } : {}),
    };
  }
  @Put('tracks/:id/like') async like(@Current() user: Identity, @Param('id') id: string) {
    const track = await db.track.findFirst({ where: { id: uuid(id), ...publicTrackWhere } });
    if (!track) throw new NotFoundException({ code: 'TRACK_UNAVAILABLE' });
    await db.trackLike.upsert({
      where: { userId_trackId: { userId: user.id, trackId: id } },
      create: { userId: user.id, trackId: id },
      update: {},
    });
    return { liked: true };
  }
  @Delete('tracks/:id/like') async unlike(@Current() user: Identity, @Param('id') id: string) {
    await db.trackLike.deleteMany({ where: { userId: user.id, trackId: uuid(id) } });
    return { liked: false };
  }
}
