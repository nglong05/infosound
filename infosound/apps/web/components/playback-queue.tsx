'use client';

import { useEffect, useRef, useState } from 'react';
import { time, type Track } from '@/lib/api';
import { Artwork } from './common';
import { Icon } from './icons';
import { useI18n } from './locale-provider';
import { useQueueEditing } from './use-queue-editing';

type PlaybackQueueProps = {
  open: boolean;
  tracks: Track[];
  currentTrackId?: string;
  playing: boolean;
  pending: boolean;
  onClose: () => void;
  onSelect: (track: Track) => void;
  onMove: (id: string, toIndex: number) => void;
  onRemove: (id: string) => void;
};

const EXIT_MS = 260;
const higherLayerSelector =
  'dialog[open],[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"],[popover]:popover-open';

function higherLayerIsOpen() {
  return [...document.querySelectorAll<HTMLElement>(higherLayerSelector)].some(
    (element) =>
      !element.closest('[hidden],[inert],[aria-hidden="true"]') &&
      element.getClientRects().length > 0 &&
      getComputedStyle(element).visibility !== 'hidden',
  );
}

function canRestoreFocus(element: HTMLElement | null | undefined): element is HTMLElement {
  return (
    !!element &&
    element !== document.body &&
    element.isConnected &&
    !element.closest('[hidden],[inert],[aria-hidden="true"]') &&
    !element.matches(':disabled') &&
    element.getClientRects().length > 0 &&
    getComputedStyle(element).visibility !== 'hidden'
  );
}

/** A nonmodal view of the root player's existing queue; never owns playback or fetches. */
export function PlaybackQueue({
  open,
  tracks,
  currentTrackId,
  playing,
  pending,
  onClose,
  onSelect,
  onMove,
  onRemove,
}: PlaybackQueueProps) {
  const { t } = useI18n();
  const panel = useRef<HTMLElement>(null),
    heading = useRef<HTMLHeadingElement>(null),
    list = useRef<HTMLOListElement>(null);
  const closeCallback = useRef(onClose),
    openRef = useRef(open),
    closeRequested = useRef(false);
  const [present, setPresent] = useState(open);
  const editing = useQueueEditing(open, pending, tracks, list, onMove),
    editingRef = useRef(editing);
  editingRef.current = editing;
  const removing = useRef<{ id: string; nextId?: string; focus: HTMLElement | null } | null>(null);
  const trackKey = tracks.map((item) => item.id).join('\0');
  closeCallback.current = onClose;
  openRef.current = open;

  // Keep the panel mounted through exit; the controlled prop makes it inert immediately.
  useEffect(() => {
    if (open) {
      setPresent(true);
      return;
    }
    if (!present) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (reduced.matches) {
      setPresent(false);
      return;
    }
    const finish = () => setPresent(false);
    const timer = window.setTimeout(finish, EXIT_MS);
    const preferenceChanged = () => {
      if (reduced.matches) finish();
    };
    reduced.addEventListener('change', preferenceChanged);
    return () => {
      window.clearTimeout(timer);
      reduced.removeEventListener('change', preferenceChanged);
    };
  }, [open, present]);

  useEffect(() => {
    if (!open) return;
    const element = panel.current;
    closeRequested.current = false;
    if (!element || higherLayerIsOpen()) {
      closeCallback.current();
      return;
    }
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    let lastFocus: HTMLElement | null = null,
      skipRestore = false;
    const requestClose = (restore: boolean) => {
      if (!openRef.current || closeRequested.current) return;
      closeRequested.current = true;
      skipRestore = !restore;
      closeCallback.current();
    };
    const pointerDown = (event: PointerEvent) => {
      const path = event.composedPath(),
        trigger = document.getElementById('queue-toggle');
      if (path.includes(element) || (trigger && path.includes(trigger)) || higherLayerIsOpen())
        return;
      // Dismiss without cancelling the page's pointer/click/focus action.
      requestClose(false);
    };
    const keyDown = (event: KeyboardEvent) => {
      if (
        event.key !== 'Escape' ||
        event.defaultPrevented ||
        event.isComposing ||
        higherLayerIsOpen()
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      if (editingRef.current.press.current) {
        editingRef.current.cancel();
        return;
      }
      requestClose(true);
    };
    const focusIn = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || target === document.body) return;
      lastFocus = target;
      if (element.contains(target) || target.id === 'queue-toggle' || higherLayerIsOpen()) return;
      // Tab may leave this nonmodal panel; reveal the newly focused page control.
      requestClose(false);
    };
    document.addEventListener('pointerdown', pointerDown, true);
    document.addEventListener('keydown', keyDown, true);
    document.addEventListener('focusin', focusIn);
    heading.current?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener('pointerdown', pointerDown, true);
      document.removeEventListener('keydown', keyDown, true);
      document.removeEventListener('focusin', focusIn);
      if (skipRestore || higherLayerIsOpen()) return;
      const active = document.activeElement;
      const ownedFocus =
        element.contains(active) ||
        (active === document.body && !!lastFocus && element.contains(lastFocus));
      if (!ownedFocus) return;
      const target = canRestoreFocus(previousFocus)
        ? previousFocus
        : document.getElementById('queue-toggle');
      if (canRestoreFocus(target)) target.focus({ preventScroll: true });
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const container = list.current,
      row = container?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!container || !row) return;
    // Scroll this list only, never ancestors or the document behind the drawer.
    const entry = row.closest<HTMLElement>('.playback-queue-entry') ?? row,
      top = entry.offsetTop,
      bottom = top + entry.offsetHeight;
    if (top < container.scrollTop) container.scrollTop = top;
    else if (bottom > container.scrollTop + container.clientHeight)
      container.scrollTop = bottom - container.clientHeight;
  }, [open, currentTrackId]);

  useEffect(() => {
    const intent = removing.current;
    if (!intent || tracks.some((item) => item.id === intent.id)) return;
    removing.current = null;
    if (document.activeElement !== document.body && document.activeElement !== intent.focus) return;
    const buttons = list.current
      ? [...list.current.querySelectorAll<HTMLButtonElement>('.playback-queue-track')]
      : [];
    const next = buttons.find((item) => item.dataset.trackId === intent.nextId);
    const target = open
      ? canRestoreFocus(next ?? null)
        ? next
        : heading.current
      : document.getElementById('queue-toggle');
    if (canRestoreFocus(target)) target.focus({ preventScroll: true });
    const container = list.current,
      entry = target?.closest<HTMLElement>('.playback-queue-entry');
    if (container && entry) {
      const top = entry.offsetTop,
        bottom = top + entry.offsetHeight;
      if (top < container.scrollTop) container.scrollTop = top;
      else if (bottom > container.scrollTop + container.clientHeight)
        container.scrollTop = bottom - container.clientHeight;
    }
  }, [trackKey, open]);

  return (
    <aside
      ref={panel}
      id="playback-queue"
      className="playback-queue"
      data-state={open ? 'open' : present ? 'closing' : 'closed'}
      aria-labelledby="playback-queue-title"
      aria-hidden={!open}
      inert={!open}
    >
      <header className="playback-queue-header">
        <div className="playback-queue-heading">
          <h2 ref={heading} id="playback-queue-title" tabIndex={-1}>
            {t('Hàng đợi phát')}
          </h2>
          {tracks.length > 0 && (
            <p>
              {t(tracks.length === 1 ? '1 bài hát' : '{count} bài hát', { count: tracks.length })}
            </p>
          )}
        </div>
        <button
          type="button"
          className="icon-button playback-queue-close"
          aria-label={t('Đóng hàng đợi')}
          onClick={onClose}
        >
          <Icon name="close" size={22} />
        </button>
      </header>
      {tracks.length > 0 ? (
        <ol
          ref={list}
          className="playback-queue-list"
          aria-label={t('Tiếp theo')}
          aria-busy={pending}
        >
          {tracks.map((item, index) => {
            const current = item.id === currentTrackId,
              artist = item.author?.displayName || t('Nghệ sĩ');
            return (
              <li
                key={item.id}
                className="playback-queue-entry"
                data-queue-id={item.id}
                data-current={current ? 'true' : undefined}
                data-pressed={editing.pressedId === item.id ? 'true' : undefined}
                data-dragging={editing.preview?.id === item.id ? 'true' : undefined}
                data-drop-target={
                  editing.preview && editing.preview.to === index && editing.preview.id !== item.id
                    ? 'true'
                    : undefined
                }
              >
                <button
                  type="button"
                  className="playback-queue-track"
                  data-track-id={item.id}
                  aria-current={current ? 'true' : undefined}
                  aria-label={t('Phát {title}', { title: item.title }) + ' · ' + artist}
                  title={item.title + ' · ' + artist}
                  disabled={pending || item.available === false}
                  aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
                  onPointerDown={(event) => editing.start(event, item.id)}
                  onPointerMove={editing.pointerMove}
                  onPointerUp={editing.end}
                  onPointerCancel={() => editing.cancel()}
                  onLostPointerCapture={() => {
                    if (editing.press.current) editing.cancel();
                  }}
                  onContextMenu={(event) => {
                    if (editing.press.current) event.preventDefault();
                  }}
                  onKeyDown={(event) => {
                    if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
                      event.preventDefault();
                      event.stopPropagation();
                      editing.move(
                        item.id,
                        index + (event.key === 'ArrowUp' ? -1 : 1),
                        event.currentTarget,
                      );
                    }
                  }}
                  onClick={(event) => {
                    if (editing.consumeClick(item.id, event.detail)) {
                      event.preventDefault();
                      return;
                    }
                    onSelect(item);
                  }}
                >
                  <span className="playback-queue-art" aria-hidden="true">
                    <Artwork track={item} />
                  </span>
                  <span className="playback-queue-info">
                    <span className="playback-queue-title">
                      <bdi>{item.title}</bdi>
                    </span>
                    <span className="playback-queue-artist">
                      <bdi>{artist}</bdi>
                    </span>
                  </span>
                  <span className="playback-queue-meta" aria-hidden="true">
                    {current && (
                      <span className="playback-queue-current">
                        <Icon name={playing ? 'volume' : 'play'} size={15} />
                      </span>
                    )}
                    <span dir="ltr">{time(item.duration)}</span>
                  </span>
                </button>
                <div className="playback-queue-tools">
                  <button
                    type="button"
                    className="icon-button playback-queue-remove"
                    disabled={pending}
                    aria-label={t('Xóa {title} khỏi hàng đợi', { title: item.title })}
                    title={t('Xóa {title} khỏi hàng đợi', { title: item.title })}
                    onClick={(event) => {
                      removing.current = {
                        id: item.id,
                        nextId: tracks[index + 1]?.id ?? tracks[index - 1]?.id,
                        focus: event.currentTarget,
                      };
                      onRemove(item.id);
                    }}
                  >
                    <Icon name="close" size={17} />
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <div className="playback-queue-empty">
          <span aria-hidden="true">
            <Icon name="playlist" size={32} />
          </span>
          <p>{t('Chưa có bài trong hàng đợi.')}</p>
        </div>
      )}
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {editing.announcement}
      </p>
    </aside>
  );
}
