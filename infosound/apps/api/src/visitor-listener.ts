import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { createHmac, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { secret } from '@infosound/database';
import type { Response } from 'express';
import type { AuthRequest } from './security';

const COOKIE = '__Host-infosound-visitor';
const MAX_AGE_MS = 30 * 24 * 60 * 60_000;
export type VisitorIdentity = { kind: 'visitor'; visitorId: string };

/** An opaque browser identifier, never an account or a user-selected checkpoint key. */
export function visitorListener(req: AuthRequest, res?: Response): VisitorIdentity {
  const cookie = req.cookies?.[COOKIE];
  if (typeof cookie === 'string' && cookie.length <= 2048) {
    try {
      const value = jwt.verify(cookie, secret('JWT_SECRET'), {
        algorithms: ['HS256'], issuer: 'infosound', audience: 'infosound-visitor',
      });
      if (typeof value !== 'string' && value.type === 'visitor' &&
          typeof value.sub === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.sub) &&
          typeof value.exp === 'number') {
        return { kind: 'visitor', visitorId: value.sub };
      }
    } catch { /* Invalid/expired cookies may only be replaced when issuing playback. */ }
  }
  if (!res) throw new BadRequestException({ code: 'LISTEN_TOKEN_INVALID', message: 'Phiên ghi nhận lượt nghe không hợp lệ.' });
  if (req.headers['sec-fetch-site'] === 'cross-site') {
    throw new ForbiddenException({ code: 'CSRF_ORIGIN_DENIED', message: 'Nguồn yêu cầu không hợp lệ.' });
  }
  const visitorId = randomUUID();
  const token = jwt.sign({ type: 'visitor', sub: visitorId }, secret('JWT_SECRET'), {
    algorithm: 'HS256', issuer: 'infosound', audience: 'infosound-visitor', expiresIn: '30d',
  });
  res.cookie(COOKIE, token, { httpOnly: true, secure: true, sameSite: 'strict', path: '/', maxAge: MAX_AGE_MS });
  return { kind: 'visitor', visitorId };
}

/** Purpose-separated keyed hash: raw browser IDs and IP addresses are not persisted. */
export function visitorListenHash(visitorId: string): string {
  return createHmac('sha256', secret('JWT_SECRET')).update('infosound-visitor-listen\0').update(visitorId).digest('hex');
}
