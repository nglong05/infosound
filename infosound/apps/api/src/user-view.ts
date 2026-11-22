import { mediaUrl } from '@infosound/storage';

type AvatarOwner = { avatarKey: string | null; avatarVersionId: string | null };
export async function withAvatar<T extends AvatarOwner>(
  user: T,
): Promise<Omit<T, 'avatarKey' | 'avatarVersionId'> & { avatarUrl: string | null }> {
  const { avatarKey, avatarVersionId, ...visible } = user;
  return {
    ...visible,
    avatarUrl: avatarKey
      ? await mediaUrl('artwork', avatarKey, { versionId: avatarVersionId })
      : null,
  };
}
