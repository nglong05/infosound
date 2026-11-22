import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { db } from '@infosound/database';
import {
  createModerationService,
  loadConfig,
  ModerationAccessError,
} from '@infosound/comment-moderation/server';
import { Current, type Identity } from './security';
import { uuid, validate } from './helpers';

export const moderation = createModerationService({ db, config: loadConfig() });
export async function moderationCall<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof ModerationAccessError)
      throw new HttpException(
        {
          code: error.code,
          message:
            error.status === 409
              ? 'Nội dung hoặc quyết định đã thay đổi. Hãy tải lại.'
              : error.status === 429
                ? 'Bạn gửi bình luận quá nhanh. Hãy thử lại sau.'
                : error.status === 403
                  ? 'Bạn không có quyền kiểm duyệt.'
                  : 'Không thể xử lý bình luận.',
          ...(error.status === 429 ? { retryAfterSeconds: 60 } : {}),
        },
        error.status,
      );
    throw error;
  }
}
const expected = z
  .object({
    expected_content_version: z.number().int().positive(),
    expected_moderation_revision: z.number().int().positive(),
  })
  .strict();
const page = z
  .object({
    page: z.coerce.number().int().min(1).max(10000).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();
const filters = page
  .extend({
    status: z.enum(['PENDING', 'VISIBLE', 'HELD', 'HIDDEN', 'DELETED']).optional(),
    label: z
      .enum(['harassment', 'hate', 'threat', 'sexual', 'spam', 'scam', 'privacy', 'profanity'])
      .optional(),
    errorCode: z
      .string()
      .regex(/^[A-Z_]{1,50}$/)
      .optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  })
  .strict();
@Controller('api/v1')
export class ModerationController {
  @Get('comments/moderation-permissions') permissions(@Current() user: Identity) {
    return moderationCall(() => moderation.permissions(user.id));
  }
  @Get('tracks/:trackId/comments/mine') mine(
    @Param('trackId') trackId: string,
    @Query() query: unknown,
    @Current() user: Identity,
  ) {
    const p = validate(page, query);
    return moderationCall(() => moderation.mine(uuid(trackId), user.id, p.page, p.pageSize));
  }
  @Get('comments/:id/moderation-status') status(
    @Param('id') id: string,
    @Current() user: Identity,
  ) {
    return moderationCall(() => moderation.status(uuid(id), user.id));
  }
  @Get('comments/:id/deletion-target') @Header('Cache-Control', 'private, no-store') deletionTarget(
    @Param('id') id: string,
    @Current() user: Identity,
  ) {
    return moderationCall(() => moderation.deletionTarget(uuid(id), user.id));
  }
  @Patch('comments/:id') edit(
    @Param('id') id: string,
    @Current() user: Identity,
    @Body() body: unknown,
  ) {
    const data = validate(
      expected
        .extend({
          body: z
            .string()
            .min(1)
            .refine((v) => [...v].length <= 2000),
        })
        .strict(),
      body,
    );
    return moderationCall(() => moderation.edit(uuid(id), user.id, data));
  }
  @Delete('comments/:id') remove(
    @Param('id') id: string,
    @Current() user: Identity,
    @Body() body: unknown,
  ) {
    const data = validate(expected, body);
    return moderationCall(() => moderation.remove(uuid(id), user.id, data));
  }
  @Post('comments/:id/review-request') review(
    @Param('id') id: string,
    @Current() user: Identity,
    @Body() body: unknown,
  ) {
    const data = validate(expected, body);
    return moderationCall(() => moderation.reviewRequest(uuid(id), user.id, data));
  }
  @Get('admin/moderation/comments') list(@Query() query: unknown, @Current() user: Identity) {
    const data = validate(filters, query);
    return moderationCall(() => moderation.list(user.id, data));
  }
  @Get('admin/moderation/metrics') metrics(@Current() user: Identity) {
    return moderationCall(() => moderation.metrics(user.id));
  }
  @Get('admin/moderation/comments/:id') detail(@Param('id') id: string, @Current() user: Identity) {
    return moderationCall(() => moderation.detail(uuid(id), user.id));
  }
  @Post('admin/moderation/comments/:id/decision') decision(
    @Param('id') id: string,
    @Current() user: Identity,
    @Body() body: unknown,
  ) {
    const data = validate(
      expected
        .extend({ action: z.enum(['APPROVE', 'HIDE']), reason: z.string().trim().min(1).max(300) })
        .strict(),
      body,
    );
    return moderationCall(() => moderation.decision(uuid(id), user.id, data));
  }
  @Post('admin/moderation/comments/:id/retry') retry(
    @Param('id') id: string,
    @Current() user: Identity,
    @Body() body: unknown,
  ) {
    const data = validate(expected, body);
    return moderationCall(() => moderation.retry(uuid(id), user.id, data));
  }
}
