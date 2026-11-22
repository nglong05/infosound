import { Queue } from 'bullmq';
import { db } from '@infosound/database';

/** Existing DB reconciliation is durable even when Redis is unavailable. No API read creates jobs. */
export async function reconcileWaveforms(
  queue: Queue<{ taskId?: string; waveformTrackId?: string }>,
  redisReady: boolean,
  stopping: () => boolean,
): Promise<void> {
  await db.$executeRaw`
    INSERT INTO track_waveforms (track_id,source_version,pipeline_version,playback_asset_id)
    SELECT t.id,t.source_version,t.pipeline_version,t.playback_asset_id
    FROM tracks t
    JOIN track_assets a ON a.id=t.playback_asset_id AND a.track_id=t.id
      AND a.source_version=t.source_version AND a.pipeline_version=t.pipeline_version
      AND a.kind='PLAYBACK' AND a.verified=true AND a.bucket='audio-playback'
    LEFT JOIN track_waveforms w ON w.track_id=t.id
    WHERE t.processing_state='READY' AND t.deleted_at IS NULL
      AND (w.track_id IS NULL OR w.source_version<>t.source_version OR w.pipeline_version<>t.pipeline_version OR w.playback_asset_id<>t.playback_asset_id)
    ORDER BY t.created_at,t.id LIMIT 25
    ON CONFLICT (track_id) DO UPDATE SET
      source_version=EXCLUDED.source_version,pipeline_version=EXCLUDED.pipeline_version,playback_asset_id=EXCLUDED.playback_asset_id,
      status='QUEUED',duration=NULL,peaks=NULL,run_token=NULL,lease_expires_at=NULL,attempts=0,error_code=NULL,next_attempt_at=NOW(),updated_at=NOW()
    WHERE track_waveforms.source_version<>EXCLUDED.source_version OR track_waveforms.pipeline_version<>EXCLUDED.pipeline_version OR track_waveforms.playback_asset_id<>EXCLUDED.playback_asset_id`;
  const now = new Date();
  await db.trackWaveform.updateMany({
    where: { status: 'PROCESSING', leaseExpiresAt: { lt: now }, attempts: { gte: 3 } },
    data: { status: 'FAILED', errorCode: 'ATTEMPTS_EXHAUSTED', leaseExpiresAt: null },
  });
  if (!redisReady) return;
  const pending = await db.trackWaveform.findMany({
    where: {
      attempts: { lt: 3 },
      nextAttemptAt: { lte: now },
      OR: [{ status: 'QUEUED' }, { status: 'PROCESSING', leaseExpiresAt: { lt: now } }],
    },
    orderBy: [{ updatedAt: 'asc' }, { trackId: 'asc' }],
    take: 25,
  });
  for (const task of pending) {
    if (stopping()) break;
    const jobId = `waveform-${task.trackId}`;
    const existing = await queue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (['active', 'waiting', 'delayed', 'prioritized', 'waiting-children'].includes(state))
        continue;
      if (state === 'failed' || state === 'completed') await existing.remove();
      else continue;
    }
    // Normal uploads use the same single worker; this task never starts another decoder concurrently.
    await queue.add('waveform', { waveformTrackId: task.trackId }, { jobId, attempts: 1 });
  }
}
