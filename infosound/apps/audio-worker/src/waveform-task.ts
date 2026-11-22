import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, rm, statfs } from 'node:fs/promises';
import { join } from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { GetObjectCommand, storageClient } from '@infosound/storage';
import { db } from '@infosound/database';
import { MediaError, type AudioMetadata } from './media.js';
import { generateWaveform } from './waveform.js';

const leaseMs = 90_000;
type WaveformLog = (event: string, fields?: Record<string, unknown>) => void;

/** A separate fenced job never changes track processing state, assets, counters or publication. */
export async function processWaveformTask(
  trackId: string,
  s3: ReturnType<typeof storageClient>,
  tmpRoot: string,
  log: WaveformLog,
): Promise<void> {
  const runToken = randomUUID();
  const task = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM tracks WHERE id=${trackId}::uuid FOR UPDATE`;
    const candidate = await tx.trackWaveform.findUnique({ where: { trackId } });
    if (!candidate || ['SUCCEEDED', 'FAILED'].includes(candidate.status) || candidate.attempts >= 3)
      return null;
    const now = new Date();
    const claimed = await tx.trackWaveform.updateMany({
      where: {
        trackId,
        sourceVersion: candidate.sourceVersion,
        pipelineVersion: candidate.pipelineVersion,
        playbackAssetId: candidate.playbackAssetId,
        attempts: { lt: 3 },
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
    const track = await tx.track.findFirst({
      where: {
        id: trackId,
        sourceVersion: candidate.sourceVersion,
        pipelineVersion: candidate.pipelineVersion,
        playbackAssetId: candidate.playbackAssetId,
        processingState: 'READY',
        deletedAt: null,
      },
    });
    const asset = track
      ? await tx.trackAsset.findFirst({
          where: {
            id: candidate.playbackAssetId,
            trackId,
            sourceVersion: candidate.sourceVersion,
            pipelineVersion: candidate.pipelineVersion,
            kind: 'PLAYBACK',
            verified: true,
            bucket: 'audio-playback',
          },
        })
      : null;
    if (!track || !asset || !asset.checksum) {
      await tx.trackWaveform.updateMany({
        where: { trackId, runToken },
        data: { status: 'FAILED', errorCode: 'STALE_SOURCE', leaseExpiresAt: null },
      });
      return null;
    }
    return { ...candidate, attempts: candidate.attempts + 1, track, asset };
  });
  if (!task) return;
  const controller = new AbortController();
  const taskTimeout = setTimeout(() => controller.abort(), 420_000);
  taskTimeout.unref();
  let heartbeatBusy = false;
  const heartbeat = setInterval(() => {
    if (heartbeatBusy) return;
    heartbeatBusy = true;
    void db.trackWaveform
      .updateMany({
        where: { trackId, runToken, status: 'PROCESSING' },
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
    const { duration, sampleRate, channels, bitDepth, outputCodec } = task.track;
    if (
      !duration ||
      !sampleRate ||
      !channels ||
      !['flac', 'mp3'].includes(outputCodec ?? '') ||
      (outputCodec === 'flac' && ![16, 24].includes(bitDepth ?? 0))
    )
      throw new MediaError('WAVEFORM_METADATA_INVALID');
    const metadata: AudioMetadata = {
      codec: outputCodec as 'flac' | 'mp3',
      container: outputCodec as 'flac' | 'mp3',
      durationSeconds: duration,
      sampleRate,
      channels,
      bitDepth,
    };
    await mkdir(tmpRoot, { recursive: true, mode: 0o700 });
    const filesystem = await statfs(tmpRoot);
    if (filesystem.bavail * filesystem.bsize < 1_073_741_824) throw new Error('TEMP_SPACE_LOW');
    workingDirectory = await mkdtemp(join(tmpRoot, `${trackId}-${runToken}-`));
    const file = join(workingDirectory, 'playback');
    const response = await s3.send(
      new GetObjectCommand({
        Bucket: task.asset.bucket,
        Key: task.asset.key,
        ...(task.asset.versionId ? { VersionId: task.asset.versionId } : {}),
      }),
      { abortSignal: controller.signal },
    );
    if (
      !response.Body ||
      !response.ContentLength ||
      response.ContentLength > 536_870_912 ||
      BigInt(response.ContentLength) !== task.asset.size
    )
      throw new MediaError('SOURCE_SIZE_LIMIT');
    const hash = createHash('sha256');
    let bytes = 0;
    const bounded = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length;
        if (bytes > 536_870_912) callback(new MediaError('SOURCE_SIZE_LIMIT'));
        else {
          hash.update(chunk);
          callback(null, chunk);
        }
      },
    });
    await pipeline(
      response.Body as Readable,
      bounded,
      createWriteStream(file, { flags: 'wx', mode: 0o600 }),
      { signal: controller.signal },
    );
    if (bytes !== response.ContentLength || hash.digest('hex') !== task.asset.checksum)
      throw new MediaError('SOURCE_CHECKSUM_MISMATCH');
    const waveform = await generateWaveform(file, metadata, controller.signal);
    if (controller.signal.aborted) throw new MediaError('PROCESSING_CANCELLED');
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM tracks WHERE id=${trackId}::uuid FOR UPDATE`;
      const track = await tx.track.findFirst({
        where: {
          id: trackId,
          sourceVersion: task.sourceVersion,
          pipelineVersion: task.pipelineVersion,
          playbackAssetId: task.playbackAssetId,
          processingState: 'READY',
          deletedAt: null,
        },
      });
      const asset = track
        ? await tx.trackAsset.findFirst({
            where: {
              id: task.asset.id,
              sourceVersion: task.sourceVersion,
              pipelineVersion: task.pipelineVersion,
              verified: true,
              bucket: task.asset.bucket,
              key: task.asset.key,
              versionId: task.asset.versionId,
              checksum: task.asset.checksum,
            },
          })
        : null;
      if (!track || !asset) throw new MediaError('STALE_SOURCE');
      const changed = await tx.trackWaveform.updateMany({
        where: {
          trackId,
          runToken,
          status: 'PROCESSING',
          leaseExpiresAt: { gt: new Date() },
          sourceVersion: task.sourceVersion,
          pipelineVersion: task.pipelineVersion,
          playbackAssetId: task.playbackAssetId,
        },
        data: {
          status: 'SUCCEEDED',
          duration: waveform.duration,
          peaks: waveform.peaks,
          errorCode: null,
          leaseExpiresAt: null,
        },
      });
      if (!changed.count) throw new MediaError('STALE_WORKER');
    });
    log('waveform_succeeded', { trackId, sourceVersion: task.sourceVersion });
  } catch (error) {
    const code = error instanceof MediaError ? error.code : 'WAVEFORM_TEMPORARY_FAILURE';
    const permanent =
      error instanceof MediaError && !['PROCESSING_CANCELLED', 'STALE_WORKER'].includes(error.code);
    await db.trackWaveform.updateMany({
      where: { trackId, runToken, status: 'PROCESSING' },
      data: {
        status: permanent || task.attempts >= 3 ? 'FAILED' : 'QUEUED',
        errorCode: code,
        leaseExpiresAt: null,
        nextAttemptAt: new Date(Date.now() + Math.min(300_000, 10_000 * 2 ** task.attempts)),
      },
    });
    log('waveform_failed', { trackId, code, retryable: !permanent && task.attempts < 3 });
    // The durable row/reconciliation owns retries; never fail the track itself.
  } finally {
    clearInterval(heartbeat);
    clearTimeout(taskTimeout);
    controller.abort();
    if (workingDirectory) await rm(workingDirectory, { recursive: true, force: true });
  }
}
