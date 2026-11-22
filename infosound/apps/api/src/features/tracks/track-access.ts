import { NotFoundException } from '@nestjs/common';
import { db } from '@infosound/database';
import type { Identity } from '../../security';
import { uuid } from '../../common/validation';

export async function requireOwner(trackId: string, identity: Identity) {
  const track = await db.track.findFirst({
    where: { id: uuid(trackId), authorId: identity.id, deletedAt: null },
  });
  if (!track)
    throw new NotFoundException({ code: 'TRACK_NOT_FOUND', message: 'Không tìm thấy bài hát.' });
  return track;
}
