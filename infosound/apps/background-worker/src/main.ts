import { OutboxFailure, safeDeliveryFailure, record, uuid } from './outbox-validation.js';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import nodemailer from 'nodemailer';
import { db, Prisma, secret } from '@infosound/database';
import { decryptMailEnvelope } from '@infosound/contracts';
import {
  DeleteObjectCommand,
  ListObjectsV2Command,
  ListObjectVersionsCommand,
  storageClient,
} from '@infosound/storage';
import { loadSmtpConfiguration } from './smtp.js';
import { reconcileWaveforms } from './waveform-jobs.js';
import {
  createGeminiProvider,
  createModerationService,
  loadConfig,
} from '@infosound/comment-moderation/server';

const log = (event: string, fields: Record<string, unknown> = {}) =>
  process.stdout.write(
    `${JSON.stringify({ service: 'background-worker', event, ...fields, time: new Date().toISOString() })}\n`,
  );
const redis = new Redis({
  host: process.env.REDIS_HOST || 'redis',
  port: Number(process.env.REDIS_PORT || 6379),
  username: process.env.REDIS_USERNAME || 'queue',
  password: secret('REDIS_PASSWORD'),
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false,
  connectTimeout: 3000,
  commandTimeout: 5000,
});
redis.on('error', () => log('redis_connection_error'));
const queue = new Queue<{ taskId?: string; waveformTrackId?: string }>('audio', {
  connection: redis,
  prefix: 'bull',
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 20_000, jitter: 0.2 },
    removeOnComplete: { count: 100, age: 86400 },
    removeOnFail: { count: 100, age: 604800 },
  },
});
queue.on('error', () => log('queue_connection_error'));
const s3 = storageClient('CLEANER');
const smtpConfig = loadSmtpConfiguration();
const smtp = smtpConfig
  ? nodemailer.createTransport({
      host: smtpConfig.host,
      port: smtpConfig.port,
      secure: smtpConfig.secure,
      requireTLS: true,
      auth: { user: smtpConfig.username, pass: smtpConfig.password },
      tls: {
        rejectUnauthorized: true,
        minVersion: 'TLSv1.2',
        ...(smtpConfig.servername ? { servername: smtpConfig.servername } : {}),
      },
      connectionTimeout: 8000,
      greetingTimeout: 8000,
      socketTimeout: 10000,
      disableFileAccess: true,
      disableUrlAccess: true,
      logger: false,
      debug: false,
    })
  : null;
const mailKey = secret('MAIL_ENCRYPTION_KEY');
let stopping = false;
const stopController = new AbortController();
const moderationConfig = loadConfig();
log('comment_moderation_configuration', {
  provider: 'gemini',
  model: moderationConfig.model,
  key_present: moderationConfig.keyPresent,
  configured: moderationConfig.enabled,
  invalid_variables: moderationConfig.errors,
  connection: 'unverified',
});
const commentModeration = createModerationService({
  db,
  config: moderationConfig,
  provider: createGeminiProvider(moderationConfig),
});

async function enqueueTask(taskId: string): Promise<void> {
  // BullMQ's offline-queue flag alone still waits forever when Redis is absent at startup.
  // Inspect the explicit producer connection before touching any Queue method.
  if (redis.status !== 'ready') throw new Error('QUEUE_UNAVAILABLE');
  const task = await db.processingTask.findUnique({ where: { id: taskId } });
  if (!task || task.status === 'SUCCEEDED' || task.status === 'FAILED') return;
  if (task.nextAttemptAt > new Date()) return;
  if (task.status === 'PROCESSING' && task.leaseExpiresAt && task.leaseExpiresAt > new Date())
    return;
  const jobId = `audio-${taskId}`; // BullMQ identifiers must not contain ':'.
  const existing = await queue.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (['active', 'waiting', 'delayed', 'prioritized', 'waiting-children'].includes(state)) return;
    if (state === 'failed' || state === 'completed') await existing.remove();
    else return;
  }
  await queue.add('process', { taskId }, { jobId });
}

async function fanoutRelease(releaseEventId: string): Promise<void> {
  // Each bounded transaction rechecks the current relation and subscription timestamp.
  for (let batch = 0; batch < 20 && !stopping; batch++) {
    const inserted = await db.$executeRaw`
      INSERT INTO notifications (id, recipient_id, release_event_id, created_at)
      SELECT gen_random_uuid(), f.user_id, r.id, NOW()
      FROM artist_follows f
      JOIN release_events r ON r.author_id = f.author_id
      JOIN tracks t ON t.id = r.track_id
      WHERE r.id = ${releaseEventId}::uuid
        AND f.notify_new_releases = TRUE AND f.subscribed_at <= r.created_at
        AND f.user_id <> r.author_id AND t.deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.recipient_id = f.user_id AND n.release_event_id = r.id)
      ORDER BY f.user_id LIMIT 500
      ON CONFLICT (recipient_id, release_event_id) DO NOTHING`;
    if (inserted < 500) return;
  }
  // Keep the outbox entry pending if a very large fanout needs another lease.
  throw new Error('RELEASE_BATCH_REMAINING');
}

async function sourceVersionReferenced(
  bucket: string,
  key: string,
  versionId: string,
): Promise<boolean> {
  // Null-version references predate pinning or deliberately identify the whole key.
  // Preserve every version until those references have been retired explicitly.
  const [assets, tasks, pending, avatars] = await Promise.all([
    db.trackAsset.count({ where: { bucket, key, OR: [{ versionId }, { versionId: null }] } }),
    db.processingTask.count({
      where: {
        sourceBucket: bucket,
        sourceKey: key,
        OR: [{ sourceVersionId: versionId }, { sourceVersionId: null }],
      },
    }),
    db.uploadSession.count({
      where: { bucket, objectKey: key, completedAt: null, expiresAt: { gt: new Date() } },
    }),
    bucket === 'uploads-quarantine'
      ? db.avatarUpload.count({
          where: { objectKey: key, completedAt: null, expiresAt: { gt: new Date() } },
        })
      : Promise.resolve(0),
  ]);
  return assets > 0 || tasks > 0 || pending > 0 || avatars > 0;
}

async function sweepSourceVersions(
  bucket: string,
  onlyKey?: string,
  onlyVersionId?: string,
): Promise<boolean> {
  const cutoff = Date.now() - 48 * 60 * 60 * 1000;
  let keyMarker: string | undefined;
  let versionIdMarker: string | undefined;
  let remaining = false;
  for (let page = 0; page < 10 && !stopping; page++) {
    const listed = await s3.send(
      new ListObjectVersionsCommand({
        Bucket: bucket,
        MaxKeys: 100,
        Prefix: onlyKey,
        KeyMarker: keyMarker,
        VersionIdMarker: versionIdMarker,
      }),
    );
    for (const version of [...(listed.Versions || []), ...(listed.DeleteMarkers || [])]) {
      if (
        !version.Key ||
        (onlyKey && version.Key !== onlyKey) ||
        (onlyVersionId && version.VersionId !== onlyVersionId)
      )
        continue;
      if (!version.VersionId || !version.LastModified || version.LastModified.getTime() > cutoff) {
        remaining = true;
        continue;
      }
      if (await sourceVersionReferenced(bucket, version.Key, version.VersionId)) {
        remaining = true;
        continue;
      }
      await s3.send(
        new DeleteObjectCommand({ Bucket: bucket, Key: version.Key, VersionId: version.VersionId }),
      );
    }
    keyMarker = listed.IsTruncated ? listed.NextKeyMarker : undefined;
    versionIdMarker = listed.IsTruncated ? listed.NextVersionIdMarker : undefined;
    if (!listed.IsTruncated) return !remaining;
    if (!keyMarker) throw new Error('INVALID_SOURCE_VERSION_PAGINATION');
  }
  // An outbox deletion remains pending when a bounded sweep has more work.
  return false;
}

async function dispatch(
  type: 'MAIL' | 'RELEASE' | 'AUDIO_PROCESS' | 'OBJECT_DELETE',
): Promise<void> {
  const now = new Date();
  const event = await db.outboxEvent.findFirst({
    where: {
      type,
      deliveredAt: null,
      availableAt: { lte: now },
      OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }],
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  if (!event) return;
  const runToken = randomUUID();
  const claimed = await db.outboxEvent.updateMany({
    where: {
      id: event.id,
      deliveredAt: null,
      OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }],
    },
    data: { runToken, leaseExpiresAt: new Date(Date.now() + 60_000), attempts: { increment: 1 } },
  });
  if (!claimed.count) return;
  try {
    let expiredMail = false;
    const payload = record(event.payload);
    if (type === 'AUDIO_PROCESS') await enqueueTask(uuid(payload.taskId));
    else if (type === 'RELEASE') await fanoutRelease(uuid(payload.releaseEventId));
    else if (type === 'OBJECT_DELETE') {
      if (
        typeof payload.bucket !== 'string' ||
        !['uploads-quarantine', 'audio-originals', 'audio-playback', 'artwork'].includes(
          payload.bucket,
        ) ||
        typeof payload.key !== 'string' ||
        !payload.key.length ||
        payload.key.length > 2048 ||
        !(payload.versionId === null || typeof payload.versionId === 'string')
      )
        throw new Error('INVALID_OBJECT_DELETE');
      const bucket = payload.bucket;
      const key = payload.key;
      if (bucket === 'uploads-quarantine' || bucket === 'audio-originals') {
        if (!(await sweepSourceVersions(bucket, key, payload.versionId || undefined)))
          throw new Error('SOURCE_VERSION_RETAINED');
      } else {
        // Conservative across versions: never delete a key if any current record
        // still references it, even if another version was originally retired.
        const referenced = await db.trackAsset.count({ where: { bucket, key } });
        const avatarReferenced =
          bucket === 'artwork' ? await db.user.count({ where: { avatarKey: key } }) : 0;
        const taskSource = await db.processingTask.count({
          where: { sourceBucket: bucket, sourceKey: key },
        });
        if (referenced || avatarReferenced || taskSource)
          throw new Error('OBJECT_STILL_REFERENCED');
        try {
          await s3.send(
            new DeleteObjectCommand({
              Bucket: bucket,
              Key: key,
              ...(payload.versionId ? { VersionId: payload.versionId } : {}),
            }),
          );
        } catch (error) {
          if (
            (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode !== 404
          )
            throw error;
          // Already removed by a prior attempt or the unreferenced-object sweep.
        }
      }
    } else {
      const expiresAt = new Date(String(payload.expiresAt));
      if (!Number.isFinite(expiresAt.getTime())) throw new OutboxFailure('MAIL_VALIDATION_FAILED');
      if (expiresAt > new Date()) {
        if (typeof payload.envelope !== 'string') throw new OutboxFailure('MAIL_VALIDATION_FAILED');
        let mail: ReturnType<typeof decryptMailEnvelope>;
        try {
          mail = decryptMailEnvelope(payload.envelope, mailKey);
        } catch {
          throw new OutboxFailure('MAIL_DECRYPTION_FAILED');
        }
        if (
          !mail ||
          typeof mail.to !== 'string' ||
          typeof mail.subject !== 'string' ||
          typeof mail.text !== 'string' ||
          /[\r\n]/.test(mail.to) ||
          /[\r\n]/.test(mail.subject)
        )
          throw new OutboxFailure('MAIL_VALIDATION_FAILED');
        if (!smtp || !smtpConfig) throw new OutboxFailure('EMAIL_UNAVAILABLE');
        await smtp.sendMail({
          from: smtpConfig.from,
          to: mail.to,
          subject: mail.subject,
          text: mail.text,
          messageId: `<${event.id}@infosound.local>`,
          headers: { 'X-InfoSound-Event': event.id },
        });
      } else expiredMail = true;
    }
    await db.outboxEvent.updateMany({
      where: { id: event.id, runToken },
      data: { deliveredAt: new Date(), leaseExpiresAt: null, payload: {} },
    });
    log(expiredMail ? 'outbox_expired' : 'outbox_delivered', { eventId: event.id, type });
  } catch (error) {
    await db.outboxEvent.updateMany({
      where: { id: event.id, runToken },
      data: {
        leaseExpiresAt: null,
        availableAt: new Date(
          Date.now() +
            Math.min(300_000, 1000 * 2 ** Math.min(event.attempts + 1, 8)) +
            Math.floor(Math.random() * 500),
        ),
      },
    });
    log('outbox_retry_scheduled', { eventId: event.id, type, ...safeDeliveryFailure(error) });
  }
}

async function reconcile(): Promise<void> {
  const now = new Date();
  const exhausted = await db.processingTask.findMany({
    where: { status: 'PROCESSING', leaseExpiresAt: { lt: now }, attempts: { gte: 3 } },
    take: 50,
  });
  for (const task of exhausted)
    await db.$transaction(async (tx) => {
      const changed = await tx.processingTask.updateMany({
        where: {
          id: task.id,
          status: 'PROCESSING',
          leaseExpiresAt: { lt: now },
          runToken: task.runToken,
        },
        data: { status: 'FAILED', errorCode: 'ATTEMPTS_EXHAUSTED', leaseExpiresAt: null },
      });
      if (changed.count)
        await tx.track.updateMany({
          where: {
            id: task.trackId,
            sourceVersion: task.sourceVersion,
            pipelineVersion: task.pipelineVersion,
            deletedAt: null,
          },
          data: { processingState: 'FAILED' },
        });
    });
  const pending = await db.processingTask.findMany({
    where: {
      attempts: { lt: 3 },
      nextAttemptAt: { lte: now },
      OR: [{ status: 'QUEUED' }, { status: 'PROCESSING', leaseExpiresAt: { lt: now } }],
    },
    orderBy: { updatedAt: 'asc' },
    take: 25,
  });
  for (const task of pending) {
    if (stopping) break;
    try {
      await enqueueTask(task.id);
    } catch {
      break;
    }
  }
}

async function cleanup(): Promise<void> {
  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);
  const retired = await db.track.findMany({
    where: {
      deletedAt: { lte: cutoff },
      OR: [
        { playbackAssetId: { not: null } },
        { artworkAssetId: { not: null } },
        { assets: { some: {} } },
        { tasks: { some: {} } },
        { uploads: { some: {} } },
      ],
    },
    select: { id: true },
    orderBy: { deletedAt: 'asc' },
    take: 10,
  });
  for (const track of retired) {
    // The tightly scoped DB function rechecks age and leases under locks,
    // retires pointers/references and creates deletion outbox events atomically.
    await db.$queryRaw`SELECT public.infosound_prepare_deleted_track_cleanup(${track.id}::uuid, ${cutoff}::timestamptz)`;
  }
  const yesterday = new Date(Date.now() - 86_400_000);
  await sweepSourceVersions('uploads-quarantine');
  await sweepSourceVersions('audio-originals');
  // Retain completed upload sessions for idempotency; reserve quota ignores expired reservations.
  await db.pendingRegistration.deleteMany({ where: { expiresAt: { lt: yesterday } } });
  await db.oAuthFlow.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  await db.emailOtpChallenge.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  await db.avatarUpload.deleteMany({ where: { expiresAt: { lt: yesterday } } });
  await db.passwordResetRequest.deleteMany({ where: { expiresAt: { lt: yesterday } } });
  await db.authSession.deleteMany({ where: { expiresAt: { lt: yesterday } } });
  await db.outboxEvent.updateMany({
    where: { type: 'MAIL', deliveredAt: null, createdAt: { lt: yesterday } },
    data: { deliveredAt: new Date(), payload: {}, leaseExpiresAt: null },
  });
  await db.outboxEvent.deleteMany({
    where: { deliveredAt: { lt: new Date(Date.now() - 7 * 86_400_000) } },
  });
  // Attempts can crash after PUT and before the database transaction. Only old, unreferenced
  // objects from expired/no-longer-current attempts are eligible for removal.
  let continuationToken: string | undefined;
  for (let page = 0; page < 10 && !stopping; page++) {
    const listed = await s3.send(
      new ListObjectsV2Command({
        Bucket: 'audio-playback',
        MaxKeys: 100,
        ContinuationToken: continuationToken,
      }),
    );
    for (const object of listed.Contents || []) {
      if (
        !object.Key ||
        !object.LastModified ||
        object.LastModified.getTime() > Date.now() - 2 * 86_400_000
      )
        continue;
      const key = object.Key;
      const attempt = key.match(/^([0-9a-f-]{36})\/v\d+\/p\d+\/([0-9a-f-]{36})\.(flac|mp3)$/i);
      if (!attempt) continue;
      const referenced = await db.trackAsset.count({ where: { bucket: 'audio-playback', key } });
      const active = await db.processingTask.count({
        where: {
          trackId: attempt[1],
          runToken: attempt[2],
          status: 'PROCESSING',
          leaseExpiresAt: { gt: new Date() },
        },
      });
      if (!referenced && !active)
        await s3.send(new DeleteObjectCommand({ Bucket: 'audio-playback', Key: key }));
    }
    continuationToken = listed.NextContinuationToken;
    if (!listed.IsTruncated || !continuationToken) break;
  }
  for (const [Bucket, Prefix] of [
    ['artwork', 'cover/'],
    ['artwork', 'avatar/'],
  ]) {
    let cursor: string | undefined;
    for (let page = 0; page < 10 && !stopping; page++) {
      const listed = await s3.send(
        new ListObjectsV2Command({ Bucket, Prefix, MaxKeys: 100, ContinuationToken: cursor }),
      );
      for (const object of listed.Contents || []) {
        if (
          !object.Key ||
          !object.LastModified ||
          object.LastModified.getTime() > Date.now() - 2 * 86_400_000
        )
          continue;
        const referenced = await db.trackAsset.count({
          where: { bucket: Bucket, key: object.Key },
        });
        const avatarReferenced = await db.user.count({ where: { avatarKey: object.Key } });
        const source = await db.processingTask.count({
          where: { sourceBucket: Bucket, sourceKey: object.Key },
        });
        if (!referenced && !avatarReferenced && !source)
          await s3.send(new DeleteObjectCommand({ Bucket, Key: object.Key }));
      }
      cursor = listed.NextContinuationToken;
      if (!listed.IsTruncated || !cursor) break;
    }
  }
}

async function loop(name: string, interval: number, action: () => Promise<void>): Promise<void> {
  while (!stopping) {
    try {
      await action();
    } catch {
      log('background_operation_failed', { operation: name });
    }
    if (!stopping)
      await delay(interval, undefined, { signal: stopController.signal }).catch(() => undefined);
  }
}

// Independent loops guarantee Redis failure does not stop mail, release fanout, or DB polling.
const loops = [
  loop('comment-moderation', 1000, () => commentModeration.tick()),
  // Leave pending mail untouched while delivery is disabled. Do not retry forever
  // or mark an unsent message delivered merely because SMTP is not configured.
  ...(smtp ? [loop('mail', 300, () => dispatch('MAIL'))] : []),
  loop('release', 500, () => dispatch('RELEASE')),
  loop('audio-outbox', 700, () => dispatch('AUDIO_PROCESS')),
  loop('object-delete-outbox', 700, () => dispatch('OBJECT_DELETE')),
  loop('reconciliation', 15_000, reconcile),
  loop('waveform-reconciliation', 15_000, () =>
    reconcileWaveforms(queue, redis.status === 'ready', () => stopping),
  ),
  loop('cleanup', 60_000, cleanup),
  loop('health', 5000, async () => {
    await db.$queryRaw`SELECT 1`;
    await writeFile('/tmp/background-worker-health', new Date().toISOString(), { mode: 0o600 });
  }),
];
const shutdown = () => {
  stopping = true;
  stopController.abort();
  log('draining');
};
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
log('started', { redisIndependentPolling: true, emailMode: smtp ? 'external' : 'disabled' });
await Promise.all(loops);
smtp?.close();
await queue.close();
redis.disconnect();
await db.$disconnect();
s3.destroy();
log('stopped');
