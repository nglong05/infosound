'use client';
import { useI18n } from '@/components/locale-provider';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useAppRouter as useRouter } from '@/components/app-navigation';
import { NavigationAction } from '@/components/navigation-action';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, uploadFile, quality, time, type Track, type Genre, ApiError } from '@/lib/api';
import { useAuth, useToast } from '@/components/providers';
import { Icon } from '@/components/icons';
import { GenrePicker } from '@/components/genre-picker';
import { LyricsEditor } from '@/components/lyrics-editor';
import { StudioConfirmDelete } from '@/components/studio-confirm-delete';
import { useErrorSummaryFocus } from '@/components/auth-form-fields';
import { useRetryCountdown } from '@/components/use-retry-countdown';
import { PageTitle, Loading, ErrorState, Artwork } from '@/components/common';
import { useArtworkSession, type Upload } from '@/features/studio/artwork-session';
import { stateLabels } from '@/features/studio/state-labels';
import { StudioLyricsDisclosure } from '@/features/studio/lyrics-disclosure';

export function EditTrack({ id }: { id: string }) {
  const { t: translate } = useI18n();
  const { user } = useAuth();
  const mounted = useRef(false),
    currentOwner = useRef(user?.id);
  currentOwner.current = user?.id;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const retryCountdown = useRetryCountdown(user?.id || null);
  const coverSession = useArtworkSession();
  const coverInput = useRef<HTMLInputElement>(null);
  const { summary, focusErrors } = useErrorSummaryFocus();
  const queryClient = useQueryClient();
  const toast = useToast();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const [uploadStage, setUploadStage] = useState('');
  const [metadataDirty, setMetadataDirty] = useState(false);
  const [genreDraft, setGenreDraft] = useState<Genre[] | null>(null);
  const result = useQuery({
    queryKey: ['studio-track', id],
    queryFn: ({ signal }) => api<Track>('/studio/tracks/' + id, { signal }),
    refetchInterval: metadataDirty ? false : 5000,
  });
  const process = useQuery({
    queryKey: ['processing', id],
    queryFn: () =>
      api<{
        processingState: string;
        errorCode?: string;
        task?: { state?: string; errorCode?: string };
      }>('/tracks/' + id + '/processing'),
    refetchInterval: 5000,
  });
  const mutation = useMutation({
    mutationFn: ({ action, body }: { action: string; body?: unknown }) =>
      api<{ retryAfterSeconds?: number }>('/tracks/' + id + (action ? '/' + action : ''), {
        method: 'POST',
        body: body || {},
      }),
    onSuccess: (data, variables) => {
      if (variables.action === 'retry-processing')
        retryCountdown.wait(data.retryAfterSeconds ?? 10);
      void queryClient.invalidateQueries();
      toast('Đã cập nhật trạng thái bài hát.');
    },
    onError: (reason, variables) => {
      if (
        variables.action === 'retry-processing' &&
        reason instanceof ApiError &&
        reason.status === 429
      )
        retryCountdown.wait(reason.retryAfterSeconds ?? 10);
      toast(reason.message, 'error');
    },
  });
  const save = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setPending(true);
    setError('');
    const f = new FormData(e.currentTarget);
    try {
      await queryClient.cancelQueries({ queryKey: ['studio-track', id], exact: true });
      const saved = await api<Track>('/tracks/' + id, {
        method: 'PATCH',
        body: {
          title: f.get('title'),
          description: f.get('description'),
          genreIds: (genreDraft ?? result.data?.genres ?? []).map((genre) => genre.id),
          downloadEnabled: f.get('downloadEnabled') === 'on',
        },
      });
      await queryClient.cancelQueries({ queryKey: ['studio-track', id], exact: true });
      queryClient.setQueryData(['studio-track', id], saved);
      setGenreDraft(null);
      setMetadataDirty(false);
      void queryClient.invalidateQueries();
      toast('Đã lưu thông tin bài hát.');
    } catch (e) {
      setError((e as Error).message);
      focusErrors();
    } finally {
      setPending(false);
    }
  };
  const replace = async (e: FormEvent<HTMLFormElement>, artwork: boolean) => {
    e.preventDefault();
    const form = e.currentTarget;
    const input = form.querySelector<HTMLInputElement>('input[type=file]');
    const file = input?.files?.[0];
    if (!file) return;
    if (file.size > (artwork ? 5 : 256) * 1024 * 1024) {
      toast(artwork ? 'Ảnh bìa vượt 5 MiB.' : 'Tệp âm thanh vượt 256 MiB.', 'error');
      return;
    }
    setPending(true);
    setError('');
    setProgress(0);
    try {
      setUploadStage(artwork ? 'Đang tải ảnh bìa' : 'Đang tải phiên bản âm thanh mới');
      if (artwork) {
        await coverSession.upload(id, file, setProgress);
      } else {
        const init = await api<Upload>('/tracks/' + id + '/audio/uploads', {
          method: 'POST',
          body: {
            filename: file.name,
            contentType: file.type || 'application/octet-stream',
            size: file.size,
            idempotencyKey: crypto.randomUUID(),
          },
        });
        await uploadFile(init.url, file, init.headers, setProgress);
        setUploadStage('Đang kiểm tra và chốt tệp');
        await api('/uploads/' + init.uploadId + '/complete', { method: 'POST', body: {} });
      }
      form.reset();
      void queryClient.invalidateQueries();
      toast(artwork ? 'Đã cập nhật ảnh bìa.' : 'Đã gửi phiên bản âm thanh mới vào hàng đợi xử lý.');
    } catch (e) {
      setError((e as Error).message);
      focusErrors();
    } finally {
      setPending(false);
      setProgress(null);
    }
  };
  if (result.isPending) return <Loading />;
  if (result.isError)
    return <ErrorState error={result.error} retry={() => void result.refetch()} />;
  const t = result.data;
  const busy = pending || mutation.isPending;
  const published = t.publicationState === 'PUBLISHED';
  const processingState = process.data?.processingState || t.processingState;
  const deleteTrack = async () => {
    const owner = currentOwner.current;
    setPending(true);
    try {
      await api('/tracks/' + id, { method: 'DELETE' });
      if (!mounted.current || currentOwner.current !== owner) return;
      void queryClient.invalidateQueries();
      toast('Đã xóa bài hát.');
      router.push('/studio');
    } finally {
      if (mounted.current && currentOwner.current === owner) setPending(false);
    }
  };
  return (
    <div className="studio-page studio-edit-page">
      <NavigationAction className="back-link" href="/studio" previous>
        {translate('← Quay lại Studio')}
      </NavigationAction>
      <PageTitle
        eyebrow={translate('AUTHOR STUDIO / CHỈNH SỬA')}
        title={t.title}
        description={translate('Quản lý nội dung và quyết định khi nào giai điệu được chia sẻ.')}
      />
      {error && (
        <div className="form-error" role="alert" tabIndex={-1} ref={summary}>
          {translate(error)}
        </div>
      )}
      <section className="studio-status surface">
        <div>
          <span className={'status ' + processingState.toLowerCase()}>
            {translate(stateLabels[processingState] || processingState)}
          </span>
          <span className="badge">
            {published ? translate('Đã phát hành') : translate('Chưa phát hành')}
          </span>
          <p className="muted">
            {processingState === 'PROCESSING'
              ? translate('Đang kiểm tra và xử lý âm thanh. Tự động cập nhật trạng thái.')
              : processingState === 'QUEUED'
                ? translate('Tệp đã được chốt. Đang chờ worker nhận công việc.')
                : processingState === 'READY'
                  ? translate('Âm thanh đã sẵn sàng. Bạn có thể phát hành bài hát.')
                  : processingState === 'FAILED'
                    ? translate(
                        'Xử lý thất bại. Kiểm tra định dạng tệp hoặc thử lại nếu lỗi tạm thời.',
                      )
                    : translate('Bản nháp chưa hoàn tất tải lên.')}
          </p>
          {(process.data?.task?.errorCode || process.data?.errorCode || t.errorCode) && (
            <p className="small">
              {translate('Mã lỗi:')}{' '}
              {process.data?.task?.errorCode || process.data?.errorCode || t.errorCode}
            </p>
          )}
        </div>
        <div className="action-row">
          {published ? (
            <>
              <NavigationAction href={'/tracks/' + id}>{translate('Xem bài hát')}</NavigationAction>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => mutation.mutate({ action: 'unpublish' })}
              >
                {translate('Gỡ phát hành')}
              </button>
            </>
          ) : (
            <button
              className="button"
              disabled={busy || processingState !== 'READY'}
              onClick={() => mutation.mutate({ action: 'publish' })}
            >
              <Icon name="upload" />
              {translate('Phát hành bài hát')}
            </button>
          )}
          {processingState === 'FAILED' && (
            <>
              <button
                className="button secondary"
                disabled={busy || retryCountdown.seconds > 0}
                onClick={() => {
                  if (!retryCountdown.waiting()) mutation.mutate({ action: 'retry-processing' });
                }}
              >
                <Icon name="refresh" />
                {mutation.isPending && mutation.variables?.action === 'retry-processing'
                  ? translate('Đang gửi yêu cầu…')
                  : retryCountdown.seconds > 0
                    ? translate('Thử lại sau {seconds} giây', { seconds: retryCountdown.seconds })
                    : translate('Thử xử lý lại')}
              </button>
              <span className="sr-only" role="status" aria-live="polite">
                {retryCountdown.seconds > 0
                  ? translate('Đang chờ hết thời gian thử lại.')
                  : translate('Bạn có thể thử xử lý lại.')}
              </span>
            </>
          )}
        </div>
      </section>
      {progress !== null && (
        <div className="surface upload-progress" role="status">
          <span>{translate(uploadStage)}</span>
          <progress max={100} value={progress} />
          <span>{translate('{progress}% byte đã gửi', { progress })}</span>
        </div>
      )}
      <div className="studio-editor-layout">
        <section className="surface studio-editor-main">
          <form
            onSubmit={save}
            onChange={() => setMetadataDirty(true)}
            className="form-stack studio-metadata-form"
          >
            <h2>{translate('Thông tin bài hát')}</h2>
            <label>
              {translate('Tên bài hát')}
              <input name="title" required maxLength={160} disabled={busy} defaultValue={t.title} />
            </label>
            <label>
              {translate('Mô tả')}
              <textarea
                name="description"
                maxLength={4000}
                rows={5}
                disabled={busy}
                defaultValue={t.description}
              />
            </label>
            <GenrePicker
              value={genreDraft ?? t.genres ?? []}
              retainedGenres={t.genres ?? []}
              onChange={(genres) => {
                setGenreDraft(genres);
                setMetadataDirty(true);
              }}
              disabled={busy}
            />
            <label className="checkbox-label">
              <input
                type="checkbox"
                name="downloadEnabled"
                disabled={busy}
                defaultChecked={t.downloadEnabled}
              />
              {translate('Cho phép tải xuống')}
            </label>
            <button className="button" disabled={busy}>
              {pending ? translate('Đang lưu…') : translate('Lưu thông tin')}
            </button>
          </form>
          <StudioLyricsDisclosure>
            <LyricsEditor
              trackId={id}
              duration={processingState === 'READY' ? t.duration : undefined}
              disabled={busy}
            />
          </StudioLyricsDisclosure>
        </section>
        <aside className="surface studio-media-panel">
          <Artwork track={t} large />
          <details className="studio-disclosure studio-technical-disclosure">
            <summary>
              <span>{translate('Thông tin âm thanh')}</span>
              <Icon name="down" size={18} />
            </summary>
            <div className="studio-disclosure-body">
              <dl className="technical">
                <div>
                  <dt>{translate('Định dạng phát')}</dt>
                  <dd>{translate(quality(t))}</dd>
                </div>
                <div>
                  <dt>{translate('Thời lượng')}</dt>
                  <dd>{time(t.duration)}</dd>
                </div>
                <div>
                  <dt>{translate('Tần số lấy mẫu')}</dt>
                  <dd>{t.sampleRate ? `${t.sampleRate / 1000} kHz` : '—'}</dd>
                </div>
                <div>
                  <dt>{translate('Độ sâu bit')}</dt>
                  <dd>{t.bitDepth || '—'}</dd>
                </div>
              </dl>
              <p className="muted small">
                {t.lossyTranscode
                  ? translate('FLAC chuyển từ nguồn lossy; không phục hồi chất lượng.')
                  : translate('Định dạng tệp không chứng nhận lịch sử bản thu gốc.')}
              </p>
            </div>
          </details>
          <details className="studio-disclosure studio-cover-disclosure">
            <summary>
              <span>{translate('Thay ảnh bìa')}</span>
              <Icon name="down" size={18} />
            </summary>
            <form className="form-stack" onSubmit={(e) => void replace(e, true)}>
              <label>
                {translate('Chọn ảnh mới')}
                <input
                  ref={coverInput}
                  type="file"
                  required
                  accept="image/jpeg,image/png,image/webp"
                  disabled={busy || !!coverSession.session}
                />
                <small>{translate('JPEG, PNG hoặc WebP, tối đa 5 MiB.')}</small>
              </label>
              {coverSession.session && (
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy}
                  onClick={() => {
                    setPending(true);
                    void coverSession
                      .cancel()
                      .then(() => {
                        if (coverInput.current) coverInput.current.value = '';
                      })
                      .catch((e) => {
                        setError(e.message);
                        focusErrors();
                      })
                      .finally(() => setPending(false));
                  }}
                >
                  {translate('Chọn ảnh bìa khác')}
                </button>
              )}
              <button className="button secondary" disabled={busy}>
                {translate('Tải ảnh bìa lên')}
              </button>
            </form>
          </details>
          <details className="studio-disclosure studio-audio-disclosure">
            <summary>
              <span>{translate('Thay tệp âm thanh')}</span>
              <Icon name="down" size={18} />
            </summary>
            <form className="form-stack" onSubmit={(e) => void replace(e, false)}>
              <p className="muted">
                {translate(
                  'Gỡ phát hành trước khi thay tệp. Phiên bản nguồn mới sẽ được kiểm tra và xử lý lại.',
                )}
              </p>
              <label>
                {translate('Chọn âm thanh mới')}
                <input type="file" required accept=".wav,.flac,.mp3" disabled={busy || published} />
              </label>
              <button className="button secondary" disabled={busy || published}>
                <Icon name="upload" />
                {translate('Thay âm thanh')}
              </button>
            </form>
          </details>
          <footer className="studio-delete-footer">
            <StudioConfirmDelete
              key={user?.id}
              title={t.title}
              disabled={busy}
              onConfirm={deleteTrack}
            />
          </footer>
        </aside>
      </div>
    </div>
  );
}
