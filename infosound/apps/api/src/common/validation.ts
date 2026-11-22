import { BadRequestException, ConflictException } from '@nestjs/common';
import { z } from 'zod';

export function validate<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new BadRequestException({
      code: 'VALIDATION_FAILED',
      message: 'Thông tin chưa hợp lệ.',
      fields: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  return result.data;
}
export function uuid(value: string): string {
  return validate(z.string().uuid(), value);
}
export function conflict(code: string, message: string): never {
  throw new ConflictException({ code, message });
}
