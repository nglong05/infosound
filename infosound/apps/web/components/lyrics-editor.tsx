'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import {
  formatLyricTime,
  LyricsParseError,
  MAX_LYRICS_BYTES,
  parseLrc,
  serializeLrc,
  type TrackLyricsResponse,
} from '@/lib/lyrics';
import { useI18n } from './locale-provider';
import { useToast } from './providers';
import { useErrorSummaryFocus } from './auth-form-fields';

type Draft = { text: string; sourceVersion: number };
type PendingAction = 'import' | 'save' | 'delete' | 'reload' | null;

export function LyricsEditor({
  trackId,
  duration,
  disabled = false,
}: {
  trackId: string;
  duration?: number;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['track-lyrics', trackId],
    queryFn: ({ signal }) => api<TrackLyricsResponse>(`/tracks/${trackId}/lyrics`, { signal }),
  });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pending, setPending] = useState<PendingAction>(null);
  const [error, setError] = useState<Error | null>(null);
  const [conflict, setConflict] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const mounted = useRef(false),
    inFlight = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const { summary, focusErrors } = useErrorSummaryFocus();
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const text = draft?.text ?? serializeLrc(query.data?.lyrics?.lines ?? []);
  const changed = draft !== null;
  const versionChanged =
    !!draft && !!query.data && draft.sourceVersion !== query.data.sourceVersion;
  const blocked = disabled || pending !== null;
  const parsed = useMemo(() => {
    if (!text.trim()) return { document: null, error: null };
    try {
      return { document: parseLrc(text), error: null };
    } catch (reason) {
      return {
        document: null,
        error:
          reason instanceof Error ? reason : new Error('Mốc thời gian lời bài hát chưa hợp lệ.'),
      };
    }
  }, [text]);
  const fail = (reason: unknown) => {
    if (!mounted.current) return;
    const value =
      reason instanceof Error ? reason : new Error('Không thể hoàn tất yêu cầu. Vui lòng thử lại.');
    if (reason instanceof ApiError && reason.code === 'SOURCE_VERSION_CHANGED') setConflict(true);
    setError(
      reason instanceof ApiError && reason.code === 'LYRICS_TIMING_INVALID'
        ? new Error('Mốc lời vượt quá thời lượng bài hát.')
        : value,
    );
    focusErrors();
  };
  const begin = (action: Exclude<PendingAction, null>) => {
    if (inFlight.current || disabled || !query.data) return false;
    inFlight.current = true;
    setPending(action);
    setError(null);
    return true;
  };
  const finish = () => {
    inFlight.current = false;
    if (mounted.current) setPending(null);
  };
  const edit = (value: string) => {
    if (!query.data) return;
    const sourceVersion = query.data.sourceVersion;
    setDraft((previous) => ({
      text: value,
      sourceVersion: previous?.sourceVersion ?? sourceVersion,
    }));
    setConfirmDelete(false);
    setError(null);
  };
  const importFile = async (file: File) => {
    if (!begin('import')) return;
    const sourceVersion = draft?.sourceVersion ?? query.data!.sourceVersion;
    try {
      if (!/\.lrc$/i.test(file.name)) throw new Error('Chọn tệp lời bài hát có phần mở rộng .lrc.');
      if (file.size > MAX_LYRICS_BYTES)
        throw new LyricsParseError('Dữ liệu lời bài hát vượt giới hạn 64 KiB.');
      let value: string;
      try {
        value = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
      } catch {
        throw new Error('Tệp LRC phải sử dụng mã hóa UTF-8.');
      }
      if (!mounted.current) return;
      // Import is a local draft. Invalid timestamps remain editable and never save automatically.
      setDraft({ text: value, sourceVersion });
      setConfirmDelete(false);
      parseLrc(value);
    } catch (reason) {
      fail(reason);
    } finally {
      finish();
      if (fileInput.current) fileInput.current.value = '';
    }
  };
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!begin('save')) return;
    try {
      if (conflict || versionChanged)
        throw new Error('Âm thanh đã thay đổi. Hãy kiểm tra lại mốc lời cho phiên bản mới.');
      const document = parseLrc(text);
      if (
        typeof duration === 'number' &&
        Number.isFinite(duration) &&
        duration > 0 &&
        document.lines.at(-1)!.startMs > Math.ceil(duration * 1000)
      )
        throw new Error('Mốc lời vượt quá thời lượng bài hát.');
      const body = {
        ...document,
        sourceVersion: draft?.sourceVersion ?? query.data!.sourceVersion,
      };
      if (new TextEncoder().encode(JSON.stringify(body)).byteLength > MAX_LYRICS_BYTES)
        throw new Error('Dữ liệu lời bài hát vượt giới hạn 64 KiB.');
      const saved = await api<TrackLyricsResponse>(`/studio/tracks/${trackId}/lyrics`, {
        method: 'PUT',
        body,
      });
      if (!mounted.current) return;
      await queryClient.cancelQueries({ queryKey: ['track-lyrics', trackId], exact: true });
      if (!mounted.current) return;
      queryClient.setQueryData(['track-lyrics', trackId], saved);
      setDraft(null);
      setConflict(false);
      setError(null);
      setConfirmDelete(false);
      void queryClient.invalidateQueries({ queryKey: ['track-lyrics', trackId], exact: true });
      toast('Đã lưu lời bài hát.');
    } catch (reason) {
      fail(reason);
    } finally {
      finish();
    }
  };
  const remove = async () => {
    if (!confirmDelete || !begin('delete')) return;
    try {
      const saved = await api<TrackLyricsResponse>(`/studio/tracks/${trackId}/lyrics`, {
        method: 'DELETE',
      });
      if (!mounted.current) return;
      await queryClient.cancelQueries({ queryKey: ['track-lyrics', trackId], exact: true });
      if (!mounted.current) return;
      queryClient.setQueryData(['track-lyrics', trackId], saved);
      setDraft(null);
      setConflict(false);
      setError(null);
      setConfirmDelete(false);
      void queryClient.invalidateQueries({ queryKey: ['track-lyrics', trackId], exact: true });
      toast('Đã xóa lời bài hát.');
    } catch (reason) {
      fail(reason);
    } finally {
      finish();
    }
  };
  const rebase = async () => {
    if (inFlight.current || disabled) return;
    inFlight.current = true;
    setPending('reload');
    try {
      const result = await query.refetch();
      if (result.isError) throw result.error;
      if (mounted.current && result.data) {
        const sourceVersion = result.data.sourceVersion;
        setDraft((previous) => (previous ? { ...previous, sourceVersion } : null));
        setConflict(false);
        setError(null);
      }
    } catch (reason) {
      fail(reason);
    } finally {
      finish();
    }
  };
  const preview = parsed.document?.lines.slice(0, 8) ?? [];
  return (
    <section className="surface lyrics-editor" aria-labelledby="lyrics-editor-title">
      <div className="lyrics-editor-heading">
        <div>
          <h2 id="lyrics-editor-title">{t('Lời bài hát đồng bộ')}</h2>
          <p className="muted">
            {t(
              'Nhập lời có mốc thời gian hoặc tải tệp LRC để người nghe theo dõi và tua theo từng dòng.',
            )}
          </p>
        </div>
        {changed && <span className="badge">{t('Bạn có thay đổi chưa lưu.')}</span>}
      </div>
      {query.isPending ? (
        <p className="muted" role="status">
          {t('Đang tải lời bài hát…')}
        </p>
      ) : (
        <>
          {query.isError && (
            <div className="form-error" role="alert">
              <p>{t('Chưa thể tải lời bài hát. Vui lòng thử lại.')}</p>
              <button
                type="button"
                className="button secondary small"
                disabled={blocked || query.isFetching}
                onClick={() => void query.refetch()}
              >
                {t('Thử lại')}
              </button>
            </div>
          )}
          {!!query.data && (
            <form className="form-stack" onSubmit={(event) => void save(event)}>
              {error && (
                <div className="form-error" role="alert" tabIndex={-1} ref={summary}>
                  {t(error.message)}
                  {error instanceof LyricsParseError && error.sourceLine && (
                    <p>{t('Lỗi ở dòng {line}.', { line: error.sourceLine })}</p>
                  )}
                </div>
              )}
              {(conflict || versionChanged) && (
                <div className="lyrics-version-warning" role="alert">
                  <p>{t('Âm thanh đã thay đổi. Hãy kiểm tra lại mốc lời cho phiên bản mới.')}</p>
                  <button
                    type="button"
                    className="button secondary small"
                    disabled={blocked || query.isFetching}
                    onClick={() => void rebase()}
                  >
                    {t('Áp dụng bản nháp cho âm thanh mới')}
                  </button>
                </div>
              )}
              <label htmlFor="lyrics-file">
                {t('Tải tệp LRC')}
                <input
                  ref={fileInput}
                  id="lyrics-file"
                  type="file"
                  accept=".lrc,text/plain"
                  disabled={blocked}
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    if (file) void importFile(file);
                  }}
                />
                <small>{t('Chọn tệp .lrc UTF-8, tối đa 64 KiB.')}</small>
              </label>
              <label htmlFor="lyrics-text">
                {t('Lời và mốc thời gian')}
                <textarea
                  id="lyrics-text"
                  rows={9}
                  dir="auto"
                  spellCheck={false}
                  value={text}
                  maxLength={MAX_LYRICS_BYTES}
                  disabled={blocked}
                  aria-invalid={changed && !!parsed.error}
                  aria-describedby="lyrics-format-help"
                  placeholder="[00:12.500] …"
                  onChange={(event) => edit(event.target.value)}
                />
                <small id="lyrics-format-help">
                  {t(
                    'Mỗi dòng dùng dạng {timestamp} kèm lời. Dòng trống có mốc đánh dấu đoạn không lời.',
                    { timestamp: '[00:12.500]' },
                  )}
                </small>
              </label>
              {parsed.error && changed && !error && (
                <p className="muted small">
                  {t(parsed.error.message)}
                  {parsed.error instanceof LyricsParseError && parsed.error.sourceLine && (
                    <> {t('Lỗi ở dòng {line}.', { line: parsed.error.sourceLine })}</>
                  )}
                </p>
              )}
              {!!preview.length && (
                <div className="lyrics-editor-preview">
                  <h3>{t('Xem trước {count} dòng đầu', { count: preview.length })}</h3>
                  <ol>
                    {preview.map((line) => (
                      <li key={line.startMs}>
                        <span dir="ltr">{formatLyricTime(line.startMs)}</span>
                        <bdi>{line.text || t('Đoạn không lời')}</bdi>
                      </li>
                    ))}
                  </ol>
                  <p className="muted small">
                    {t('{count} dòng có mốc thời gian', { count: parsed.document!.lines.length })}
                  </p>
                </div>
              )}
              <div className="action-row">
                <button
                  type="submit"
                  className="button"
                  disabled={
                    blocked ||
                    !changed ||
                    !!parsed.error ||
                    !parsed.document ||
                    conflict ||
                    versionChanged
                  }
                >
                  {pending === 'save' ? t('Đang lưu…') : t('Lưu lời bài hát')}
                </button>
                {query.data.lyrics && (
                  <button
                    type="button"
                    className="button secondary"
                    disabled={blocked}
                    onClick={() => setConfirmDelete(true)}
                  >
                    {t('Xóa lời bài hát')}
                  </button>
                )}
                {(pending === 'import' || pending === 'reload') && (
                  <span className="muted small" role="status">
                    {pending === 'import' ? t('Đang đọc tệp…') : t('Đang tải…')}
                  </span>
                )}
              </div>
            </form>
          )}
          {confirmDelete && (
            <div
              className="lyrics-delete-confirm"
              role="group"
              aria-labelledby="lyrics-delete-title"
            >
              <p id="lyrics-delete-title">{t('Xóa toàn bộ lời đã lưu của bài hát này?')}</p>
              <div className="action-row">
                <button
                  type="button"
                  className="button danger"
                  disabled={blocked}
                  onClick={() => void remove()}
                >
                  {t('Xóa lời bài hát')}
                </button>
                <button
                  type="button"
                  className="button secondary"
                  disabled={blocked}
                  onClick={() => setConfirmDelete(false)}
                >
                  {t('Hủy')}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
