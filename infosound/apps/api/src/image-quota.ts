import type { Prisma } from '@infosound/database';
import { conflict } from './helpers';

/** Caller holds the user row lock; cancellation/restart does not reset this budget. */
export async function reserveImageQuota(
  tx: Prisma.TransactionClient,
  userId: string,
  bytes: number,
) {
  const user = await tx.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      imageUploadWindowAt: true,
      imageUploadWindowBytes: true,
      imageUploadWindowCount: true,
    },
  });
  const now = new Date();
  const reset =
    !user.imageUploadWindowAt || user.imageUploadWindowAt.getTime() <= now.getTime() - 86_400_000;
  const total = (reset ? 0n : user.imageUploadWindowBytes) + BigInt(bytes),
    count = (reset ? 0 : user.imageUploadWindowCount) + 1;
  if (total > 50n * 1024n * 1024n || count > 20)
    conflict(
      'IMAGE_QUOTA_EXCEEDED',
      'Bạn đã đạt giới hạn tải ảnh trong 24 giờ. Vui lòng thử lại sau.',
    );
  await tx.user.update({
    where: { id: userId },
    data: {
      imageUploadWindowAt: reset ? now : user.imageUploadWindowAt,
      imageUploadWindowBytes: total,
      imageUploadWindowCount: count,
    },
  });
}
