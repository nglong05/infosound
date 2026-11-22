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
import { languages, type Locale } from '@/lib/languages';
import { matchesLanguageSearch } from '@/lib/language-search';
import { useI18n } from './locale-provider';

function Globe() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <ellipse cx="12" cy="12" rx="4" ry="9" />
      <path d="M3 12h18" />
    </svg>
  );
}

export function LanguageSelector() {
  const { locale, setLocale, t, pending, error } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [failed, setFailed] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  const choosing = useRef(false);
  const isOpen = useRef(false);
  const id = useId();
  const dialogId = id + '-dialog',
    headingId = id + '-heading',
    searchId = id + '-search',
    listId = id + '-list',
    helpId = id + '-help';
  const selected = languages.find((language) => language.code === locale) || languages[0];
  const matches = useMemo(
    () => languages.filter((language) => matchesLanguageSearch(language, query)),
    [query],
  );
  const activeOption = matches[active];
  const close = useCallback((restoreFocus = true) => {
    isOpen.current = false;
    setOpen(false);
    if (restoreFocus) trigger.current?.focus();
  }, []);
  const show = (index?: number) => {
    document.dispatchEvent(new CustomEvent('infosound-preference-open', { detail: 'language' }));
    isOpen.current = true;
    setQuery('');
    setActive(
      index ??
        Math.max(
          0,
          languages.findIndex((language) => language.code === locale),
        ),
    );
    setOpen(true);
  };
  useEffect(() => {
    const otherPreference = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== 'language') close(false);
    };
    document.addEventListener('infosound-preference-open', otherPreference);
    return () => document.removeEventListener('infosound-preference-open', otherPreference);
  }, [close]);
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => search.current?.focus());
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) close(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('pointerdown', outside);
    };
  }, [open, close]);
  useEffect(() => {
    if (open)
      list.current
        ?.querySelector<HTMLElement>('[data-active="true"]')
        ?.scrollIntoView({ block: 'nearest' });
  }, [open, active, matches]);
  const choose = async (code: Locale) => {
    if (pending || choosing.current) return;
    if (code === locale) {
      close();
      return;
    }
    choosing.current = true;
    setFailed(false);
    try {
      await setLocale(code);
      close(isOpen.current);
    } catch {
      setFailed(true);
      if (isOpen.current) search.current?.focus();
    } finally {
      choosing.current = false;
    }
  };
  const keyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((index) => (matches.length ? Math.min(index + 1, matches.length - 1) : 0));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => Math.max(0, index - 1));
    } else if (event.key === 'Home') {
      event.preventDefault();
      setActive(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setActive(Math.max(0, matches.length - 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (activeOption) void choose(activeOption.code);
    }
  };
  const failure = error || (failed ? 'Không thể đổi ngôn ngữ. Vui lòng thử lại.' : '');
  return (
    <div
      ref={root}
      className="language-selector"
      data-open={open ? 'true' : 'false'}
      onBlur={(event) => {
        if (
          open &&
          event.relatedTarget &&
          !event.currentTarget.contains(event.relatedTarget as Node)
        )
          close(false);
      }}
    >
      <button
        ref={trigger}
        id="interface-language"
        type="button"
        className="language-trigger"
        aria-label={t('Ngôn ngữ') + ': ' + selected.name}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? dialogId : undefined}
        data-locale={locale}
        onClick={() => (open ? close() : show())}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            show();
          } else if (event.key === 'Home') {
            event.preventDefault();
            show(0);
          } else if (event.key === 'End') {
            event.preventDefault();
            show(languages.length - 1);
          } else if (event.key === 'Escape' && open) {
            event.preventDefault();
            close();
          }
        }}
      >
        <Globe />
        <bdi lang={selected.code} dir={selected.direction}>
          {selected.name}
        </bdi>
        <svg
          className="language-chevron"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <section
          id={dialogId}
          role="dialog"
          aria-label={t('Chọn ngôn ngữ')}
          aria-modal="false"
          className="language-dialog"
          onKeyDown={(event) => {
            if (event.key === 'Escape' && !composing.current && !event.nativeEvent.isComposing) {
              event.preventDefault();
              event.stopPropagation();
              close();
            }
          }}
        >
          <div className="language-dialog-heading">
            <h2 id={headingId}>{t('Chọn ngôn ngữ')}</h2>
            <button
              type="button"
              className="icon-button"
              aria-label={t('Đóng danh sách ngôn ngữ')}
              onClick={() => close()}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path d="m6 6 12 12M6 18 18 6" />
              </svg>
            </button>
          </div>
          <div className="language-search">
            <label htmlFor={searchId}>{t('Tìm ngôn ngữ')}</label>
            <input
              ref={search}
              id={searchId}
              role="combobox"
              type="search"
              value={query}
              placeholder={t('Tìm theo tên ngôn ngữ…')}
              aria-autocomplete="list"
              aria-expanded="true"
              aria-controls={listId}
              aria-activedescendant={activeOption ? id + '-option-' + activeOption.code : undefined}
              aria-describedby={helpId}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(0);
              }}
              onCompositionStart={() => {
                composing.current = true;
              }}
              onCompositionEnd={() => {
                composing.current = false;
              }}
              onKeyDown={keyDown}
            />
          </div>
          <p id={helpId} className="language-result-count" role="status" aria-live="polite">
            {t('{count} ngôn ngữ', { count: matches.length })}
          </p>
          <div
            ref={list}
            id={listId}
            role="listbox"
            aria-labelledby={headingId}
            aria-busy={pending}
            className="language-list"
          >
            {matches.map((language, index) => (
              <button
                key={language.code}
                id={id + '-option-' + language.code}
                type="button"
                role="option"
                lang={language.code}
                tabIndex={-1}
                aria-selected={language.code === locale}
                disabled={pending}
                data-active={index === active ? 'true' : 'false'}
                className="language-option"
                onMouseMove={() => setActive(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => void choose(language.code)}
              >
                <bdi lang={language.code} dir={language.direction}>
                  {language.name}
                </bdi>
                {language.code === locale && (
                  <>
                    <span className="sr-only">{t('Ngôn ngữ hiện tại')}</span>
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      aria-hidden="true"
                    >
                      <path d="m5 12 4 4L19 6" />
                    </svg>
                  </>
                )}
              </button>
            ))}
          </div>
          {!matches.length && (
            <div className="language-empty" role="status">
              <strong>{t('Không tìm thấy ngôn ngữ phù hợp.')}</strong>
              <p>{t('Thử một tên hoặc cách viết khác.')}</p>
            </div>
          )}
          {pending && (
            <p className="language-pending" role="status">
              {t('Đang đổi ngôn ngữ…')}
            </p>
          )}
          {failure && (
            <p className="language-error" role="alert">
              {t(failure)}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
