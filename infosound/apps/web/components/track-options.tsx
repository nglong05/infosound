'use client';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Track } from '@/lib/api';
import { Icon } from './icons';
import { useI18n } from './locale-provider';
import { useAuth } from '@/features/auth/auth-context';
import { usePlayer } from '@/features/player/player-context';

const menuEvent = 'infosound-track-options-open';

/** Session queue action only; never starts playback or fetches metadata. */
export function TrackOptions({ track }: { track: Track }) {
  const { t, locale } = useI18n(),
    player = usePlayer(),
    { user } = useAuth();
  const id = useId(),
    trigger = useRef<HTMLButtonElement>(null),
    menu = useRef<HTMLDivElement>(null),
    item = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false),
    [position, setPosition] = useState({ top: 0, left: 0 });
  const closeRef = useRef<(restore?: boolean) => void>(() => {});
  const unavailable =
    track.available === false ||
    track.processingState !== 'READY' ||
    track.publicationState !== 'PUBLISHED';
  const close = (restore = false) => {
    if (
      restore &&
      menu.current?.contains(document.activeElement) &&
      trigger.current?.isConnected &&
      !trigger.current.disabled
    )
      trigger.current.focus({ preventScroll: true });
    setOpen(false);
  };
  closeRef.current = close;
  const show = () => {
    if (player.pending || unavailable) return;
    window.dispatchEvent(new CustomEvent(menuEvent, { detail: id }));
    setOpen(true);
  };
  useEffect(() => {
    const other = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== id) closeRef.current(false);
    };
    window.addEventListener(menuEvent, other);
    return () => window.removeEventListener(menuEvent, other);
  }, [id]);
  useEffect(() => {
    if (player.pending || unavailable) closeRef.current(false);
  }, [player.pending, unavailable]);
  useEffect(() => {
    closeRef.current(false);
  }, [user?.id, track.id, track.sourceVersion]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      const path = event.composedPath();
      if (
        (trigger.current && path.includes(trigger.current)) ||
        (menu.current && path.includes(menu.current))
      )
        return;
      closeRef.current(false);
    };
    const focusOutside = (event: FocusEvent) => {
      const target = event.target;
      if (
        target instanceof Node &&
        (trigger.current?.contains(target) || menu.current?.contains(target))
      )
        return;
      closeRef.current(false);
    };
    const blur = () => closeRef.current(false);
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('focusin', focusOutside);
    window.addEventListener('blur', blur);
    const frame = requestAnimationFrame(() => item.current?.focus({ preventScroll: true }));
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('focusin', focusOutside);
      window.removeEventListener('blur', blur);
    };
  }, [open]);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const source = trigger.current,
        target = menu.current;
      if (!source || !target) return;
      const rect = source.getBoundingClientRect(),
        box = target.getBoundingClientRect();
      if (
        rect.bottom <= 0 ||
        rect.top >= innerHeight ||
        rect.right <= 0 ||
        rect.left >= innerWidth
      ) {
        closeRef.current(false);
        return;
      }
      const left = Math.max(8, Math.min(innerWidth - box.width - 8, rect.right - box.width));
      const below = rect.bottom + 6,
        top =
          below + box.height <= innerHeight - 8 ? below : Math.max(8, rect.top - box.height - 6);
      setPosition((previous) =>
        previous.left === left && previous.top === top ? previous : { left, top },
      );
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    const observer = new ResizeObserver(place);
    if (menu.current) observer.observe(menu.current);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, locale]);
  return (
    <span className="track-options" data-track-id={track.id}>
      <button
        ref={trigger}
        type="button"
        className="icon-button track-options-trigger track-options-toggle"
        aria-label={t('Tùy chọn cho {title}', { title: track.title })}
        title={t('Tùy chọn cho {title}', { title: track.title })}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        disabled={player.pending || unavailable}
        onClick={() => (open ? close(false) : show())}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            show();
          }
        }}
      >
        <Icon name="more" size={20} />
      </button>
      {open &&
        createPortal(
          <div
            ref={menu}
            id={id}
            className="track-options-menu"
            role="menu"
            aria-label={t('Tùy chọn cho {title}', { title: track.title })}
            style={position}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                close(true);
              } else if (event.key === 'Tab') close(true);
              else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                event.preventDefault();
                item.current?.focus();
              }
            }}
          >
            <button
              ref={item}
              type="button"
              role="menuitem"
              className="track-options-item"
              onClick={() => {
                player.enqueue(track);
                close(true);
              }}
            >
              <Icon name="playlist" size={18} />
              <span>{t('Thêm vào hàng đợi')}</span>
            </button>
          </div>,
          document.body,
        )}
    </span>
  );
}
