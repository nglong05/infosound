import { createHmac, randomInt } from 'node:crypto';
import { z } from 'zod';
import { registerSchema } from '@infosound/contracts';
import { sameHash } from './oauth-provider';

export const OTP_DURATION_MS = 8 * 60 * 1000;
export const OTP_COOLDOWN_SECONDS = 60;
export const OTP_MAX_ATTEMPTS = 5;
export const otpRequestSchema = registerSchema;
export const otpResendSchema = z
  .object({ requestId: z.string().regex(/^[A-Za-z0-9_-]{43}$/) })
  .strict();
export const otpVerifySchema = z
  .object({ requestId: z.string().regex(/^[A-Za-z0-9_-]{43}$/), code: z.string().regex(/^\d{6}$/) })
  .strict();

export function generateOtpCode(): string {
  return randomInt(0, 1000000).toString().padStart(6, '0');
}
export function otpHash(requestId: string, code: string, secretValue: string): string {
  if (!/^[a-f0-9]{64}$/i.test(secretValue)) throw new Error('OTP_SECRET_INVALID');
  return createHmac('sha256', Buffer.from(secretValue, 'hex'))
    .update('infosound-email-otp-v1\0')
    .update(requestId)
    .update('\0')
    .update(code)
    .digest('hex');
}
export function matchesOtp(
  requestId: string,
  code: string,
  hash: string,
  secretValue: string,
): boolean {
  return sameHash(otpHash(requestId, code, secretValue), hash);
}
