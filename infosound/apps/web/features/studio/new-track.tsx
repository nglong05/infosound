'use client';
import { useI18n } from '@/components/locale-provider';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useAppRouter as useRouter } from '@/components/app-navigation';
import { NavigationAction } from '@/components/navigation-action';
import { useQueryClient } from '@tanstack/react-query';
import { api, uploadFile, type Track, type Genre, ApiError } from '@/lib/api';
import {
  LyricsParseError,
  MAX_LYRICS_BYTES,
  parseLrc,
  type LyricsDocument,
  type TrackLyricsResponse,
} from '@/lib/lyrics';
import { useAuth, useToast } from '@/components/providers';
import { Icon } from '@/components/icons';
import { GenrePicker } from '@/components/genre-picker';
import { useErrorSummaryFocus } from '@/components/auth-form-fields';
import { PageTitle, Loading } from '@/components/common';
import { useArtworkSession, type Upload } from '@/features/studio/artwork-session';

export function NewTrack() {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  return user?.role === 'AUTHOR' ? <NewTrackUpload key={user.id} ownerId={user.id} /> : null;
}

function NewTrackUpload({ ownerId }: { ownerId: string }) {
  const { t: translate } = useI18n(),
    { user } = useAuth();
  const coverSession = useArtworkSession(),
    coverInput = useRef<HTMLInputElement>(null),
    lyricsInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null),
    [cover, setCover] = useState<File | null>(null),
    [lyricsFile, setLyricsFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(0),
    [stage, setStage] = useState('');
  const [error, setError] = useState<Error | null>(null),
    [draftId, setDraftId] = useState(''),
    [genres, setGenres] = useState<Genre[]>([]);
  const { summary, focusErrors } = useErrorSummaryFocus();
  const uploadRef = useRef<Upload | null>(null),
    key = useRef<string | null>(null);
  const phases = useRef({
    audioUploaded: false,
    audioCompleted: false,
    coverCommitted: null as File | null,
    lyricsCommitted: null as File | null,
  });
  const mounted = useRef(true),
    inFlight = useRef(false),
    finished = useRef(false),
    request = useRef<AbortController | null>(null),
    currentOwner = useRef(user?.id);
  currentOwner.current = user?.id;
  const router = useRouter(),
    queryClient = useQueryClient(),
    toast = useToast();
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current?.abort();
    };
  }, []);
  const active = (signal: AbortSignal) =>
    mounted.current && currentOwner.current === ownerId && !signal.aborted;
  const ensureActive = (signal: AbortSignal) => {
    if (!active(signal)) throw new DOMException('Aborted', 'AbortError');
  };
  const fail = (reason: unknown) => {
    setError(
      reason instanceof ApiError && reason.code === 'LYRICS_TIMING_INVALID'
        ? new Error('Mốc lời vượt quá thời lượng bài hát.')
        : reason instanceof Error
          ? reason
          : new Error('Không thể hoàn tất yêu cầu. Kiểm tra thông tin và thử lại.'),
    );
    focusErrors();
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (inFlight.current || finished.current) return;
    const form = new FormData(event.currentTarget),
      controller = new AbortController(),
      signal = controller.signal;
    request.current = controller;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      if (!file) throw new Error('Chọn một tệp âm thanh để tiếp tục.');
      if (file.size > 256 * 1024 * 1024)
        throw new Error('Tệp vượt giới hạn 256 MiB. Hãy chọn tệp nhỏ hơn.');
      if (!/\.(wav|flac|mp3)$/i.test(file.name))
        throw new Error('Chỉ hỗ trợ tệp MP3, FLAC hoặc WAV.');
      if (
        cover &&
        (!['image/jpeg', 'image/png', 'image/webp'].includes(cover.type) ||
          cover.size > 5 * 1024 * 1024)
      )
        throw new Error('Ảnh bìa phải là JPEG, PNG hoặc WebP, tối đa 5 MiB.');
      // Parse optional local lyrics before any draft or object upload is created.
      let lyrics: LyricsDocument | null = null;
      if (lyricsFile) {
        setStage('Đang đọc tệp…');
        if (!/\.lrc$/i.test(lyricsFile.name))
          throw new Error('Chọn tệp lời bài hát có phần mở rộng .lrc.');
        if (lyricsFile.size > MAX_LYRICS_BYTES)
          throw new LyricsParseError('Dữ liệu lời bài hát vượt giới hạn 64 KiB.');
        let text: string;
        try {
          text = new TextDecoder('utf-8', { fatal: true }).decode(await lyricsFile.arrayBuffer());
        } catch {
          throw new Error('Tệp LRC phải sử dụng mã hóa UTF-8.');
        }
        ensureActive(signal);
        lyrics = parseLrc(text);
        if (
          new TextEncoder().encode(JSON.stringify({ ...lyrics, sourceVersion: 1 })).byteLength >
          MAX_LYRICS_BYTES
        )
          throw new LyricsParseError('Dữ liệu lời bài hát vượt giới hạn 64 KiB.');
      }
      ensureActive(signal);
      if (!uploadRef.current) {
        setStage('Khởi tạo phiên tải lên');
        key.current ??= crypto.randomUUID();
        const init = await api<Upload>('/tracks/uploads', {
          method: 'POST',
          signal,
          body: {
            title: form.get('title'),
            description: form.get('description'),
            genreIds: genres.map((genre) => genre.id),
            downloadEnabled: form.get('downloadEnabled') === 'on',
            filename: file.name,
            contentType: file.type || 'application/octet-stream',
            size: file.size,
            idempotencyKey: key.current,
          },
        });
        ensureActive(signal);
        uploadRef.current = init;
        setDraftId(init.trackId);
      }
      const init = uploadRef.current;
      const onProgress = (value: number) => {
        if (active(signal)) setProgress(value);
      };
      if (!phases.current.audioUploaded) {
        setProgress(0);
        setStage('Đang tải âm thanh lên');
        await uploadFile(init.url, file, init.headers, onProgress);
        ensureActive(signal);
        phases.current.audioUploaded = true;
      }
      if (!phases.current.audioCompleted) {
        setStage('Đang chốt tệp và tạo công việc xử lý');
        await api('/uploads/' + init.uploadId + '/complete', { method: 'POST', body: {}, signal });
        ensureActive(signal);
        phases.current.audioCompleted = true;
      }
      if (cover && phases.current.coverCommitted !== cover) {
        setProgress(0);
        setStage('Đang tải và kiểm tra ảnh bìa');
        await coverSession.upload(init.trackId, cover, onProgress, {
          signal,
          isActive: () => active(signal),
        });
        ensureActive(signal);
        phases.current.coverCommitted = cover;
      }
      if (lyricsFile && lyrics && phases.current.lyricsCommitted !== lyricsFile) {
        setStage('Đang lưu…');
        // A new upload starts at source1. Never silently rebase lyrics after another tab replaces audio.
        const track = await api<Track>('/studio/tracks/' + init.trackId, { signal });
        ensureActive(signal);
        if (track.id !== init.trackId || track.authorId !== ownerId || track.sourceVersion !== 1)
          throw new Error('Âm thanh đã thay đổi. Hãy kiểm tra lại mốc lời cho phiên bản mới.');
        if (
          track.processingState === 'READY' &&
          typeof track.duration === 'number' &&
          Number.isFinite(track.duration) &&
          lyrics.lines.at(-1)!.startMs > Math.ceil(track.duration * 1000)
        )
          throw new Error('Mốc lời vượt quá thời lượng bài hát.');
        const saved = await api<TrackLyricsResponse>('/studio/tracks/' + init.trackId + '/lyrics', {
          method: 'PUT',
          body: { ...lyrics, sourceVersion: 1 },
          signal,
        });
        ensureActive(signal);
        phases.current.lyricsCommitted = lyricsFile;
        queryClient.setQueryData(['track-lyrics', init.trackId], saved);
      }
      ensureActive(signal);
      finished.current = true;
      void queryClient.invalidateQueries();
      toast('Tệp đã tải xong. Công việc xử lý đã được tạo.');
      router.push('/studio/tracks/' + init.trackId);
    } catch (reason) {
      if (active(signal)) {
        finished.current = false;
        setStage('');
        fail(reason);
      }
    } finally {
      if (request.current === controller) request.current = null;
      inFlight.current = false;
      if (active(signal)) setBusy(false);
    }
  };
  const cancelCover = async () => {
    if (inFlight.current) return;
    const controller = new AbortController(),
      signal = controller.signal;
    request.current = controller;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await coverSession.cancel({ signal, isActive: () => active(signal) });
      ensureActive(signal);
      phases.current.coverCommitted = null;
      setCover(null);
      if (coverInput.current) coverInput.current.value = '';
    } catch (reason) {
      if (active(signal)) fail(reason);
    } finally {
      if (request.current === controller) request.current = null;
      inFlight.current = false;
      if (active(signal)) setBusy(false);
    }
  };
  return (
    <div className="studio-page studio-create-page">
      <NavigationAction className="back-link" href="/studio" previous>
        {translate('← Quay lại Studio')}
      </NavigationAction>
      <PageTitle
        eyebrow={translate('AUTHOR STUDIO / TẢI LÊN')}
        title={translate('Giai điệu tiếp theo bắt đầu ở đây.')}
        description={translate(
          'Chia sẻ bản thu của bạn. Hoàn tất xử lý, sau đó chọn thời điểm phát hành.',
        )}
      />
      <div className="upload-layout">
        <form className="surface form-stack" onSubmit={(event) => void submit(event)}>
          {error && (
            <div className="form-error" role="alert" tabIndex={-1} ref={summary}>
              {translate(error.message)}
              {error instanceof LyricsParseError && error.sourceLine && (
                <p>{translate('Lỗi ở dòng {line}.', { line: error.sourceLine })}</p>
              )}
              {draftId && (
                <p>
                  {translate('Bản nháp đã được tạo. Bạn có thể thử gửi lại hoặc')}{' '}
                  <NavigationAction href={'/studio/tracks/' + draftId}>
                    {translate('mở bài hát trong Studio')}
                  </NavigationAction>
                  .
                </p>
              )}
            </div>
          )}
          <label className={'file-drop studio-audio-picker ' + (file ? 'has-file' : '')}>
            <strong dir="auto">{file?.name || translate('Chọn tệp âm thanh của bạn')}</strong>
            <input
              id="new-track-audio"
              name="audio"
              type="file"
              accept=".mp3,.flac,.wav,audio/mpeg,audio/flac,audio/wav"
              aria-label={translate('Chọn tệp âm thanh của bạn')}
              required
              disabled={busy || !!draftId}
              onChange={(event) => {
                setFile(event.target.files?.[0] || null);
                key.current = null;
                uploadRef.current = null;
                phases.current = {
                  audioUploaded: false,
                  audioCompleted: false,
                  coverCommitted: null,
                  lyricsCommitted: null,
                };
                setError(null);
                setStage('');
                setProgress(0);
              }}
            />
          </label>
          <label>
            {translate('Tên bài hát')}
            <input
              name="title"
              required
              minLength={1}
              maxLength={160}
              disabled={busy || !!draftId}
              placeholder={translate('Đặt tên cho giai điệu của bạn')}
            />
          </label>
          <label>
            {translate('Mô tả')}
            <textarea
              name="description"
              rows={4}
              maxLength={4000}
              disabled={busy || !!draftId}
              placeholder={translate('Câu chuyện phía sau bản thu này…')}
            />
          </label>
          <GenrePicker value={genres} onChange={setGenres} disabled={busy || !!draftId} />
          <label>
            {translate('Ảnh bìa (tùy chọn)')}
            <input
              ref={coverInput}
              name="cover"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={busy || !!coverSession.session}
              onChange={(event) => {
                setCover(event.target.files?.[0] || null);
                phases.current.coverCommitted = null;
              }}
            />
            <small>
              {translate('JPEG, PNG hoặc WebP · Tối đa 5 MiB. Ảnh được kiểm tra và xóa metadata.')}
            </small>
          </label>
          {coverSession.session && (
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() => void cancelCover()}
            >
              {translate('Chọn ảnh bìa khác')}
            </button>
          )}
          <label htmlFor="new-track-lyrics">
            {translate('Tải tệp LRC')}
            <input
              ref={lyricsInput}
              id="new-track-lyrics"
              name="lyrics"
              type="file"
              accept=".lrc,text/plain"
              disabled={busy}
              onChange={(event) => {
                setLyricsFile(event.target.files?.[0] || null);
                phases.current.lyricsCommitted = null;
                setError(null);
              }}
            />
            <small>{translate('Chọn tệp .lrc UTF-8, tối đa 64 KiB.')}</small>
          </label>
          {lyricsFile && (
            <button
              id="new-track-lyrics-clear"
              type="button"
              className="button secondary small"
              aria-label={translate('Hủy') + ' — ' + translate('Tải tệp LRC')}
              disabled={busy}
              onClick={() => {
                if (inFlight.current) return;
                setLyricsFile(null);
                phases.current.lyricsCommitted = null;
                if (lyricsInput.current) lyricsInput.current.value = '';
                setError(null);
                setStage('');
              }}
            >
              {translate('Hủy')}
            </button>
          )}
          <label className="checkbox-label">
            <input type="checkbox" name="downloadEnabled" disabled={busy || !!draftId} />
            {translate('Cho phép người nghe tải bài hát')}
          </label>
          {stage && (
            <div className="upload-progress" role="status">
              <span>{translate(stage)}</span>
              <progress
                max={100}
                value={stage.includes('Đang tải') ? progress : undefined}
                aria-label={translate(stage)}
              />
              {stage.includes('Đang tải') ? (
                <small>{translate('{progress}% byte đã gửi', { progress })}</small>
              ) : (
                !['Đang đọc tệp…', 'Đang lưu…'].includes(stage) && (
                  <small>
                    {translate(
                      'Tiến trình xử lý sẽ hiển thị ở trang bài hát. Không phải phần trăm xử lý âm thanh.',
                    )}
                  </small>
                )
              )}
            </div>
          )}
          <button className="button" disabled={busy}>
            {busy
              ? translate('Đang thực hiện…')
              : draftId
                ? translate('Thử gửi lại')
                : translate('Tải lên & bắt đầu xử lý')}
            <Icon name="upload" />
          </button>
        </form>
        <aside>
          <section className="upload-rules">
            <h3>{translate('Phát hành theo ý bạn')}</h3>
            <p>
              {translate(
                'Tải lên không tự động công khai. Khi tệp sẵn sàng, bạn có thể kiểm tra thông tin, chỉnh sửa và nhấn Phát hành.',
              )}
            </p>
            <h3>{translate('Ảnh bìa của riêng bạn')}</h3>
            <p>
              {translate(
                'Không có ảnh? InfoSound sẽ dùng hình đồ họa mặc định cho đến khi bạn thêm ảnh bìa.',
              )}
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}
