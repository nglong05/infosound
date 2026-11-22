import { createAudioTask } from './process-audio-task.js';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm, stat, statfs, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { GetObjectCommand, PutObjectCommand, storageClient } from '@infosound/storage';
import { Worker, UnrecoverableError } from 'bullmq';
import { db, Prisma, secret } from '@infosound/database';
import { MediaError, preparePlayback, probeAudio } from './media.js';
import { generateWaveform } from './waveform.js';
import { processWaveformTask } from './waveform-task.js';

const log = (event: string, fields: Record<string, unknown> = {}) =>
  process.stdout.write(
    `${JSON.stringify({ service: 'audio-worker', event, ...fields, time: new Date().toISOString() })}\n`,
  );
const tmpRoot = process.env.WORKER_TMP_DIR || '/tmp/infosound-audio';
const leaseMs = 90_000;
const maxAttempts = 3;
const s3 = storageClient('WORKER');
let shuttingDown = false;
export const processTask = createAudioTask({ s3, tmpRoot, log, leaseMs, maxAttempts });

await mkdir(tmpRoot, { recursive: true, mode: 0o700 });
async function cleanAbandonedDirectories(): Promise<void> {
  const entries = await readdir(tmpRoot, { withFileTypes: true });
  for (const entry of entries) {
    const match = entry.name.match(/^([0-9a-f-]{36})-([0-9a-f-]{36})-[A-Za-z0-9]+$/i);
    if (!entry.isDirectory() || !match) continue;
    const path = join(tmpRoot, entry.name);
    if ((await stat(path)).mtimeMs > Date.now() - 86_400_000) continue;
    const [audioActive, waveformActive] = await Promise.all([
      db.processingTask.count({
        where: {
          id: match[1],
          runToken: match[2],
          status: 'PROCESSING',
          leaseExpiresAt: { gt: new Date() },
        },
      }),
      db.trackWaveform.count({
        where: {
          trackId: match[1],
          runToken: match[2],
          status: 'PROCESSING',
          leaseExpiresAt: { gt: new Date() },
        },
      }),
    ]);
    const active = audioActive + waveformActive;
    if (!active) await rm(path, { recursive: true, force: true });
  }
}
await cleanAbandonedDirectories().catch(() => log('temporary_cleanup_failed'));
const temporaryCleanupTimer = setInterval(() => {
  void cleanAbandonedDirectories().catch(() => log('temporary_cleanup_failed'));
}, 900_000);
temporaryCleanupTimer.unref();
const worker = new Worker<{ taskId?: string; waveformTrackId?: string }>(
  'audio',
  async (job) => {
    if (job.name === 'waveform') {
      if (
        typeof job.data.waveformTrackId !== 'string' ||
        !/^[0-9a-f-]{36}$/i.test(job.data.waveformTrackId)
      )
        throw new UnrecoverableError('INVALID_TASK_ID');
      await processWaveformTask(job.data.waveformTrackId, s3, tmpRoot, log);
      return;
    }
    if (typeof job.data.taskId !== 'string') throw new UnrecoverableError('INVALID_TASK_ID');
    if (!/^[0-9a-f-]{36}$/i.test(job.data.taskId)) throw new UnrecoverableError('INVALID_TASK_ID');
    await processTask(job.data.taskId);
  },
  {
    connection: {
      host: process.env.REDIS_HOST || 'redis',
      port: Number(process.env.REDIS_PORT || 6379),
      username: process.env.REDIS_USERNAME || 'queue',
      password: secret('REDIS_PASSWORD'),
      maxRetriesPerRequest: null,
      connectTimeout: 5000,
    },
    prefix: 'bull',
    concurrency: 1,
    lockDuration: 90_000,
    stalledInterval: 30_000,
    maxStalledCount: 2,
    removeOnComplete: { count: 100, age: 86400 },
    removeOnFail: { count: 100, age: 604800 },
  },
);
worker.on('error', () => log('queue_connection_error'));
worker.on('failed', (job) => log('job_failed', { taskId: job?.data.taskId }));
const healthTimer = setInterval(() => {
  void writeFile('/tmp/audio-worker-health', new Date().toISOString(), { mode: 0o600 });
}, 10_000);
await writeFile('/tmp/audio-worker-health', new Date().toISOString(), { mode: 0o600 });
const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(healthTimer);
  clearInterval(temporaryCleanupTimer);
  log('draining');
  await worker.close();
  await db.$disconnect();
  s3.destroy();
  log('stopped');
};
process.once('SIGTERM', () => {
  void shutdown();
});
process.once('SIGINT', () => {
  void shutdown();
});
log('started', { concurrency: 1, maxAttempts });
