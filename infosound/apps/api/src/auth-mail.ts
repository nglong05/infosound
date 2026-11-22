import { ServiceUnavailableException } from '@nestjs/common';
import { Prisma, secret } from '@infosound/database';
import { encryptMailEnvelope } from '@infosound/contracts';

export function requireEmailEnabled() {
  if (process.env.EMAIL_ENABLED !== 'true')
    throw new ServiceUnavailableException({
      code: 'EMAIL_UNAVAILABLE',
      message: 'Đăng ký và khôi phục qua email hiện chưa sẵn sàng. Vui lòng thử lại sau.',
    });
}
export function encryptedMail(
  to: string,
  subject: string,
  text: string,
  expiresAt: Date,
): Prisma.OutboxEventCreateInput {
  return {
    type: 'MAIL',
    payload: {
      envelope: encryptMailEnvelope({ to, subject, text }, secret('MAIL_ENCRYPTION_KEY')),
      expiresAt: expiresAt.toISOString(),
    },
  };
}
