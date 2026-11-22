import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Response } from 'express';
import argon2 from 'argon2';
import { z } from 'zod';
import { db } from '@infosound/database';
import {
  verifySchema,
  loginSchema,
  profileSchema,
  emailSchema,
  hashToken,
  randomToken,
} from '@infosound/contracts';
import { Current, Identity, Public, AuthRequest } from './security';
import { validate, throttle, conflict } from './helpers';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  registrationBody,
  loginBody,
  tokenPasswordBody,
  emailBody,
  profileBody,
  otpResendBody,
} from './openapi';
import {
  accessToken,
  createSession,
  refreshCookieName as cookieName,
  refreshCookieSettings as cookieSettings,
  publicUserSelect as publicUser,
  setRefreshCookie,
} from './auth-session';
import { encryptedMail as mail, requireEmailEnabled as requireEmail } from './auth-mail';
import { hashPassword as passwordHash } from './auth-password';
import { requestRegistration, resendRegistration } from './registration-otp';
import { withAvatar } from './user-view';

const generic = { message: 'Nếu thông tin hợp lệ, hướng dẫn sẽ được gửi đến email của bạn.' };
@ApiTags('InfoSound authentication')
@Controller('api/v1')
export class AuthController {
  @Public()
  @Post('auth/register')
  @ApiBody({ schema: registrationBody })
  @ApiOperation({ summary: 'Đăng ký bằng mật khẩu và gửi OTP xác minh email' })
  async register(@Body() body: unknown, @Req() req: AuthRequest) {
    return requestRegistration(body, req);
  }
  @Public()
  @Post('auth/resend-verification')
  @ApiBody({ schema: otpResendBody })
  async resend(@Body() body: unknown, @Req() req: AuthRequest) {
    return resendRegistration(body, req);
  }
  @Public()
  @Post('auth/login')
  @ApiBody({ schema: loginBody })
  async login(
    @Body() body: unknown,
    @Req() req: AuthRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    throttle(`login-ip:${req.ip}`, 15);
    const input = validate(loginSchema, body);
    throttle(`login-email:${input.email}`, 10);
    const user = await db.user.findUnique({ where: { email: input.email } });
    if (
      !user?.active ||
      !user.passwordHash ||
      !(await argon2.verify(user.passwordHash, input.password))
    )
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Email hoặc mật khẩu chưa chính xác.',
      });
    const session = await db.$transaction((tx) => createSession(tx, user.id));
    setRefreshCookie(res, session.cookie);
    return {
      accessToken: accessToken(user.id, session.id),
      user: await withAvatar({
        id: user.id,
        email: user.email,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        bio: user.bio,
        avatarKey: user.avatarKey,
        avatarVersionId: user.avatarVersionId,
      }),
    };
  }
  @Public()
  @Post('auth/refresh')
  async refresh(@Req() req: AuthRequest, @Res({ passthrough: true }) res: Response) {
    throttle(`refresh:${req.ip}`, 60);
    const value: unknown = req.cookies?.[cookieName];
    if (typeof value !== 'string') throw new UnauthorizedException({ code: 'SESSION_EXPIRED' });
    const [id, oldToken] = value.split('.');
    if (!z.string().uuid().safeParse(id).success || !oldToken)
      throw new UnauthorizedException({ code: 'SESSION_EXPIRED' });
    const session = await db.authSession.findUnique({
      where: { id },
      include: { user: { select: { ...publicUser, active: true } } },
    });
    if (!session || session.revokedAt || session.expiresAt < new Date() || !session.user.active)
      throw new UnauthorizedException({ code: 'SESSION_EXPIRED' });
    const previous = hashToken(oldToken);
    if (session.refreshHash !== previous) {
      if (
        session.previousHash === previous &&
        session.rotatedAt &&
        session.rotatedAt.getTime() > Date.now() - 5000
      )
        conflict('REFRESH_CONCURRENT', 'Phiên vừa được làm mới. Vui lòng thử lại.');
      if (session.previousHash === previous)
        await db.authSession.update({ where: { id }, data: { revokedAt: new Date() } });
      res.clearCookie(cookieName, cookieSettings);
      throw new UnauthorizedException({ code: 'REFRESH_REPLAY' });
    }
    const token = randomToken();
    const changed = await db.authSession.updateMany({
      where: { id, refreshHash: previous, revokedAt: null, expiresAt: { gt: new Date() } },
      data: { previousHash: previous, refreshHash: hashToken(token), rotatedAt: new Date() },
    });
    if (!changed.count) conflict('REFRESH_CONCURRENT', 'Phiên vừa được làm mới. Vui lòng thử lại.');
    res.cookie(cookieName, `${id}.${token}`, {
      ...cookieSettings,
      maxAge: session.expiresAt.getTime() - Date.now(),
    });
    const { active: _active, ...user } = session.user;
    return { accessToken: accessToken(user.id, id), user: await withAvatar(user) };
  }
  @Public()
  @Post('auth/logout')
  async logout(@Req() req: AuthRequest, @Res({ passthrough: true }) res: Response) {
    const value = req.cookies?.[cookieName] as unknown;
    if (typeof value === 'string') {
      const [id, token] = value.split('.');
      if (z.string().uuid().safeParse(id).success && token)
        await db.authSession.updateMany({
          where: { id, refreshHash: hashToken(token) },
          data: { revokedAt: new Date() },
        });
    }
    res.clearCookie(cookieName, cookieSettings);
    return { message: 'Đã đăng xuất.' };
  }
  @Post('auth/logout-all') async logoutAll(
    @Current() user: Identity,
    @Res({ passthrough: true }) res: Response,
  ) {
    await db.authSession.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    res.clearCookie(cookieName, cookieSettings);
    return { message: 'Đã đăng xuất tất cả thiết bị.' };
  }
  @Public()
  @Post('auth/forgot-password')
  @ApiBody({ schema: emailBody })
  async forgot(@Body() body: unknown, @Req() req: AuthRequest) {
    requireEmail();
    throttle(`forgot:${req.ip}`, 5, 3600000);
    const { email } = validate(z.object({ email: emailSchema }).strict(), body);
    const user = await db.user.findUnique({
      where: { email },
      select: { id: true, email: true, passwordHash: true, active: true },
    });
    if (!user?.active || !user.passwordHash) return generic;
    const recent = await db.passwordResetRequest.findFirst({
      where: { userId: user.id, createdAt: { gt: new Date(Date.now() - 60000) } },
    });
    if (recent) return generic;
    const token = randomToken(),
      expiresAt = new Date(Date.now() + 1800000);
    await db.$transaction(async (tx) => {
      await tx.passwordResetRequest.create({
        data: { userId: user.id, tokenHash: hashToken(token), expiresAt },
      });
      await tx.outboxEvent.create({
        data: mail(
          email,
          'InfoSound — Đặt lại mật khẩu',
          `Đặt mật khẩu mới cho InfoSound:\n${process.env.APP_ORIGIN}/reset-password?token=${token}\nLiên kết hết hạn sau 30 phút.`,
          expiresAt,
        ),
      });
    });
    return generic;
  }
  @Public()
  @Post('auth/reset-password')
  @ApiBody({ schema: tokenPasswordBody })
  async reset(@Body() body: unknown, @Req() req: AuthRequest) {
    requireEmail();
    throttle(`reset:${req.ip}`, 8);
    const { token, password } = validate(verifySchema, body);
    const reset = await db.passwordResetRequest.findUnique({
      where: { tokenHash: hashToken(token) },
    });
    if (!reset || reset.consumedAt || reset.expiresAt < new Date())
      conflict('INVALID_TOKEN', 'Liên kết đặt lại mật khẩu đã hết hạn hoặc được sử dụng.');
    const encoded = await passwordHash(password);
    await db.$transaction(async (tx) => {
      const count = await tx.passwordResetRequest.updateMany({
        where: { id: reset.id, consumedAt: null, expiresAt: { gt: new Date() } },
        data: { consumedAt: new Date() },
      });
      if (!count.count) conflict('INVALID_TOKEN', 'Liên kết đã được sử dụng.');
      await tx.passwordResetRequest.updateMany({
        where: { userId: reset.userId, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      await tx.user.update({ where: { id: reset.userId }, data: { passwordHash: encoded } });
      await tx.authSession.updateMany({
        where: { userId: reset.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });
    return { message: 'Đã đặt lại mật khẩu. Vui lòng đăng nhập lại.' };
  }
  @Get('me') async me(@Current() identity: Identity) {
    return withAvatar(
      await db.user.findUniqueOrThrow({ where: { id: identity.id }, select: publicUser }),
    );
  }
  @Patch('me') @ApiBody({ schema: profileBody }) async updateMe(
    @Current() identity: Identity,
    @Body() body: unknown,
  ) {
    return withAvatar(
      await db.user.update({
        where: { id: identity.id },
        data: validate(profileSchema, body),
        select: publicUser,
      }),
    );
  }
}
