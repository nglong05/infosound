import type { Prisma } from '@infosound/database';

export class OutboxFailure extends Error {
  constructor(
    readonly category:
      | 'OUTBOX_VALIDATION_FAILED'
      | 'MAIL_VALIDATION_FAILED'
      | 'MAIL_DECRYPTION_FAILED'
      | 'EMAIL_UNAVAILABLE',
  ) {
    super(category);
  }
}

export function safeDeliveryFailure(error: unknown): {
  failureCategory: string;
  smtpResponseCode?: number;
} {
  // Never serialize errors, messages, SMTP responses or Prisma metadata. Only
  // exact, locally defined labels and a bounded numeric SMTP status may escape.
  const allowed = new Set([
    'EAUTH',
    'ECONNECTION',
    'ESOCKET',
    'ETIMEDOUT',
    'EDNS',
    'EENVELOPE',
    'EMESSAGE',
    'ESTREAM',
    'EFILE',
    'ETLS',
    'EPROTOCOL',
    'ECUSTOMAUTH',
    'ENOAUTH',
    'EOAUTH2',
    'EREQUIRETLS',
    'EMAXLIMIT',
    'ECLOSED',
    'EPROXY',
    'ECONNRESET',
    'ECONNREFUSED',
    'ECONNABORTED',
    'ENOTFOUND',
    'EAI_AGAIN',
    'P1000',
    'P1001',
    'P1002',
    'P1008',
    'P1010',
    'P1011',
    'P1017',
    'P2000',
    'P2002',
    'P2003',
    'P2004',
    'P2010',
    'P2021',
    'P2022',
    'P2024',
    'P2025',
    'P2028',
    'P2034',
  ]);
  if (error instanceof OutboxFailure) return { failureCategory: error.category };
  if (!error || typeof error !== 'object') return { failureCategory: 'DELIVERY_FAILED' };
  try {
    const fields = error as { code?: unknown; responseCode?: unknown };
    const failureCategory =
      typeof fields.code === 'string' && allowed.has(fields.code) ? fields.code : 'DELIVERY_FAILED';
    const status = fields.responseCode;
    return {
      failureCategory,
      ...(typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599
        ? { smtpResponseCode: status }
        : {}),
    };
  } catch {
    return { failureCategory: 'DELIVERY_FAILED' };
  }
}

export function record(value: Prisma.JsonValue): Record<string, unknown> {
  if (!value || Array.isArray(value) || typeof value !== 'object')
    throw new OutboxFailure('OUTBOX_VALIDATION_FAILED');
  return value as Record<string, unknown>;
}

export function uuid(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  )
    throw new Error('INVALID_OUTBOX_IDENTIFIER');
  return value;
}
