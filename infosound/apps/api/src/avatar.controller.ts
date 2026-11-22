import { Body, Controller, Delete, NotFoundException, Param, Post } from '@nestjs/common';
import { ApiBody, ApiTags } from '@nestjs/swagger';
import { createHash, randomUUID } from 'node:crypto';
import { db, Prisma } from '@infosound/database';
import { hashToken, imageUploadSchema } from '@infosound/contracts';
import { PutObjectCommand, storageClient, imageUploadUrl } from '@infosound/storage';
import { Current, Identity } from './security';
import { conflict, throttle, uuid, validate } from './helpers';
import { publicUserSelect } from './auth-session';
import { withAvatar } from './user-view';
import { imageUploadBody } from './openapi';
import { normalizeImage, runImageJob } from './image-processing';
import { imageDeletePayload, readImageSnapshot } from './image-storage';
import { reserveImageQuota } from './image-quota';

const ownerRow = (userId: string) =>
  db.user.findUniqueOrThrow({ where: { id: userId }, select: publicUserSelect });
async function avatarResult(userId: string) {
  const user = await withAvatar(await ownerRow(userId));
  return { avatarUrl: user.avatarUrl, user };
}
function deletion(tx: Prisma.TransactionClient, key: string, versionId: string | null) {
  return tx.outboxEvent.create({
    data: { type: 'OBJECT_DELETE', payload: imageDeletePayload('artwork', key, versionId) },
  });
}
async function discardOutput(key: string, versionId: string | null) {
  try {
    await db.outboxEvent.create({
      data: { type: 'OBJECT_DELETE', payload: imageDeletePayload('artwork', key, versionId) },
    });
  } catch {
    /* Reference-aware orphan sweep also removes unattached generated images. */
  }
}

@ApiTags('InfoSound profile images')
@Controller('api/v1/me/avatar')
export class AvatarController {
  @Post('uploads')
  @ApiBody({ schema: imageUploadBody })
  async initialize(@Current() identity: Identity, @Body() body: unknown) {
    const input = validate(imageUploadSchema, body);
    throttle(`avatar-init:${identity.id}`, 5, 600_000);
    const payloadHash = hashToken(JSON.stringify(input));
    const session = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id=${identity.id}::uuid FOR UPDATE`;
      const existing = await tx.avatarUpload.findUnique({
        where: {
          userId_idempotencyKey: { userId: identity.id, idempotencyKey: input.idempotencyKey },
        },
      });
      if (existing) {
        if (existing.payloadHash !== payloadHash)
          conflict('IDEMPOTENCY_CONFLICT', 'Yêu cầu đã được dùng cho ảnh khác. Hãy chọn lại ảnh.');
        if (existing.expiresAt <= new Date() || existing.completedAt)
          conflict('UPLOAD_EXPIRED', 'Phiên ảnh đã kết thúc. Hãy chọn lại ảnh.');
        return existing;
      }
      if (
        await tx.avatarUpload.count({
          where: { userId: identity.id, completedAt: null, expiresAt: { gt: new Date() } },
        })
      )
        conflict(
          'IMAGE_UPLOAD_IN_PROGRESS',
          'Bạn đang có ảnh tải lên. Hãy hoàn tất hoặc đợi phiên hiện tại hết hạn.',
        );
      const user = await tx.user.findUniqueOrThrow({
        where: { id: identity.id },
        select: { avatarRevision: true },
      });
      await reserveImageQuota(tx, identity.id, input.size);
      return tx.avatarUpload.create({
        data: {
          userId: identity.id,
          objectKey: `images/avatar/${identity.id}/${randomUUID()}`,
          declaredSize: BigInt(input.size),
          contentType: input.contentType,
          filename: input.filename,
          idempotencyKey: input.idempotencyKey,
          payloadHash,
          revision: user.avatarRevision,
          expiresAt: new Date(Date.now() + 300_000),
        },
      });
    });
    const expiresAt = new Date(Math.min(session.expiresAt.getTime(), Date.now() + 120_000));
    return {
      uploadId: session.id,
      url: await imageUploadUrl(
        session.objectKey,
        session.contentType,
        Number(session.declaredSize),
        Math.ceil((expiresAt.getTime() - Date.now()) / 1000),
      ),
      expiresAt,
      headers: { 'Content-Type': session.contentType, 'If-None-Match': '*' },
    };
  }

  @Post('uploads/:id/complete')
  async complete(@Current() identity: Identity, @Param('id') id: string) {
    const session = await db.avatarUpload.findFirst({
      where: { id: uuid(id), userId: identity.id },
    });
    if (!session)
      throw new NotFoundException({
        code: 'UPLOAD_NOT_FOUND',
        message: 'Không tìm thấy phiên tải ảnh.',
      });
    if (session.completedAt) return avatarResult(identity.id);
    if (session.expiresAt <= new Date())
      conflict('UPLOAD_EXPIRED', 'Phiên tải ảnh đã hết hạn. Hãy chọn lại ảnh.');
    throttle(`avatar-complete:${identity.id}`, 10, 600_000);
    return runImageJob(async () => {
      const snapshot = await readImageSnapshot(
        session.objectKey,
        Number(session.declaredSize),
        session.contentType,
      );
      const output = await normalizeImage(snapshot.input, session.contentType, 'avatar');
      const key = `avatar/${identity.id}/${randomUUID()}.webp`;
      const client = storageClient('API');
      let storedVersion: string | null = null,
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
          { abortSignal: AbortSignal.timeout(10_000) },
        );
        storedVersion = stored.VersionId ?? null;
        attached = await db.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM users WHERE id=${identity.id}::uuid FOR UPDATE`;
          await tx.$queryRaw`SELECT id FROM avatar_uploads WHERE id=${session.id}::uuid FOR UPDATE`;
          const current = await tx.avatarUpload.findUniqueOrThrow({ where: { id: session.id } });
          if (current.completedAt) return false;
          const user = await tx.user.findUniqueOrThrow({
            where: { id: identity.id },
            select: { avatarKey: true, avatarVersionId: true, avatarRevision: true },
          });
          if (current.expiresAt <= new Date() || current.revision !== user.avatarRevision)
            conflict('UPLOAD_EXPIRED', 'Ảnh đại diện đã thay đổi. Hãy chọn lại ảnh.');
          await tx.user.update({
            where: { id: identity.id },
            data: {
              avatarKey: key,
              avatarVersionId: storedVersion,
              avatarChecksum: createHash('sha256').update(output).digest('hex'),
              avatarSize: BigInt(output.length),
              avatarRevision: { increment: 1 },
            },
          });
          await tx.avatarUpload.update({
            where: { id: current.id },
            data: { completedAt: new Date() },
          });
          if (user.avatarKey) await deletion(tx, user.avatarKey, user.avatarVersionId);
          await tx.outboxEvent.create({
            data: {
              type: 'OBJECT_DELETE',
              payload: imageDeletePayload(
                'uploads-quarantine',
                session.objectKey,
                snapshot.versionId,
              ),
            },
          });
          return true;
        });
      } finally {
        client.destroy();
        if (!attached) await discardOutput(key, storedVersion);
      }
      return avatarResult(identity.id);
    });
  }

  @Delete()
  async remove(@Current() identity: Identity) {
    throttle(`avatar-remove:${identity.id}`, 10, 600_000);
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id=${identity.id}::uuid FOR UPDATE`;
      const user = await tx.user.findUniqueOrThrow({
        where: { id: identity.id },
        select: { avatarKey: true, avatarVersionId: true },
      });
      await tx.avatarUpload.updateMany({
        where: { userId: identity.id, completedAt: null, expiresAt: { gt: new Date() } },
        data: { expiresAt: new Date() },
      });
      await tx.user.update({
        where: { id: identity.id },
        data: {
          avatarKey: null,
          avatarVersionId: null,
          avatarChecksum: null,
          avatarSize: null,
          avatarRevision: { increment: 1 },
        },
      });
      if (user.avatarKey) await deletion(tx, user.avatarKey, user.avatarVersionId);
    });
    return avatarResult(identity.id);
  }

  @Delete('uploads/:id')
  async cancelUpload(@Current() identity: Identity, @Param('id') id: string) {
    throttle(`avatar-cancel:${identity.id}`, 10, 600_000);
    const uploadId = uuid(id);
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id=${identity.id}::uuid FOR UPDATE`;
      const session = await tx.avatarUpload.findFirst({
        where: { id: uploadId, userId: identity.id },
      });
      if (!session || session.completedAt) return;
      await tx.avatarUpload.update({ where: { id: session.id }, data: { expiresAt: new Date() } });
      await tx.outboxEvent.create({
        data: {
          type: 'OBJECT_DELETE',
          payload: imageDeletePayload('uploads-quarantine', session.objectKey, null),
        },
      });
    });
    return {
      message: 'Yêu cầu tải ảnh đã được hủy nếu còn chờ. Ảnh đại diện hiện tại được giữ nguyên.',
    };
  }
}
