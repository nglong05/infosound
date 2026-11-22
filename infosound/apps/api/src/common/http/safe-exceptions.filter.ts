import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import type { Response } from 'express';
import { Prisma } from '@infosound/database';
import type { AuthRequest } from '../../security';

@Catch()
export class SafeExceptions implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const req = host.switchToHttp().getRequest<AuthRequest>();
    let status = 500,
      body: Record<string, unknown> = {
        code: 'INTERNAL_ERROR',
        message: 'Không thể xử lý yêu cầu. Vui lòng thử lại.',
      };
    if (error instanceof HttpException) {
      status = error.getStatus();
      const data = error.getResponse();
      body = typeof data === 'string' ? { message: data } : (data as Record<string, unknown>);
    } else if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        status = 409;
        body = { code: 'CONFLICT', message: 'Dữ liệu đã tồn tại.' };
      }
      if (error.code === 'P2025') {
        status = 404;
        body = { code: 'NOT_FOUND', message: 'Không tìm thấy dữ liệu.' };
      }
    }
    if (
      status === 429 &&
      typeof body.retryAfterSeconds === 'number' &&
      Number.isFinite(body.retryAfterSeconds) &&
      body.retryAfterSeconds > 0
    )
      res.setHeader('Retry-After', String(Math.ceil(body.retryAfterSeconds)));
    if (status >= 500)
      process.stderr.write(
        JSON.stringify({
          level: 'error',
          event: 'request_failed',
          requestId: req.requestId,
          error: error instanceof Error ? error.constructor.name : 'UnknownError',
        }) + '\n',
      );
    res.status(status).json({ ...body, requestId: req.requestId });
  }
}
