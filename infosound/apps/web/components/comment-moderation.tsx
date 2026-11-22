'use client';
import { createContext, useContext, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CommentStatusObserver,
  OwnCommentMenu,
  ModerationQueue,
  type ModerationPermissions,
} from '@infosound/comment-moderation/browser';
import { api } from '@/lib/api';
import { useAuth } from './providers';
import { useI18n } from './locale-provider';
import { Loading, ErrorState } from './common';
import { NavigationAction } from './navigation-action';
export { moderationSubmissionMessage } from '@infosound/comment-moderation/browser';

const RefreshContext = createContext<(() => void) | null>(null);
export const useCommentModerationRefresh = () => useContext(RefreshContext);

/** Adapter supplies the existing session-aware API and query cache to module-owned UI. */
export function CommentModerationScope({
  trackId,
  userId,
  children,
}: {
  trackId: string;
  userId?: string;
  children: ReactNode;
}) {
  const queryClient = useQueryClient();
  const [refresh, setRefresh] = useState(0);
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['track-comments'] });
    void queryClient.invalidateQueries({ queryKey: ['notifications'] });
  };
  const changed = () => {
    setRefresh((value) => value + 1);
    invalidate();
  };
  return (
    <RefreshContext.Provider value={changed}>
      {children}
      {userId && (
        <CommentStatusObserver
          key={userId + ':' + trackId}
          api={api}
          trackId={trackId}
          refresh={refresh}
          onChanged={invalidate}
        />
      )}
    </RefreshContext.Provider>
  );
}
export function CommentOwnerMenu({ id, viewerId }: { id: string; viewerId: string }) {
  const { locale } = useI18n(),
    queryClient = useQueryClient(),
    refresh = useCommentModerationRefresh();
  return (
    <OwnCommentMenu
      key={viewerId + ':' + id}
      id={id}
      api={api}
      locale={locale}
      onChanged={() => {
        if (refresh) refresh();
        else {
          void queryClient.invalidateQueries({ queryKey: ['track-comments'] });
          void queryClient.invalidateQueries({ queryKey: ['notifications'] });
        }
      }}
    />
  );
}
function usePermissions() {
  const { user, loading } = useAuth();
  return useQuery({
    queryKey: ['comment-moderation', 'permissions', user?.id ?? 'visitor'],
    enabled: !loading && !!user,
    queryFn: ({ signal }) =>
      api<ModerationPermissions>('/comments/moderation-permissions', { signal }),
    staleTime: 30_000,
    retry: false,
  });
}
export function ModerationSettingsLink() {
  const result = usePermissions(),
    { locale } = useI18n();
  if (!result.data?.read) return null;
  return (
    <section className="surface">
      <h2>{locale === 'vi' ? 'Kiểm duyệt bình luận' : 'Comment moderation'}</h2>
      <NavigationAction href="/admin/moderation">
        {locale === 'vi' ? 'Mở hàng chờ kiểm duyệt' : 'Open moderation queue'}
      </NavigationAction>
    </section>
  );
}
export function CommentModerationPage() {
  const { user, loading } = useAuth(),
    { locale, formatDateTime } = useI18n();
  const result = usePermissions();
  if (loading || (user && result.isPending)) return <Loading />;
  if (result.isError)
    return <ErrorState error={result.error} retry={() => void result.refetch()} />;
  if (!user || !result.data?.read)
    return (
      <p role="status">
        {locale === 'vi'
          ? 'Bạn không có quyền xem hàng chờ kiểm duyệt.'
          : 'You do not have permission to view the moderation queue.'}
      </p>
    );
  return (
    <ModerationQueue
      key={user.id}
      api={api}
      locale={locale}
      permissions={result.data}
      formatDateTime={formatDateTime}
    />
  );
}
