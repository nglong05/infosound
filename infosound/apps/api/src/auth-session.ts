import jwt from 'jsonwebtoken';
import type { Response } from 'express';
import { Prisma, secret } from '@infosound/database';
import { hashToken, randomToken } from '@infosound/contracts';

export const refreshCookieName = '__Host-infosound-refresh';
export const refreshCookieSettings = {
  httpOnly: true,
  secure: true,
  sameSite: 'strict' as const,
  path: '/',
  maxAge: 7 * 86400000,
};
export const publicUserSelect = {
  id: true,
  email: true,
  username: true,
  displayName: true,
  role: true,
  bio: true,
  avatarKey: true,
  avatarVersionId: true,
} as const;

export function accessToken(userId: string, sessionId: string): string {
  return jwt.sign({ sid: sessionId }, secret('JWT_SECRET'), {
    algorithm: 'HS256',
    expiresIn: '10m',
    issuer: 'infosound',
    audience: 'infosound-web',
    subject: userId,
  });
}

export async function createSession(tx: Prisma.TransactionClient, userId: string) {
  const refreshToken = randomToken();
  const session = await tx.authSession.create({
    data: {
      userId,
      refreshHash: hashToken(refreshToken),
      expiresAt: new Date(Date.now() + refreshCookieSettings.maxAge),
    },
  });
  return { id: session.id, cookie: `${session.id}.${refreshToken}` };
}

export function setRefreshCookie(res: Response, value: string) {
  res.cookie(refreshCookieName, value, refreshCookieSettings);
}
