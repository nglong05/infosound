import { BadRequestException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { db, secret } from '@infosound/database';
import type { Identity } from './security';
import { conflict, publicTrackWhere } from './helpers';
import { visitorListenHash, type VisitorIdentity } from './visitor-listener';

const LISTEN_WINDOW_MS = 30 * 60_000;
type ListenTrack = { id: string; sourceVersion: number; duration: number | null };
export type ListenerIdentity = Identity | VisitorIdentity;
function actor(listener: ListenerIdentity) {
  return 'visitorId' in listener
    ? { kind: 'visitor' as const, id: listener.visitorId, sessionId: listener.visitorId }
    : { kind: 'user' as const, id: listener.id, sessionId: listener.sessionId };
}
type ListenClaims = {
  type: 'listen';
  trackId: string;
  sourceVersion: number;
  startedAtMs: number;
  sub: string;
  sid: string;
  jti: string;
  listenerKind?: 'user' | 'visitor';
};

export function minimumListenSeconds(duration: number | null): number | null {
  return duration !== null && Number.isFinite(duration) && duration > 0
    ? Math.min(30, duration / 2)
    : null;
}

/** Issuance alone never changes counts; URL renewals may mint another unused token. */
export function createListenToken(
  user: ListenerIdentity,
  track: ListenTrack,
): { token: string; minimumSeconds: number } | null {
  const minimumSeconds = minimumListenSeconds(track.duration);
  if (minimumSeconds === null) return null;
  const listener = actor(user);
  const token = jwt.sign(
    {
      type: 'listen',
      trackId: track.id,
      sourceVersion: track.sourceVersion,
      startedAtMs: Date.now(),
      sub: listener.id,
      sid: listener.sessionId,
      listenerKind: listener.kind,
      jti: randomUUID(),
    },
    secret('JWT_SECRET'),
    { algorithm: 'HS256', issuer: 'infosound', audience: 'infosound-listen', expiresIn: '15m' },
  );
  return { token, minimumSeconds };
}

function readListenToken(token: string, user: ListenerIdentity, trackId: string): ListenClaims {
  try {
    const listener = actor(user);
    const value = jwt.verify(token, secret('JWT_SECRET'), {
      algorithms: ['HS256'],
      issuer: 'infosound',
      audience: 'infosound-listen',
    });
    if (
      typeof value === 'string' ||
      value.type !== 'listen' ||
      value.trackId !== trackId ||
      value.sub !== listener.id ||
      value.sid !== listener.sessionId ||
      (value.listenerKind ?? 'user') !== listener.kind ||
      !Number.isSafeInteger(value.sourceVersion) ||
      value.sourceVersion < 1 ||
      !Number.isSafeInteger(value.startedAtMs) ||
      value.startedAtMs <= 0 ||
      value.startedAtMs > Date.now() ||
      typeof value.jti !== 'string' ||
      !/^[0-9a-f-]{36}$/i.test(value.jti)
    )
      throw new Error('INVALID_LISTEN_TOKEN');
    return value as ListenClaims;
  } catch {
    throw new BadRequestException({
      code: 'LISTEN_TOKEN_INVALID',
      message: 'Phiên ghi nhận lượt nghe không hợp lệ.',
    });
  }
}

export async function countListen(
  user: ListenerIdentity,
  trackId: string,
  token: string,
): Promise<{ counted: boolean }> {
  const claims = readListenToken(token, user, trackId);
  const visitorHash = 'visitorId' in user ? visitorListenHash(user.visitorId) : null;
  if (visitorHash) {
    // Expired checkpoints carry no history; bounded cleanup never locks another active count.
    await db.$executeRaw`DELETE FROM visitor_track_listens WHERE ctid IN (
      SELECT ctid FROM visitor_track_listens WHERE expires_at <= now()
      ORDER BY expires_at LIMIT 100 FOR UPDATE SKIP LOCKED
    )`;
  }
  return db.$transaction(async (tx) => {
    // Serialize the counter and per-user dedupe decision, including source changes.
    await tx.$queryRaw`SELECT id FROM tracks WHERE id=${trackId}::uuid FOR UPDATE`;
    const track = await tx.track.findFirst({
      where: { id: trackId, ...publicTrackWhere, author: { active: true } },
      select: { id: true, sourceVersion: true, duration: true },
    });
    if (!track || track.sourceVersion !== claims.sourceVersion)
      throw new NotFoundException({
        code: 'TRACK_UNAVAILABLE',
        message: 'Bài hát hiện không khả dụng.',
      });
    const minimumSeconds = minimumListenSeconds(track.duration);
    if (minimumSeconds === null)
      throw new NotFoundException({
        code: 'TRACK_UNAVAILABLE',
        message: 'Bài hát hiện không khả dụng.',
      });
    const now = new Date();
    if (now.getTime() - claims.startedAtMs < minimumSeconds * 1000)
      conflict('LISTEN_TOO_EARLY', 'Chưa đủ thời gian để ghi nhận lượt nghe.');
    if (visitorHash) {
      const key = { visitorHash, trackId };
      const previous = await tx.visitorTrackListen.findUnique({ where: { visitorHash_trackId: key } });
      if (previous?.sourceVersion === track.sourceVersion &&
          now.getTime() - previous.lastCountedAt.getTime() < LISTEN_WINDOW_MS) {
        return { counted: false };
      }
      const data = { sourceVersion: track.sourceVersion, lastCountedAt: now,
        expiresAt: new Date(now.getTime() + LISTEN_WINDOW_MS) };
      await tx.visitorTrackListen.upsert({ where: { visitorHash_trackId: key }, create: { ...key, ...data }, update: data });
      await tx.$executeRaw`UPDATE tracks SET play_count=play_count+1 WHERE id=${trackId}::uuid`;
      return { counted: true };
    }
    if ('visitorId' in user) throw new Error('INVALID_LISTENER');
    const key = { userId: user.id, trackId };
    const previous = await tx.trackListen.findUnique({ where: { userId_trackId: key } });
    if (
      previous?.sourceVersion === track.sourceVersion &&
      now.getTime() - previous.lastCountedAt.getTime() < LISTEN_WINDOW_MS
    ) {
      // Replays move the song to the top of personal history without extending the count window.
      await tx.trackListen.update({
        where: { userId_trackId: key },
        data: { lastListenedAt: now },
      });
      return { counted: false };
    }
    await tx.trackListen.upsert({
      where: { userId_trackId: key },
      create: {
        ...key,
        sourceVersion: track.sourceVersion,
        lastCountedAt: now,
        lastListenedAt: now,
        qualifiedPlays: 1,
      },
      update: {
        sourceVersion: track.sourceVersion,
        lastCountedAt: now,
        lastListenedAt: now,
        qualifiedPlays: { increment: 1 },
      },
    });
    // A listen is not an edit of track metadata; deliberately preserve updated_at.
    await tx.$executeRaw`UPDATE tracks SET play_count=play_count+1 WHERE id=${trackId}::uuid`;
    return { counted: true };
  });
}
