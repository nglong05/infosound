import { HttpException } from '@nestjs/common';

const attempts = new Map<string, { count: number; until: number }>();
export function throttle(key: string, limit: number, interval = 60_000) {
  const now = Date.now();
  let nextExpiry = Number.POSITIVE_INFINITY;
  if (attempts.size >= 10000)
    for (const [k, v] of attempts) {
      if (v.until <= now) attempts.delete(k);
      else nextExpiry = Math.min(nextExpiry, v.until);
    }
  const item = attempts.get(key);
  if (!item || item.until <= now) {
    if (attempts.size >= 10000 && !item)
      throw new HttpException(
        {
          code: 'RATE_LIMITED',
          message: 'Hệ thống đang bận. Vui lòng thử lại sau.',
          retryAfterSeconds: Math.max(1, Math.ceil((nextExpiry - now) / 1000)),
        },
        429,
      );
    attempts.set(key, { count: 1, until: now + interval });
    return;
  }
  if (item.count >= limit)
    throw new HttpException(
      {
        code: 'RATE_LIMITED',
        message: 'Bạn thao tác quá nhanh. Vui lòng thử lại sau.',
        retryAfterSeconds: Math.max(1, Math.ceil((item.until - now) / 1000)),
      },
      429,
    );
  item.count++;
}
