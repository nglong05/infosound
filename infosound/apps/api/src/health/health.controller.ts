import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import Redis from 'ioredis';
import { db, secret } from '@infosound/database';
import { Public } from '../security';

const queue = new Redis({
  host: process.env.REDIS_HOST ?? 'redis',
  port: 6379,
  username: 'queue',
  password: secret('REDIS_PASSWORD'),
  lazyConnect: true,
  maxRetriesPerRequest: 1,
  retryStrategy: (times) => Math.min(times * 1000, 10000),
  connectTimeout: 2000,
});
queue.on('error', () => {});
@Controller('health')
export class HealthController {
  @Public() @Get('live') live() {
    return { status: 'ok', service: 'InfoSound API' };
  }
  @Public() @Get('ready') async ready(@Res({ passthrough: true }) res: Response) {
    try {
      await db.$queryRaw`SELECT 1`;
    } catch {
      res.status(503);
      return { status: 'unready', database: 'unavailable' };
    }
    let redis = 'ok';
    try {
      if (queue.status === 'wait') await queue.connect();
      await queue.ping();
    } catch {
      redis = 'unavailable';
    }
    return { status: redis === 'ok' ? 'ready' : 'degraded', database: 'ok', redis };
  }
}
