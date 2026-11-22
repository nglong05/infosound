import 'reflect-metadata';
import { AppModule } from './app.module';
import { SafeExceptions } from './common/http/safe-exceptions.filter';

import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import type { NextFunction, Response } from 'express';
import { json } from 'express';
import type { AuthRequest } from './security';
import { GatewayTrustCache } from './gateway-trust';
import { configuredAppOrigins } from './app-origins';
async function bootstrap() {
  const browserOrigins = configuredAppOrigins();
  const app = await NestFactory.create(AppModule, { logger: false, bodyParser: false });
  const moderationJson = json({ limit: '32kb' }),
    defaultJson = json({ limit: '100kb' });
  app.use((req: AuthRequest, res: Response, next: NextFunction) => {
    const parser =
      /^\/api\/v1\/(?:comments(?:\/|$)|admin\/moderation(?:\/|$)|tracks\/[^/]+\/comments(?:\/|$))/.test(
        req.path,
      )
        ? moderationJson
        : defaultJson;
    parser(req, res, (error?: unknown) => {
      if (error)
        return res
          .status((error as { type?: string }).type === 'entity.too.large' ? 413 : 400)
          .json({ code: 'INVALID_REQUEST_BODY', message: 'Nội dung yêu cầu không hợp lệ.' });
      next();
    });
  });
  const server = app.getHttpAdapter().getInstance() as {
    set: (key: string, value: unknown) => void;
  };
  const gatewayTrust = new GatewayTrustCache(undefined, (event, trustedAddressCount) =>
    process.stdout.write(JSON.stringify({ level: 'info', event, trustedAddressCount }) + '\n'),
  );
  // Empty initially. Only the exact current Docker DNS addresses of gateway can
  // supply forwarded client addresses, never a client-provided CIDR or header.
  server.set('trust proxy', gatewayTrust.trust);
  await gatewayTrust.start();
  process.once('SIGTERM', () => gatewayTrust.stop());
  process.once('SIGINT', () => gatewayTrust.stop());
  app.use(cookieParser());
  app.use((req: AuthRequest, res: Response, next: NextFunction) => {
    const forwardedId = req.headers['x-request-id'];
    req.requestId =
      gatewayTrust.trust(req.socket.remoteAddress ?? '') &&
      typeof forwardedId === 'string' &&
      /^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.test(
        forwardedId,
      )
        ? forwardedId
        : randomUUID();
    res.setHeader('X-Request-ID', req.requestId);
    res.setHeader('Cache-Control', 'no-store');
    const started = Date.now();
    res.on('finish', () =>
      process.stdout.write(
        JSON.stringify({
          level: 'info',
          requestId: req.requestId,
          method: req.method,
          path: req.path,
          status: res.statusCode,
          durationMs: Date.now() - started,
        }) + '\n',
      ),
    );
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      if (
        typeof req.headers.origin !== 'string' ||
        !browserOrigins.includes(req.headers.origin) ||
        ['cross-site', 'same-site'].includes(req.headers['sec-fetch-site'] as string)
      )
        return res
          .status(403)
          .json({ code: 'CSRF_ORIGIN_DENIED', message: 'Nguồn yêu cầu không hợp lệ.' });
      if (req.path.startsWith('/api/v1/auth/') && req.headers['x-infosound-csrf'] !== '1')
        return res
          .status(403)
          .json({ code: 'CSRF_HEADER_REQUIRED', message: 'Thiếu xác nhận yêu cầu.' });
    }
    next();
  });
  app.enableCors({
    origin: browserOrigins,
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-InfoSound-CSRF', 'Idempotency-Key'],
  });
  app.useGlobalFilters(new SafeExceptions());
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('InfoSound API')
      .setDescription('API chia sẻ và nghe nhạc InfoSound.')
      .setVersion('1.1.0')
      .addBearerAuth()
      .build(),
  );
  // Served only on private container network; gateway explicitly denies this route.
  SwaggerModule.setup('internal/openapi', app, document, {
    jsonDocumentUrl: 'internal/openapi.json',
  });
  app.enableShutdownHooks();
  await app.listen(3001, '0.0.0.0');
}
bootstrap().catch((error) => {
  process.stderr.write(
    JSON.stringify({
      level: 'fatal',
      event: 'api_boot_failed',
      error: error instanceof Error ? error.constructor.name : 'UnknownError',
    }) + '\n',
  );
  process.exit(1);
});
