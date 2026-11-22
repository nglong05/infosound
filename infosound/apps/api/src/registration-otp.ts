import {
  ConflictException,
  HttpException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { db, secret, Prisma } from '@infosound/database';
import { hashToken, randomToken } from '@infosound/contracts';
import type { AuthRequest } from './security';
import { throttle, validate } from './helpers';
import { encryptedMail, requireEmailEnabled } from './auth-mail';
import { hashPassword } from './auth-password';
import {
  generateOtpCode,
  matchesOtp,
  otpHash,
  otpRequestSchema,
  otpResendSchema,
  otpVerifySchema,
  OTP_COOLDOWN_SECONDS,
  OTP_DURATION_MS,
  OTP_MAX_ATTEMPTS,
} from './email-otp';

const invalidCode = () =>
  new UnauthorizedException({
    code: 'OTP_INVALID',
    message: 'Mã xác minh không hợp lệ hoặc đã hết hạn.',
  });
const usernameUnavailable = () =>
  new ConflictException({
    code: 'USERNAME_UNAVAILABLE',
    message: 'Tên tài khoản đã được sử dụng hoặc đang chờ xác minh. Vui lòng chọn tên khác.',
  });
const response = (requestId: string) => ({
  requestId,
  message: 'Nếu thông tin đăng ký hợp lệ, mã xác minh sẽ được gửi đến email của bạn.',
  retryAfterSeconds: OTP_COOLDOWN_SECONDS,
  expiresInSeconds: OTP_DURATION_MS / 1000,
});

async function lockRegistration(tx: Prisma.TransactionClient, email: string, username: string) {
  // Every request/resend/verify takes these in the same order before row locks.
  await tx.$queryRaw`SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(${`infosound:registration-email:${email}`},0))::text`;
  await tx.$queryRaw`SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(${`infosound:registration-username:${username}`},0))::text`;
}
function registrationMail(email: string, username: string, code: string, expiresAt: Date) {
  return encryptedMail(
    email,
    'InfoSound — Xác minh đăng ký',
    `Mã xác minh đăng ký InfoSound của bạn là: ${code}\nTên tài khoản: ${username}\nMã có hiệu lực trong 8 phút, chỉ dùng để hoàn tất đăng ký và chỉ được sử dụng một lần. Không chia sẻ mã này với bất kỳ ai.\nNếu bạn không yêu cầu đăng ký, hãy bỏ qua email này.`,
    expiresAt,
  );
}

export async function requestRegistration(body: unknown, req: AuthRequest) {
  requireEmailEnabled();
  throttle(`registration-request-ip:${req.ip}`, 20, 3600000);
  const input = validate(otpRequestSchema, body);
  throttle(`registration-request-email:${hashToken(input.email)}`, 5, 600000);
  const requestId = randomToken(),
    code = generateOtpCode();
  const expiresAt = new Date(Date.now() + OTP_DURATION_MS);
  const codeHash = otpHash(requestId, code, secret('OTP_SECRET'));
  const passwordHash = await hashPassword(input.password);
  await db.$transaction(async (tx) => {
    await lockRegistration(tx, input.email, input.username);
    await tx.emailOtpChallenge.updateMany({
      where: {
        consumedAt: null,
        expiresAt: { lte: new Date() },
        OR: [{ email: input.email }, { username: input.username }],
      },
      data: { consumedAt: new Date() },
    });
    const userNameOwner = await tx.user.findUnique({
      where: { username: input.username },
      select: { id: true },
    });
    const reservation = await tx.emailOtpChallenge.findFirst({
      where: { username: input.username, consumedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true },
    });
    // Handles are public, so a conflicting handle gets useful feedback. Never
    // reveal an existing email or the real opaque ID of another pending flow.
    if (userNameOwner || reservation) throw usernameUnavailable();
    const existingUser = await tx.user.findUnique({
      where: { email: input.email },
      select: { id: true },
    });
    const activeEmail = await tx.emailOtpChallenge.findFirst({
      where: { email: input.email, consumedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true },
    });
    if (existingUser || activeEmail) return;
    const recent = await tx.emailOtpChallenge.findFirst({
      where: {
        email: input.email,
        lastSentAt: { gt: new Date(Date.now() - OTP_COOLDOWN_SECONDS * 1000) },
      },
      select: { id: true },
    });
    if (recent)
      throw new HttpException(
        {
          code: 'RATE_LIMITED',
          message: 'Vui lòng đợi 60 giây trước khi yêu cầu mã mới.',
          retryAfterSeconds: OTP_COOLDOWN_SECONDS,
        },
        429,
      );
    if ((await tx.emailOtpChallenge.count()) >= 10000)
      throw new ServiceUnavailableException({
        code: 'OTP_BUSY',
        message: 'Đăng ký đang bận. Vui lòng thử lại sau.',
      });
    await tx.emailOtpChallenge.create({
      data: {
        requestHash: hashToken(requestId),
        email: input.email,
        username: input.username,
        passwordHash,
        codeHash,
        displayName: input.displayName ?? input.username,
        role: input.role,
        expiresAt,
      },
    });
    await tx.outboxEvent.create({
      data: registrationMail(input.email, input.username, code, expiresAt),
    });
  });
  return response(requestId);
}

export async function resendRegistration(body: unknown, req: AuthRequest) {
  requireEmailEnabled();
  throttle(`registration-resend-ip:${req.ip}`, 20, 3600000);
  const input = validate(otpResendSchema, body);
  const previousHash = hashToken(input.requestId);
  const snapshot = await db.emailOtpChallenge.findUnique({
    where: { requestHash: previousHash },
    select: { id: true, email: true, username: true },
  });
  const requestId = randomToken(),
    code = generateOtpCode();
  if (!snapshot?.username) return response(requestId);
  throttle(`registration-request-email:${hashToken(snapshot.email)}`, 5, 600000);
  const expiresAt = new Date(Date.now() + OTP_DURATION_MS);
  const codeHash = otpHash(requestId, code, secret('OTP_SECRET'));
  await db.$transaction(async (tx) => {
    await lockRegistration(tx, snapshot.email, snapshot.username!);
    const locked = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM public.email_otp_challenges WHERE request_hash=${previousHash} FOR UPDATE`;
    if (!locked.length) return;
    const challenge = await tx.emailOtpChallenge.findUnique({
      where: { requestHash: previousHash },
    });
    if (
      !challenge ||
      !challenge.username ||
      !challenge.passwordHash ||
      challenge.consumedAt ||
      challenge.expiresAt <= new Date()
    )
      return;
    const remaining = Math.ceil(
      (challenge.lastSentAt.getTime() + OTP_COOLDOWN_SECONDS * 1000 - Date.now()) / 1000,
    );
    if (remaining > 0)
      throw new HttpException(
        {
          code: 'RATE_LIMITED',
          message: 'Vui lòng đợi trước khi yêu cầu mã mới.',
          retryAfterSeconds: remaining,
        },
        429,
      );
    // Rotate only the code and opaque handle. Password hash and all registration
    // attributes stay exactly as the browser submitted on the first request.
    await tx.emailOtpChallenge.update({
      where: { id: challenge.id },
      data: {
        requestHash: hashToken(requestId),
        codeHash,
        attempts: 0,
        expiresAt,
        lastSentAt: new Date(),
      },
    });
    await tx.outboxEvent.create({
      data: registrationMail(challenge.email, challenge.username, code, expiresAt),
    });
  });
  return response(requestId);
}

export async function verifyRegistration(body: unknown, req: AuthRequest) {
  requireEmailEnabled();
  throttle(`registration-verify-ip:${req.ip}`, 60, 600000);
  const input = validate(otpVerifySchema, body);
  const requestHash = hashToken(input.requestId);
  const snapshot = await db.emailOtpChallenge.findUnique({
    where: { requestHash },
    select: { id: true, email: true, username: true },
  });
  if (!snapshot?.username) throw invalidCode();
  const otpSecret = secret('OTP_SECRET');
  const registered = await db.$transaction(async (tx) => {
    await lockRegistration(tx, snapshot.email, snapshot.username!);
    const locked = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM public.email_otp_challenges WHERE request_hash=${requestHash} FOR UPDATE`;
    if (!locked.length) return false;
    const challenge = await tx.emailOtpChallenge.findUnique({ where: { requestHash } });
    if (
      !challenge ||
      !challenge.username ||
      !challenge.passwordHash ||
      challenge.consumedAt ||
      challenge.expiresAt <= new Date() ||
      challenge.attempts >= OTP_MAX_ATTEMPTS
    )
      return false;
    const attempts = challenge.attempts + 1;
    if (!matchesOtp(input.requestId, input.code, challenge.codeHash, otpSecret)) {
      // Commit a wrong guess and its final lockout, then throw only after commit.
      await tx.emailOtpChallenge.update({
        where: { id: challenge.id },
        data: { attempts, ...(attempts >= OTP_MAX_ATTEMPTS ? { consumedAt: new Date() } : {}) },
      });
      return false;
    }
    await tx.emailOtpChallenge.update({
      where: { id: challenge.id },
      data: { consumedAt: new Date(), attempts },
    });
    const existing = await tx.user.findFirst({
      where: { OR: [{ email: challenge.email }, { username: challenge.username }] },
      select: { id: true },
    });
    if (existing) return false;
    // Registration only: never upsert an existing account or issue a session.
    await tx.user.create({
      data: {
        email: challenge.email,
        username: challenge.username,
        passwordHash: challenge.passwordHash,
        displayName: challenge.displayName,
        role: challenge.role,
      },
      select: { id: true },
    });
    return true;
  });
  if (!registered) throw invalidCode();
  return {
    registered: true,
    message: 'Đăng ký thành công. Vui lòng đăng nhập bằng email và mật khẩu.',
  };
}

export async function cancelRegistration(body: unknown, req: AuthRequest) {
  throttle(`registration-cancel-ip:${req.ip}`, 20, 3600000);
  const input = validate(otpResendSchema, body);
  const requestHash = hashToken(input.requestId);
  const snapshot = await db.emailOtpChallenge.findUnique({
    where: { requestHash },
    select: { id: true, email: true, username: true },
  });
  if (snapshot?.username) {
    await db.$transaction(async (tx) => {
      await lockRegistration(tx, snapshot.email, snapshot.username!);
      await tx.emailOtpChallenge.updateMany({
        where: { id: snapshot.id, requestHash, consumedAt: null },
        data: { consumedAt: new Date() },
      });
    });
  }
  // The opaque handle is the capability. Unknown, expired and rotated handles
  // have the same response and can never cancel a different registration.
  return { message: 'Yêu cầu đăng ký đã được hủy.' };
}
