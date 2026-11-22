'use client';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { api, type Artist, type Genre, type List } from '@/lib/api';
import { getLanguage } from '@/lib/languages';
import type { MusicChoices } from '@/lib/music-preferences';
import { useI18n } from './locale-provider';
import { usePlayer } from './providers';
import { ErrorState, Loading } from './common';
import { Icon } from './icons';
import { lockBodyScroll } from '@/lib/body-scroll-lock';

const normalize = (value: string) =>
  value.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd').trim();
export function MusicPreferenceSurvey({
  initial,
  initialSurvey,
  visitor = false,
  onSave,
  onClose,
}: {
  initial: MusicChoices;
  initialSurvey: boolean;
  visitor?: boolean;
  manual?: boolean;
  onSave: (value: MusicChoices) => Promise<void>;
  onClose: () => void;
}) {
  const { t: tr, locale } = useI18n();
  const { lyricsOpen } = usePlayer();
  const id = useId(),
    dialog = useRef<HTMLDialogElement>(null),
    title = useRef<HTMLHeadingElement>(null),
    errorRef = useRef<HTMLParagraphElement>(null),
    alive = useRef(true),
    submitting = useRef(false);
  const [genreIds, setGenreIds] = useState(() => [...initial.genreIds]);
  const [artistIds, setArtistIds] = useState(() => [...initial.artistIds]);
  const [genreSearch, setGenreSearch] = useState(''),
    [artistSearch, setArtistSearch] = useState('');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const genres = useQuery({
    queryKey: ['genres'],
    queryFn: ({ signal }) => api<{ items: Genre[] }>('/genres', { auth: false, signal }),
    staleTime: 300000,
  });
  const artists = useInfiniteQuery({
    queryKey: ['music-preference-artists'],
    initialPageParam: 1,
    queryFn: ({ signal, pageParam }) =>
      api<List<Artist>>(`/artists?page=${pageParam}&pageSize=100`, { auth: false, signal }),
    getNextPageParam: (page) =>
      page.page * page.pageSize < page.total && page.page < 10000 ? page.page + 1 : undefined,
    staleTime: 300000,
  });
  const allArtists = [
    ...new Map(
      (artists.data?.pages.flatMap((page) => page.items) ?? []).map((artist) => [
        artist.id,
        artist,
      ]),
    ).values(),
  ];
  const formatter = new Intl.NumberFormat(getLanguage(locale).tag);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    // Main is hidden behind lyrics. An invisible showModal() would still make the page inert.
    if (lyricsOpen) return;
    const element = dialog.current;
    if (!element?.isConnected) return;
    let unlock: (() => void) | undefined;
    const tryOpen = () => {
      if (element.open || !element.isConnected) return;
      const other = [
        ...document.querySelectorAll<HTMLElement>(
          'dialog[open],[role="dialog"],[role="alertdialog"]',
        ),
      ].some(
        (item) => item !== element && !item.closest('[hidden]') && item.getClientRects().length > 0,
      );
      if (other) return;
      element.showModal();
      unlock = lockBodyScroll();
      title.current?.focus({ preventScroll: true });
    };
    tryOpen();
    const observer = new MutationObserver(tryOpen);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['open', 'hidden', 'class', 'style'],
    });
    return () => {
      observer.disconnect();
      if (element.open) element.close();
      unlock?.();
    };
  }, [lyricsOpen]);
  const close = () => {
    if (!submitting.current) onClose();
  };
  const focusError = () =>
    requestAnimationFrame(() => {
      errorRef.current?.focus({ preventScroll: true });
      errorRef.current?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    });
  const toggle = (selected: string[], value: string, set: (value: string[]) => void) => {
    set(
      selected.includes(value)
        ? selected.filter((id) => id !== value)
        : selected.length < 50
          ? [...selected, value]
          : selected,
    );
    setError(null);
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting.current) return;
    if (initialSurvey && !genreIds.length && !artistIds.length) {
      setError('Chọn ít nhất một thể loại hoặc nghệ sĩ.');
      focusError();
      return;
    }
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      await onSave({ genreIds: [...genreIds].sort(), artistIds: [...artistIds].sort() });
    } catch (reason) {
      if (alive.current) {
        setError(
          reason instanceof Error
            ? reason.message
            : 'Không thể hoàn tất yêu cầu. Kiểm tra thông tin và thử lại.',
        );
        focusError();
      }
    } finally {
      submitting.current = false;
      if (alive.current) setBusy(false);
    }
  };
  return (
    <dialog
      ref={dialog}
      className="music-survey-dialog"
      aria-modal="true"
      aria-labelledby={id + '-title'}
      aria-describedby={id + '-description'}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') event.stopPropagation();
      }}
    >
      <form
        className="music-survey surface"
        aria-labelledby={id + '-title'}
        aria-describedby={id + '-description'}
        onSubmit={(event) => void submit(event)}
      >
        <div className="music-survey-heading">
          <div>
            <span className="eyebrow">{tr('Tùy chọn âm nhạc')}</span>
            <h3 ref={title} tabIndex={-1} id={id + '-title'}>
              {tr('Chọn âm nhạc dành cho bạn')}
            </h3>
            <p className="muted" id={id + '-description'}>
              {tr('Chọn thể loại và nghệ sĩ yêu thích để nhận gợi ý phù hợp. Bạn có thể bỏ qua.')}
            </p>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label={tr('Đóng khảo sát')}
            disabled={busy}
            onClick={close}
          >
            <Icon name="close" />
          </button>
        </div>
        <div className="music-survey-body">
          <div className="music-survey-columns">
            <fieldset disabled={busy}>
              <legend>{tr('Thể loại yêu thích')}</legend>
              <label className="music-survey-search" htmlFor={id + '-genres'}>
                {tr('Tìm thể loại')}
                <input
                  id={id + '-genres'}
                  type="search"
                  value={genreSearch}
                  onChange={(event) => setGenreSearch(event.target.value)}
                  autoComplete="off"
                />
              </label>
              {genres.isPending ? (
                <Loading />
              ) : genres.isError ? (
                <ErrorState error={genres.error} retry={() => void genres.refetch()} />
              ) : (
                <div className="music-survey-options">
                  {genres.data.items
                    .filter((item) =>
                      normalize(item.name + ' ' + (item.aliases ?? []).join(' ')).includes(
                        normalize(genreSearch),
                      ),
                    )
                    .map((item) => (
                      <label className="music-survey-choice" key={item.id}>
                        <input
                          type="checkbox"
                          name="genreIds"
                          value={item.id}
                          checked={genreIds.includes(item.id)}
                          disabled={!genreIds.includes(item.id) && genreIds.length >= 50}
                          onChange={() => toggle(genreIds, item.id, setGenreIds)}
                        />
                        <span>{item.name}</span>
                      </label>
                    ))}
                  {!genres.data.items.some((item) =>
                    normalize(item.name + ' ' + (item.aliases ?? []).join(' ')).includes(
                      normalize(genreSearch),
                    ),
                  ) && <p className="muted">{tr('Không có lựa chọn phù hợp.')}</p>}
                </div>
              )}
            </fieldset>
            <fieldset disabled={busy}>
              <legend>{tr('Nghệ sĩ yêu thích')}</legend>
              <label className="music-survey-search" htmlFor={id + '-artists'}>
                {tr('Tìm nghệ sĩ trong danh sách đã tải')}
                <input
                  id={id + '-artists'}
                  type="search"
                  value={artistSearch}
                  onChange={(event) => setArtistSearch(event.target.value)}
                  autoComplete="off"
                />
              </label>
              {artists.isPending ? (
                <Loading />
              ) : artists.isError && !artists.data ? (
                <ErrorState error={artists.error} retry={() => void artists.refetch()} />
              ) : (
                <>
                  <div className="music-survey-options">
                    {allArtists
                      .filter((item) =>
                        normalize(item.displayName).includes(normalize(artistSearch)),
                      )
                      .map((item) => (
                        <label className="music-survey-choice" key={item.id}>
                          <input
                            type="checkbox"
                            name="artistIds"
                            value={item.id}
                            checked={artistIds.includes(item.id)}
                            disabled={!artistIds.includes(item.id) && artistIds.length >= 50}
                            onChange={() => toggle(artistIds, item.id, setArtistIds)}
                          />
                          <span>{item.displayName}</span>
                        </label>
                      ))}
                    {!allArtists.some((item) =>
                      normalize(item.displayName).includes(normalize(artistSearch)),
                    ) && <p className="muted">{tr('Không có lựa chọn phù hợp.')}</p>}
                  </div>
                  <p className="small muted">
                    {tr('Đã tải {loaded} / {total} nghệ sĩ.', {
                      loaded: formatter.format(allArtists.length),
                      total: formatter.format(artists.data?.pages[0]?.total ?? 0),
                    })}
                  </p>
                  {artists.isFetchNextPageError && (
                    <ErrorState error={artists.error} retry={() => void artists.fetchNextPage()} />
                  )}{' '}
                  {artists.hasNextPage && (
                    <button
                      className="button secondary small"
                      type="button"
                      disabled={artists.isFetchingNextPage}
                      onClick={() => void artists.fetchNextPage()}
                    >
                      {tr(artists.isFetchingNextPage ? 'Đang tải…' : 'Tải thêm nghệ sĩ')}
                    </button>
                  )}
                </>
              )}
            </fieldset>
          </div>
          <div className="music-survey-summary">
            <p className="muted" role="status">
              {tr('Đã chọn {genres} thể loại và {artists} nghệ sĩ.', {
                genres: formatter.format(genreIds.length),
                artists: formatter.format(artistIds.length),
              })}
            </p>
            <button
              type="button"
              className="text-action"
              disabled={busy || (!genreIds.length && !artistIds.length)}
              onClick={() => {
                setGenreIds([]);
                setArtistIds([]);
                setError(null);
              }}
            >
              {tr('Xóa lựa chọn')}
            </button>
          </div>
          <p className="muted small">
            {tr('Mỗi nhóm có thể chọn tối đa {count} mục.', { count: formatter.format(50) })}
          </p>
          {visitor && (
            <p className="muted small">
              {tr('Sở thích của khách chỉ được lưu trên trình duyệt này.')}
            </p>
          )}
          {error && (
            <p ref={errorRef} tabIndex={-1} className="music-survey-error" role="alert">
              {tr(error)}
            </p>
          )}
        </div>
        <div className="action-row music-survey-actions">
          <button className="button" type="submit" disabled={busy}>
            {tr(busy ? 'Đang lưu…' : 'Lưu sở thích')}
            <Icon name="arrow" size={18} />
          </button>
          <button className="button secondary" type="button" disabled={busy} onClick={close}>
            {tr(initialSurvey ? 'Bỏ qua khảo sát' : 'Hủy thay đổi')}
          </button>
        </div>
      </form>
    </dialog>
  );
}
