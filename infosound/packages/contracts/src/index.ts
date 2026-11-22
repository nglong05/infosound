import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';

export * from './lyrics';

export const MAX_AUDIO_BYTES = 256 * 1024 * 1024;
export const MAX_ARTWORK_BYTES = 5 * 1024 * 1024;
export const MAX_AVATAR_BYTES = MAX_ARTWORK_BYTES;
export const MAX_IMAGE_PIXELS = 16_000_000;
export const MAX_IMAGE_EDGE = 4096;
export const MAX_NORMALIZED_IMAGE_BYTES = 2 * 1024 * 1024;
export const imageContentTypeSchema = z.enum(['image/jpeg', 'image/png', 'image/webp']);
export const imageUploadSchema = z
  .object({
    filename: z
      .string()
      .min(1)
      .max(200)
      .regex(/^[\p{L}\p{N}_\-][\p{L}\p{N} ._()\-]*\.(?:jpe?g|png|webp)$/iu, 'Tên ảnh không hợp lệ.')
      .refine((value) => !value.includes('..'), 'Tên ảnh không hợp lệ.'),
    size: z.number().int().positive().max(MAX_ARTWORK_BYTES),
    contentType: imageContentTypeSchema,
    idempotencyKey: z
      .string()
      .min(8)
      .max(128)
      .regex(/^[A-Za-z0-9_-]+$/),
  })
  .strict()
  .superRefine((value, ctx) => {
    const extension = value.filename.split('.').pop()?.toLowerCase();
    const expected =
      extension === 'jpg' || extension === 'jpeg'
        ? 'image/jpeg'
        : extension === 'png'
          ? 'image/png'
          : 'image/webp';
    if (value.contentType !== expected)
      ctx.addIssue({
        code: 'custom',
        path: ['contentType'],
        message: 'Định dạng ảnh không khớp phần mở rộng.',
      });
  });
export const PIPELINE_VERSION = 1;
export const hashToken = (value: string): string =>
  createHash('sha256').update(value).digest('hex');
export const randomToken = (): string => randomBytes(32).toString('base64url');
export const emailSchema = z
  .string()
  .trim()
  .email()
  .max(254)
  .transform((s) => s.toLowerCase());
export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^[a-z0-9_]{3,30}$/,
    'Tên tài khoản cần 3–30 ký tự, chỉ gồm chữ cái, chữ số và dấu gạch dưới.',
  );
export const passwordSchema = z
  .string()
  .min(8, 'Mật khẩu cần ít nhất 8 ký tự.')
  .max(128)
  .regex(/[A-Z]/, 'Mật khẩu cần ít nhất một chữ hoa.')
  .regex(/[a-z]/, 'Mật khẩu cần ít nhất một chữ thường.')
  .regex(/[0-9]/, 'Mật khẩu cần ít nhất một chữ số.')
  .regex(/[^A-Za-z0-9\s]/, 'Mật khẩu cần ít nhất một ký tự đặc biệt.')
  .refine((value) => !/[\x00-\x1f\x7f]/.test(value), 'Mật khẩu không được chứa ký tự điều khiển.');
export const registerSchema = z
  .object({
    email: emailSchema,
    username: usernameSchema,
    password: passwordSchema,
    displayName: z.string().trim().min(2).max(80).optional(),
    role: z.enum(['USER', 'AUTHOR']).default('USER'),
  })
  .strict();
export const verifySchema = z
  .object({ token: z.string().min(20).max(512), password: passwordSchema })
  .strict();
export const loginSchema = z
  .object({ email: emailSchema, password: z.string().min(1).max(128) })
  .strict();
export const profileSchema = z
  .object({
    displayName: z.string().trim().min(2).max(80).optional(),
    bio: z.string().max(2000).optional(),
  })
  .strict();
export const genreIdSchema = z
  .string()
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Thể loại không hợp lệ.');
export const genreIdsSchema = z
  .array(genreIdSchema)
  .max(8, 'Chọn tối đa 8 thể loại.')
  .refine((ids) => new Set(ids).size === ids.length, 'Mỗi thể loại chỉ được chọn một lần.');
const exclusiveGenreFields = (
  value: { genre?: string; genreIds?: string[] },
  ctx: z.RefinementCtx,
) => {
  if (value.genre !== undefined && value.genreIds !== undefined)
    ctx.addIssue({
      code: 'custom',
      path: ['genreIds'],
      message: 'Chỉ gửi danh sách thể loại hoặc trường thể loại cũ.',
    });
};
// Keep optional fields and legacy scalar untouched so existing upload payload hashes remain valid.
export const metadataSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(5000).optional(),
    genre: z.string().max(80).optional(),
    genreIds: genreIdsSchema.optional(),
    downloadEnabled: z.boolean().optional(),
  })
  .strict()
  .superRefine(exclusiveGenreFields);
export const uploadSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(5000).optional(),
    genre: z.string().max(80).optional(),
    genreIds: genreIdsSchema.optional(),
    downloadEnabled: z.boolean().optional(),
    filename: z
      .string()
      .min(1)
      .max(255)
      .refine((s) => !/[\x00-\x1f\x7f]/.test(s)),
    contentType: z.string().min(1).max(100),
    size: z.number().int().positive().max(MAX_AUDIO_BYTES),
    idempotencyKey: z.string().min(8).max(128),
  })
  .strict()
  .superRefine(exclusiveGenreFields);
export const playlistSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().max(2000).default(''),
    isPublic: z.boolean().default(false),
  })
  .strict();
export const playlistUpdateSchema = playlistSchema.partial();
export const orderSchema = z
  .object({
    trackIds: z
      .array(z.string().uuid())
      .max(500)
      .refine((a) => new Set(a).size === a.length),
    version: z.number().int().positive(),
  })
  .strict();
export type MailPayload = { to: string; subject: string; text: string };
export function encryptMailEnvelope(payload: MailPayload, secret: string): string {
  const key = Buffer.from(secret, 'hex');
  if (key.length !== 32) throw new Error('MAIL_ENCRYPTION_KEY must be a 32-byte hex key');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((x) => x.toString('base64url')).join('.');
}
export function decryptMailEnvelope(envelope: string, secret: string): MailPayload {
  const [iv, tag, body] = envelope.split('.').map((x) => Buffer.from(x, 'base64url'));
  if (!iv || !tag || !body) throw new Error('INVALID_MAIL_ENVELOPE');
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(secret, 'hex'), iv);
  decipher.setAuthTag(tag);
  return JSON.parse(
    Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8'),
  ) as MailPayload;
}
