import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, rm, stat, statfs } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { GetObjectCommand, PutObjectCommand, storageClient } from '@infosound/storage';
import { db, Prisma } from '@infosound/database';
import { UnrecoverableError } from 'bullmq';
import { MediaError, preparePlayback, probeAudio } from './media.js';
import { generateWaveform } from './waveform.js';

type AudioTaskContext = {
  s3: ReturnType<typeof storageClient>;
  tmpRoot: string;
  log: (event: string, fields?: Record<string, unknown>) => void;
  leaseMs: number;
  maxAttempts: number;
};

export function createAudioTask({ s3, tmpRoot, log, leaseMs, maxAttempts }: AudioTaskContext) {
  async function processTask(taskId: string): Promise<void> {
    const runToken = randomUUID();
    const now = new Date();
    const task = await db.$transaction(async (tx) => {
      const candidate = await tx.processingTask.findUnique({ where: { id: taskId } });
      if (!candidate || candidate.status === 'SUCCEEDED' || candidate.status === 'FAILED')
        return null;
      const claimed = await tx.processingTask.updateMany({
        where: {
          id: taskId,
          attempts: { lt: maxAttempts },
          nextAttemptAt: { lte: now },
          OR: [{ status: 'QUEUED' }, { status: 'PROCESSING', leaseExpiresAt: { lt: now } }],
        },
        data: {
          status: 'PROCESSING',
          runToken,
          leaseExpiresAt: new Date(Date.now() + leaseMs),
          attempts: { increment: 1 },
          errorCode: null,
        },
      });
      if (!claimed.count) return null;
      const changed = await tx.track.updateMany({
        where: {
          id: candidate.trackId,
          deletedAt: null,
          sourceVersion: candidate.sourceVersion,
          pipelineVersion: candidate.pipelineVersion,
        },
        data: { processingState: 'PROCESSING' },
      });
      if (!changed.count) {
        await tx.processingTask.update({
          where: { id: taskId },
          data: { status: 'FAILED', errorCode: 'STALE_SOURCE', leaseExpiresAt: null },
        });
        return null;
      }
      return { ...candidate, attempts: candidate.attempts + 1 };
    });
    if (!task) return;
    log('task_started', { taskId, trackId: task.trackId, attempt: task.attempts });
    const controller = new AbortController();
    let heartbeatBusy = false;
    const heartbeat = setInterval(() => {
      if (heartbeatBusy) return;
      heartbeatBusy = true;
      void db.processingTask
        .updateMany({
          where: { id: taskId, runToken, status: 'PROCESSING' },
          data: { leaseExpiresAt: new Date(Date.now() + leaseMs) },
        })
        .then((result) => {
          if (!result.count) controller.abort();
        })
        .catch(() => controller.abort())
        .finally(() => {
          heartbeatBusy = false;
        });
    }, 20_000);
    heartbeat.unref();
    let workingDirectory: string | undefined;
    try {
      await mkdir(tmpRoot, { recursive: true, mode: 0o700 });
      const filesystem = await statfs(tmpRoot);
      if (filesystem.bavail * filesystem.bsize < 1_073_741_824) throw new Error('TEMP_SPACE_LOW');
      workingDirectory = await mkdtemp(join(tmpRoot, `${taskId}-${runToken}-`));
      const sourceFile = join(workingDirectory, 'source');
      const source = await s3.send(
        new GetObjectCommand({
          Bucket: task.sourceBucket,
          Key: task.sourceKey,
          ...(task.sourceVersionId ? { VersionId: task.sourceVersionId } : {}),
        }),
        { abortSignal: controller.signal },
      );
      if (!source.Body || !source.ContentLength || source.ContentLength > 268_435_456)
        throw new MediaError('SOURCE_SIZE_LIMIT');
      const hash = createHash('sha256');
      let bytes = 0;
      const boundStream = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          bytes += chunk.length;
          if (bytes > 268_435_456) callback(new MediaError('SOURCE_SIZE_LIMIT'));
          else {
            hash.update(chunk);
            callback(null, chunk);
          }
        },
      });
      await pipeline(
        source.Body as Readable,
        boundStream,
        createWriteStream(sourceFile, { flags: 'wx', mode: 0o600 }),
        { signal: controller.signal },
      );
      if (bytes !== source.ContentLength) throw new Error('INCOMPLETE_SOURCE');
      const checksum = hash.digest('hex');
      const original = await db.trackAsset.findUnique({
        where: {
          trackId_sourceVersion_pipelineVersion_kind: {
            trackId: task.trackId,
            sourceVersion: task.sourceVersion,
            pipelineVersion: task.pipelineVersion,
            kind: 'ORIGINAL',
          },
        },
      });
      if (
        !original ||
        original.key !== task.sourceKey ||
        original.bucket !== task.sourceBucket ||
        (original.checksum && original.checksum !== checksum)
      )
        throw new MediaError('SOURCE_CHECKSUM_MISMATCH');
      const metadata = await probeAudio(sourceFile, controller.signal);
      const playback = await preparePlayback(
        sourceFile,
        join(workingDirectory, 'playback.flac'),
        metadata,
        (process.env.CONVERT_LOSSY_TO_FLAC ?? 'true') === 'true',
        controller.signal,
      );
      let waveform: Awaited<ReturnType<typeof generateWaveform>> | null = null;
      try {
        waveform = await generateWaveform(playback.file, playback.metadata, controller.signal);
      } catch (error) {
        if (controller.signal.aborted) throw error;
        log('waveform_deferred', {
          trackId: task.trackId,
          code: error instanceof MediaError ? error.code : 'WAVEFORM_TEMPORARY_FAILURE',
        });
      }
      const outputHash = createHash('sha256');
      for await (const chunk of createReadStream(playback.file)) outputHash.update(chunk);
      const outputChecksum = outputHash.digest('hex');
      const outputSize = (await stat(playback.file)).size;
      const contentType = playback.metadata.codec === 'mp3' ? 'audio/mpeg' : 'audio/flac';
      const key = `${task.trackId}/v${task.sourceVersion}/p${task.pipelineVersion}/${runToken}.${playback.metadata.codec === 'mp3' ? 'mp3' : 'flac'}`;
      const uploaded = await s3.send(
        new PutObjectCommand({
          Bucket: 'audio-playback',
          Key: key,
          Body: createReadStream(playback.file),
          ContentLength: outputSize,
          ContentType: contentType,
          Metadata: { sha256: outputChecksum, 'pcm-sha256': playback.pcmChecksum },
        }),
        { abortSignal: controller.signal },
      );
      // Crash here leaves an attempt-specific orphan; no database pointer can reference partial output.
      await db.$transaction(async (tx) => {
        const fenced = await tx.processingTask.updateMany({
          where: { id: taskId, runToken, status: 'PROCESSING', leaseExpiresAt: { gt: new Date() } },
          data: { status: 'SUCCEEDED', leaseExpiresAt: null },
        });
        if (!fenced.count) throw new MediaError('STALE_WORKER');
        const current = await tx.track.updateMany({
          where: {
            id: task.trackId,
            sourceVersion: task.sourceVersion,
            pipelineVersion: task.pipelineVersion,
            deletedAt: null,
          },
          data: {
            processingState: 'READY',
            duration: playback.metadata.durationSeconds,
            sampleRate: playback.metadata.sampleRate,
            bitDepth: playback.metadata.bitDepth,
            channels: playback.metadata.channels,
            sourceCodec: metadata.codec,
            outputCodec: playback.metadata.codec,
            lossyTranscode: playback.lossyTranscode,
            provenance: playback.lossyTranscode
              ? 'TRANSCODED_FROM_LOSSY'
              : metadata.codec === 'mp3'
                ? 'LOSSY_SOURCE'
                : 'USER_PROVIDED_UNVERIFIED_MASTER',
          },
        });
        if (!current.count) throw new MediaError('STALE_SOURCE');
        const asset = await tx.trackAsset.upsert({
          where: {
            trackId_sourceVersion_pipelineVersion_kind: {
              trackId: task.trackId,
              sourceVersion: task.sourceVersion,
              pipelineVersion: task.pipelineVersion,
              kind: 'PLAYBACK',
            },
          },
          create: {
            trackId: task.trackId,
            sourceVersion: task.sourceVersion,
            pipelineVersion: task.pipelineVersion,
            kind: 'PLAYBACK',
            bucket: 'audio-playback',
            key,
            versionId: uploaded.VersionId || null,
            checksum: outputChecksum,
            size: BigInt(outputSize),
            contentType,
            runToken,
            verified: true,
          },
          update: {
            bucket: 'audio-playback',
            key,
            versionId: uploaded.VersionId || null,
            checksum: outputChecksum,
            size: BigInt(outputSize),
            contentType,
            runToken,
            verified: true,
          },
        });
        await tx.trackAsset.update({
          where: { id: original.id },
          data: { checksum, verified: true },
        });
        await tx.track.update({ where: { id: task.trackId }, data: { playbackAssetId: asset.id } });
        const waveformData = {
          sourceVersion: task.sourceVersion,
          pipelineVersion: task.pipelineVersion,
          playbackAssetId: asset.id,
          status: waveform ? ('SUCCEEDED' as const) : ('QUEUED' as const),
          duration: waveform?.duration ?? null,
          peaks: waveform?.peaks ?? Prisma.DbNull,
          runToken: null,
          leaseExpiresAt: null,
          attempts: 0,
          errorCode: null,
          nextAttemptAt: new Date(),
        };
        await tx.trackWaveform.upsert({
          where: { trackId: task.trackId },
          create: { trackId: task.trackId, ...waveformData },
          update: waveformData,
        });
      });
      log('task_succeeded', {
        taskId,
        trackId: task.trackId,
        sourceCodec: metadata.codec,
        outputCodec: playback.metadata.codec,
      });
    } catch (error) {
      const permanent =
        error instanceof MediaError &&
        !['PROCESSING_CANCELLED', 'STALE_WORKER'].includes(error.code);
      const code = error instanceof MediaError ? error.code : 'PROCESSING_TEMPORARY_FAILURE';
      const exhausted = task.attempts >= maxAttempts;
      await db.$transaction(async (tx) => {
        const changed = await tx.processingTask.updateMany({
          where: { id: taskId, runToken, status: 'PROCESSING' },
          data: {
            status: permanent || exhausted ? 'FAILED' : 'QUEUED',
            errorCode: code,
            leaseExpiresAt: null,
            nextAttemptAt: new Date(
              Date.now() +
                Math.min(300_000, 10_000 * 2 ** task.attempts) +
                Math.floor(Math.random() * 1000),
            ),
          },
        });
        if (changed.count)
          await tx.track.updateMany({
            where: {
              id: task.trackId,
              sourceVersion: task.sourceVersion,
              pipelineVersion: task.pipelineVersion,
              deletedAt: null,
            },
            data: { processingState: permanent || exhausted ? 'FAILED' : 'QUEUED' },
          });
      });
      log('task_failed', {
        taskId,
        trackId: task.trackId,
        code,
        retryable: !permanent && !exhausted,
      });
      if (permanent || exhausted) throw new UnrecoverableError(code);
      throw new Error(code);
    } finally {
      clearInterval(heartbeat);
      controller.abort();
      if (workingDirectory) await rm(workingDirectory, { recursive: true, force: true });
    }
  }
  return processTask;
}
