'use client';
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type Genre } from '@/lib/api';
import { matchesGenreSearch } from '@/lib/genre-search';
import { useI18n } from './locale-provider';
import { Icon } from './icons';

type GenrePickerProps = {
  value: readonly Genre[];
  onChange: (genres: Genre[]) => void;
  retainedGenres?: readonly Genre[];
  disabled?: boolean;
  max?: number;
};
const noRetainedGenres: readonly Genre[] = [];

/** Catalogue IDs are submitted by the parent; search text never becomes a tag. */
export function GenrePicker({
  value,
  onChange,
  retainedGenres = noRetainedGenres,
  disabled = false,
  max = 8,
}: GenrePickerProps) {
  const { t } = useI18n();
  const catalog = useQuery({
    queryKey: ['genres'],
    queryFn: ({ signal }) => api<{ items: Genre[] }>('/genres', { auth: false, signal }),
    staleTime: 5 * 60 * 1000,
  });
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLFieldSetElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  const suppressFocusOpen = useRef(false);
  const outsidePointer = useRef(false);
  // An owner can undo a local removal of a legacy category before saving. Once
  // save updates the server snapshot, removed legacy IDs leave this allowlist.
  const options = useMemo(() => {
    const combined = new Map<string, Genre>();
    for (const genre of [...(catalog.data?.items || []), ...retainedGenres, ...value])
      if (!combined.has(genre.id)) combined.set(genre.id, genre);
    return [...combined.values()];
  }, [catalog.data, value, retainedGenres]);
  const matches = useMemo(
    () => options.filter((genre) => matchesGenreSearch(genre, query)),
    [options, query],
  );
  const selected = useMemo(() => new Set(value.map((genre) => genre.id)), [value]);
  const atLimit = value.length >= max;
  const id = useId();
  const inputId = id + '-genre-search',
    listId = id + '-genre-list',
    helpId = id + '-genre-help',
    countId = id + '-genre-count',
    limitId = id + '-genre-limit';
  const activeOption = matches[Math.min(active, Math.max(0, matches.length - 1))];
  const close = useCallback(() => setOpen(false), []);
  const closeAndFocus = () => {
    close();
    suppressFocusOpen.current = true;
    search.current?.focus();
    suppressFocusOpen.current = false;
  };
  useEffect(() => {
    if (!open) return;
    let releaseTimer: ReturnType<typeof setTimeout> | undefined;
    const resetPointer = () => {
      outsidePointer.current = false;
      if (releaseTimer !== undefined) {
        clearTimeout(releaseTimer);
        releaseTimer = undefined;
      }
    };
    const inside = (event: Event) => {
      const element = root.current;
      return (
        !!element &&
        (event.composedPath().includes(element) || element.contains(event.target as Node))
      );
    };
    // This panel occupies normal form flow. Collapsing on pointerdown or its
    // focusout would move the next field/Save button before pointerup delivers
    // the click. Keep the layout stable until the outside target receives it.
    const pointerDown = (event: PointerEvent) => {
      resetPointer();
      outsidePointer.current = !inside(event);
    };
    const outsideClick = (event: MouseEvent) => {
      resetPointer();
      if (!inside(event)) close();
    };
    const pointerUp = (event: PointerEvent) => {
      if (!outsidePointer.current) return;
      // A normal click cancels this fallback synchronously. Touch gets a bounded
      // compatibility-click window; dragging/cancelled clicks must not leave a
      // focusout guard active indefinitely.
      releaseTimer = setTimeout(
        () => {
          releaseTimer = undefined;
          outsidePointer.current = false;
          close();
        },
        event.pointerType === 'touch' ? 400 : 0,
      );
    };
    const pointerCancel = () => {
      const wasOutside = outsidePointer.current;
      resetPointer();
      if (wasOutside || !root.current?.contains(document.activeElement)) close();
    };
    document.addEventListener('pointerdown', pointerDown, true);
    document.addEventListener('pointerup', pointerUp, true);
    document.addEventListener('pointercancel', pointerCancel, true);
    document.addEventListener('click', outsideClick);
    return () => {
      resetPointer();
      document.removeEventListener('pointerdown', pointerDown, true);
      document.removeEventListener('pointerup', pointerUp, true);
      document.removeEventListener('pointercancel', pointerCancel, true);
      document.removeEventListener('click', outsideClick);
    };
  }, [open, close]);
  useEffect(() => {
    if (disabled) close();
  }, [disabled, close]);
  useEffect(() => {
    if (open)
      list.current
        ?.querySelector<HTMLElement>('[data-active="true"]')
        ?.scrollIntoView({ block: 'nearest' });
  }, [open, active, matches]);
  const remove = (genre: Genre) => {
    if (disabled) return;
    onChange(value.filter((item) => item.id !== genre.id));
    search.current?.focus();
  };
  const toggle = (genre: Genre) => {
    if (disabled) return;
    if (selected.has(genre.id)) onChange(value.filter((item) => item.id !== genre.id));
    else if (!atLimit) onChange([...value, genre]);
  };
  const keyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key === 'Tab') {
      close();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setActive((index) => (open ? Math.min(index + 1, Math.max(0, matches.length - 1)) : 0));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
      setActive((index) =>
        open
          ? Math.max(0, Math.min(index, matches.length - 1) - 1)
          : Math.max(0, matches.length - 1),
      );
    } else if (event.key === 'Home' && open) {
      event.preventDefault();
      setActive(0);
    } else if (event.key === 'End' && open) {
      event.preventDefault();
      setActive(Math.max(0, matches.length - 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        setActive(0);
      } else if (activeOption) toggle(activeOption);
    } else if (event.key === 'Backspace' && !query && value.length) {
      event.preventDefault();
      remove(value[value.length - 1]);
    }
  };
  return (
    <fieldset
      ref={root}
      className="genre-picker"
      disabled={disabled}
      onBlur={(event) => {
        if (
          !outsidePointer.current &&
          event.relatedTarget &&
          !event.currentTarget.contains(event.relatedTarget as Node)
        )
          close();
      }}
    >
      <legend>{t('Thể loại')}</legend>
      <p className="genre-help" id={helpId}>
        {t('Có thể chọn tối đa {count} thể loại.', { count: max })}{' '}
        {t('Nhấn Enter để chọn hoặc bỏ chọn thể loại.')}
      </p>
      <div className="genre-selected" role="list" aria-label={t('Thể loại đã chọn')}>
        {value.map((genre) => (
          <span
            className="genre-selected-chip"
            role="listitem"
            data-genre-id={genre.id}
            key={genre.id}
          >
            <bdi>{genre.name}</bdi>
            <button
              type="button"
              disabled={disabled}
              aria-label={t('Bỏ thể loại {name}', { name: genre.name })}
              onClick={() => remove(genre)}
            >
              <Icon name="close" size={16} />
            </button>
          </span>
        ))}
      </div>
      <div className="genre-search-row">
        <label className="sr-only" htmlFor={inputId}>
          {t('Chọn thể loại')}
        </label>
        <input
          ref={search}
          id={inputId}
          role="combobox"
          type="search"
          placeholder={t('Tìm thể loại…')}
          value={query}
          disabled={disabled}
          maxLength={100}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-activedescendant={
            open && activeOption ? id + '-genre-' + activeOption.id : undefined
          }
          aria-describedby={helpId + ' ' + countId + (atLimit ? ' ' + limitId : '')}
          onFocus={() => {
            if (!suppressFocusOpen.current) setOpen(true);
          }}
          onClick={() => setOpen(true)}
          onChange={(event) => {
            event.stopPropagation();
            setQuery(event.target.value);
            setActive(0);
            setOpen(true);
          }}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={() => {
            composing.current = false;
          }}
          onKeyDown={keyDown}
        />
        {open && (
          <button
            type="button"
            className="icon-button"
            aria-label={t('Đóng danh sách thể loại')}
            onClick={closeAndFocus}
          >
            <Icon name="up" size={18} />
          </button>
        )}
      </div>
      <p className="genre-count" id={countId} role="status" aria-live="polite" aria-atomic="true">
        {t('Đã chọn {count}/{max} thể loại.', { count: value.length, max })}
      </p>
      {atLimit && (
        <p className="genre-limit" id={limitId}>
          {t('Đã chọn đủ {count} thể loại. Bỏ một thể loại để chọn thêm.', { count: max })}
        </p>
      )}
      {open && (
        <div className="genre-results">
          {catalog.isPending && (
            <p className="genre-feedback" role="status">
              {t('Đang tải thể loại…')}
            </p>
          )}
          {catalog.isError && (
            <div className="genre-feedback genre-error" role="alert">
              <p>{t('Không thể tải danh sách thể loại.')}</p>
              <button
                type="button"
                className="text-action"
                disabled={catalog.isFetching || disabled}
                onClick={() => void catalog.refetch()}
              >
                {t('Thử lại')}
              </button>
            </div>
          )}
          <div
            ref={list}
            id={listId}
            role="listbox"
            aria-label={t('Danh sách thể loại')}
            aria-multiselectable="true"
            aria-busy={catalog.isFetching}
            className="genre-options"
          >
            {matches.map((genre, index) => {
              const chosen = selected.has(genre.id);
              return (
                <button
                  type="button"
                  role="option"
                  id={id + '-genre-' + genre.id}
                  key={genre.id}
                  tabIndex={-1}
                  aria-selected={chosen}
                  aria-disabled={disabled || (!chosen && atLimit)}
                  disabled={disabled || (!chosen && atLimit)}
                  data-genre-id={genre.id}
                  data-active={activeOption?.id === genre.id ? 'true' : 'false'}
                  className="genre-option"
                  onMouseMove={() => setActive(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => toggle(genre)}
                >
                  <bdi>{genre.name}</bdi>
                  <span className="genre-option-check" aria-hidden="true">
                    {chosen && <Icon name="check" size={17} />}
                  </span>
                </button>
              );
            })}
          </div>
          {!catalog.isPending && !catalog.isError && !options.length && (
            <p className="genre-feedback" role="status">
              {t('Chưa có thể loại để chọn.')}
            </p>
          )}
          {!!options.length && !matches.length && (
            <div className="genre-feedback" role="status">
              <p>{t('Không tìm thấy thể loại phù hợp.')}</p>
              <p>{t('Thử một tên hoặc cách viết khác.')}</p>
            </div>
          )}
        </div>
      )}
    </fieldset>
  );
}
