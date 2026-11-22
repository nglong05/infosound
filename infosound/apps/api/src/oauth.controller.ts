import { createHash } from 'node:crypto';
import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { db } from '@infosound/database';
import { hashToken, randomToken } from '@infosound/contracts';
import { Public, type AuthRequest } from './security';
import { throttle, validate } from './helpers';
import { createSession, setRefreshCookie } from './auth-session';
import { requestAppOrigin } from './app-origins';
import {
  authorizationUrl,
  exchangeProfile,
  isOAuthProvider,
  oauthConfiguration,
  oauthOrigin,
  oauthProviderNames,
  OAuthFailure,
  oauthFailureDiagnostic,
  providerConfiguration,
  sameHash,
  type OAuthDiagnosticStage,
  type OAuthProvider,
} from './oauth-provider';

const flowDuration = 10 * 60 * 1000;
const flowCookieSettings = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: flowDuration,
};
const cookieFor = (provider: OAuthProvider) => `__Host-infosound-oauth-${provider}`;
const tokenValue = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
const startSchema = z.object({ role: z.enum(['USER', 'AUTHOR']).default('USER') }).strict();

@ApiTags('InfoSound OAuth')
@Controller('api/v1/auth/oauth')
export class OAuthController {
  @Public()
  @Get('providers')
  @ApiOperation({ summary: 'Các phương thức đăng nhập đang được cấu hình' })
  providers(@Req() req: AuthRequest) {
    const configuration = oauthConfiguration();
    const origin = requestAppOrigin(req.headers.host);
    return {
      providers: (Object.keys(oauthProviderNames) as OAuthProvider[]).map((id) => ({
        id,
        name: oauthProviderNames[id],
        enabled: !!oauthOrigin(origin, id) && !!configuration[id],
      })),
      emailEnabled: process.env.EMAIL_ENABLED === 'true',
    };
  }

  @Public()
  @Post(':provider/start')
  @ApiOperation({ summary: 'Bắt đầu OAuth gắn với trình duyệt; role chỉ dùng cho tài khoản mới' })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: { role: { type: 'string', enum: ['USER', 'AUTHOR'], default: 'USER' } },
    },
  })
  async start(
    @Param('provider') requested: string,
    @Body() body: unknown,
    @Req() req: AuthRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    throttle(`oauth-start:${req.ip}`, 20, 3600000);
    const input = validate(startSchema, body ?? {});
    if (!isOAuthProvider(requested))
      throw new ServiceUnavailableException({
        code: 'OAUTH_UNAVAILABLE',
        message: 'Phương thức đăng nhập chưa sẵn sàng.',
      });
    const provider = requested;
    const origin = requestAppOrigin(req.headers.host);
    if (!origin || req.headers.origin !== origin)
      throw new ServiceUnavailableException({
        code: 'OAUTH_UNAVAILABLE',
        message: 'Phương thức đăng nhập chưa sẵn sàng.',
      });
    let config;
    try {
      config = providerConfiguration(provider, origin);
    } catch {
      throw new ServiceUnavailableException({
        code: 'OAUTH_UNAVAILABLE',
        message: 'Phương thức đăng nhập chưa sẵn sàng.',
      });
    }
    await db.oAuthFlow.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    if ((await db.oAuthFlow.count()) >= 10000)
      throw new ServiceUnavailableException({
        code: 'OAUTH_BUSY',
        message: 'Đăng nhập đang bận. Vui lòng thử lại sau.',
      });
    const oldBinding = req.cookies?.[cookieFor(provider)] as unknown;
    if (tokenValue(oldBinding))
      await db.oAuthFlow.deleteMany({ where: { provider, bindingHash: hashToken(oldBinding) } });
    const state = randomToken(),
      binding = randomToken();
    const nonce = provider === 'facebook' ? null : randomToken();
    const codeVerifier = provider === 'facebook' ? null : randomToken();
    const challenge = codeVerifier
      ? createHash('sha256').update(codeVerifier).digest('base64url')
      : null;
    const url = authorizationUrl(provider, config, state, nonce, challenge, origin);
    await db.oAuthFlow.create({
      data: {
        provider,
        role: input.role,
        stateHash: hashToken(state),
        bindingHash: hashToken(binding),
        nonceHash: nonce ? hashToken(nonce) : null,
        codeVerifier,
        expiresAt: new Date(Date.now() + flowDuration),
      },
    });
    res.cookie(cookieFor(provider), binding, flowCookieSettings);
    return { url };
  }

  @Public()
  @Get(':provider/callback')
  @ApiOperation({ summary: 'Nhận authorization code và xác minh danh tính tại server' })
  async callback(
    @Param('provider') requested: string,
    @Query() query: Record<string, unknown>,
    @Req() req: AuthRequest,
    @Res() res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    let stage: OAuthDiagnosticStage = 'callback';
    try {
      throttle(`oauth-callback:${req.ip}`, 40);
      if (!isOAuthProvider(requested)) throw new OAuthFailure('provider_unavailable');
      const provider = requested;
      const origin = requestAppOrigin(req.headers.host);
      if (!origin) throw new OAuthFailure('provider_unavailable');
      stage = 'configuration';
      const config = providerConfiguration(provider, origin);
      stage = 'flow_state';
      const binding: unknown = req.cookies?.[cookieFor(provider)];
      res.clearCookie(cookieFor(provider), flowCookieSettings);
      if (!tokenValue(query.state) || !tokenValue(binding)) throw new OAuthFailure('invalid_state');
      const flow = await db.oAuthFlow.findUnique({ where: { stateHash: hashToken(query.state) } });
      if (
        !flow ||
        flow.provider !== provider ||
        flow.expiresAt < new Date() ||
        !sameHash(flow.bindingHash, hashToken(binding))
      )
        throw new OAuthFailure('invalid_state');
      // Atomic deletion consumes state before external I/O, including failures.
      // Replay/concurrent callbacks cannot redeem this browser-bound flow twice.
      const consumed = await db.oAuthFlow.deleteMany({
        where: { id: flow.id, expiresAt: { gt: new Date() } },
      });
      if (consumed.count !== 1) throw new OAuthFailure('invalid_state');
      if (query.error !== undefined)
        throw new OAuthFailure(query.error === 'access_denied' ? 'cancelled' : 'signin_failed');
      if (
        typeof query.code !== 'string' ||
        !query.code.length ||
        query.code.length > 8192 ||
        /[\x00-\x1f\x7f]/.test(query.code)
      )
        throw new OAuthFailure();
      stage = 'token_exchange';
      const profile = await exchangeProfile(
        provider,
        config,
        query.code,
        flow.codeVerifier,
        flow.nonceHash,
        origin,
      );
      stage = 'account_transaction';
      const session = await db.$transaction(async (tx) => {
        const identity = await tx.externalIdentity.findUnique({
          where: { provider_subject: { provider, subject: profile.subject } },
          include: { user: { select: { id: true, active: true } } },
        });
        let userId: string;
        if (identity) {
          if (!identity.user.active) throw new OAuthFailure('account_disabled');
          userId = identity.userId;
        } else {
          // Email equality never attaches an identity to a password account.
          if (
            profile.verifiedEmail &&
            (await tx.user.findUnique({
              where: { email: profile.verifiedEmail },
              select: { id: true },
            }))
          )
            throw new OAuthFailure('account_exists');
          const user = await tx.user.create({
            data: {
              email: profile.verifiedEmail,
              displayName: profile.displayName,
              passwordHash: null,
              role: flow.role,
            },
          });
          await tx.externalIdentity.create({
            data: {
              userId: user.id,
              provider,
              subject: profile.subject,
              providerEmail: profile.providerEmail,
            },
          });
          userId = user.id;
        }
        return createSession(tx, userId);
      });
      stage = 'session_cookie';
      setRefreshCookie(res, session.cookie);
      // Tokens and authorization codes never appear in the frontend redirect.
      return res.redirect(303, '/oauth/complete');
    } catch (error) {
      const code = error instanceof OAuthFailure ? error.code : 'signin_failed';
      process.stderr.write(
        JSON.stringify({
          level: 'warn',
          event: 'oauth_callback_failed',
          code,
          ...oauthFailureDiagnostic(error, stage),
        }) + '\n',
      );
      return res.redirect(303, `/login?oauth_error=${code}`);
    }
  }
}
