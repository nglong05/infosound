'use client';

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import { themes, type ThemeId } from '@/lib/themes';
import { useI18n } from './locale-provider';
import { useTheme } from './theme-provider';

function Palette() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      aria-hidden="true"
    >
      <path d="M12 3a9 9 0 1 0 0 18h1.2a2.3 2.3 0 0 0 1.8-3.7 1.6 1.6 0 0 1 1.2-2.6H18a3 3 0 0 0 3-3A9 9 0 0 0 12 3Z" />
      <circle cx="7.5" cy="11" r=".7" />
      <circle cx="9" cy="7.5" r=".7" />
      <circle cx="13" cy="6.8" r=".7" />
      <circle cx="16.5" cy="9" r=".7" />
    </svg>
  );
}
function Check() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d="m5 12 4 4L19 6" />
    </svg>
  );
}

/** Theme changes apply immediately; the panel stays open for comparison. */
export function ThemeSelector() {
  const { theme, setTheme } = useTheme();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [availableHeight, setAvailableHeight] = useState(480);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const radios = useRef<(HTMLInputElement | null)[]>([]);
  const id = useId();
  const dialogId = id + '-theme-dialog',
    headingId = id + '-theme-heading',
    descriptionId = id + '-theme-description';
  const selected = themes.find((option) => option.id === theme) || themes[0];
  const close = useCallback((restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus();
  }, []);
  const measure = useCallback(
    () =>
      setAvailableHeight(
        Math.max(
          0,
          window.innerHeight - (trigger.current?.getBoundingClientRect().bottom ?? 0) - 26,
        ),
      ),
    [],
  );
  const show = () => {
    document.dispatchEvent(new CustomEvent('infosound-preference-open', { detail: 'theme' }));
    measure();
    setOpen(true);
  };
  useEffect(() => {
    const preferenceOpened = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== 'theme') close(false);
    };
    document.addEventListener('infosound-preference-open', preferenceOpened);
    return () => document.removeEventListener('infosound-preference-open', preferenceOpened);
  }, [close]);
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() =>
      radios.current.find((input) => input?.checked)?.focus(),
    );
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) close(false);
    };
    document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure);
    };
  }, [open, close, measure]);
  const choose = (next: ThemeId) => setTheme(next);
  const keyDown = (event: KeyboardEvent<HTMLInputElement>, index: number) => {
    if (event.nativeEvent.isComposing) return;
    let next: number | undefined;
    const rtl = event.currentTarget.ownerDocument.documentElement.dir === 'rtl';
    if (event.key === 'ArrowDown' || event.key === (rtl ? 'ArrowLeft' : 'ArrowRight'))
      next = (index + 1) % themes.length;
    else if (event.key === 'ArrowUp' || event.key === (rtl ? 'ArrowRight' : 'ArrowLeft'))
      next = (index + themes.length - 1) % themes.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = themes.length - 1;
    else if (event.key === 'Enter') {
      event.preventDefault();
      choose(themes[index].id);
      return;
    }
    if (next !== undefined) {
      event.preventDefault();
      choose(themes[next].id);
      radios.current[next]?.focus();
      radios.current[next]?.scrollIntoView({ block: 'nearest' });
    }
  };
  return (
    <div
      ref={root}
      className="theme-selector"
      data-open={open ? 'true' : 'false'}
      style={{ '--theme-available-height': availableHeight + 'px' } as CSSProperties}
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
        id="interface-theme"
        type="button"
        className="theme-trigger"
        aria-label={t('Màu giao diện') + ': ' + t(selected.name)}
        title={t('Màu giao diện')}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? dialogId : undefined}
        data-theme-choice={theme}
        onClick={() => (open ? close() : show())}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            show();
          } else if (event.key === 'Escape' && open) {
            event.preventDefault();
            close();
          }
        }}
      >
        <Palette />
      </button>
      {open && (
        <section
          id={dialogId}
          role="dialog"
          aria-modal="false"
          aria-labelledby={headingId}
          aria-describedby={descriptionId}
          className="theme-dialog"
          onKeyDown={(event) => {
            if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
              event.preventDefault();
              event.stopPropagation();
              close();
            }
          }}
        >
          <div className="theme-dialog-heading">
            <h2 id={headingId}>{t('Chọn màu giao diện')}</h2>
            <button
              type="button"
              className="icon-button"
              aria-label={t('Đóng bảng màu')}
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
          <p id={descriptionId} className="theme-description">
            {t('Tông màu dịu, dễ nhìn.')}
          </p>
          <div role="radiogroup" aria-labelledby={headingId} className="theme-options">
            {themes.map((option, index) => (
              <label
                key={option.id}
                className="theme-option"
                data-selected={theme === option.id ? 'true' : 'false'}
                style={{ '--theme-preview': option.preview } as CSSProperties}
              >
                <input
                  ref={(element) => {
                    radios.current[index] = element;
                  }}
                  type="radio"
                  name={id + '-theme'}
                  value={option.id}
                  data-theme-value={option.id}
                  checked={theme === option.id}
                  aria-label={t(option.name)}
                  onChange={() => choose(option.id)}
                  onKeyDown={(event) => keyDown(event, index)}
                />
                <span className="theme-swatch" aria-hidden="true">
                  {theme === option.id && <Check />}
                </span>
                <span className="theme-name">{t(option.name)}</span>
              </label>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
