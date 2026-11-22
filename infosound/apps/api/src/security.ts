import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { db, secret } from '@infosound/database';
import jwt from 'jsonwebtoken';
import type { Request } from 'express';

export type Identity = { id: string; role: 'USER' | 'AUTHOR'; sessionId: string };
export type AuthRequest = Request & { identity?: Identity; requestId?: string };
export const Public = () => SetMetadata('public', true);
export const Author = () => SetMetadata('author', true);
export const Current = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Identity | undefined =>
    ctx.switchToHttp().getRequest<AuthRequest>().identity,
);

@Injectable()
export class AccessGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthRequest>();
    const isPublic = this.reflector.getAllAndOverride<boolean>('public', [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    const header = req.headers.authorization;
    if (header?.startsWith('Bearer ')) {
      try {
        const decoded = jwt.verify(header.slice(7), secret('JWT_SECRET'), {
          algorithms: ['HS256'],
          issuer: 'infosound',
          audience: 'infosound-web',
        });
        if (
          typeof decoded === 'string' ||
          typeof decoded.sub !== 'string' ||
          typeof decoded.sid !== 'string'
        )
          throw new Error('INVALID_JWT');
        const session = await db.authSession.findFirst({
          where: {
            id: decoded.sid,
            userId: decoded.sub,
            revokedAt: null,
            expiresAt: { gt: new Date() },
            user: { active: true },
          },
          select: { userId: true, user: { select: { role: true } } },
        });
        if (!session) throw new Error('SESSION_REVOKED');
        req.identity = { id: session.userId, role: session.user.role, sessionId: decoded.sid };
      } catch {
        if (!isPublic)
          throw new UnauthorizedException({
            code: 'SESSION_EXPIRED',
            message: 'Phiên đăng nhập đã hết hạn.',
          });
      }
    }
    if (!req.identity && !isPublic)
      throw new UnauthorizedException({
        code: 'LOGIN_REQUIRED',
        message: 'Vui lòng đăng nhập để tiếp tục.',
      });
    if (
      this.reflector.getAllAndOverride<boolean>('author', [ctx.getHandler(), ctx.getClass()]) &&
      req.identity?.role !== 'AUTHOR'
    )
      throw new ForbiddenException({
        code: 'AUTHOR_REQUIRED',
        message: 'Chức năng dành cho tài khoản nghệ sĩ.',
      });
    return true;
  }
}
