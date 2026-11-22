'use client';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { Track } from '@/lib/api';
import { useI18n } from './locale-provider';

const HOLD_MS = 300,
  MOVE_PX = 8;
type DragState = {
  id: string;
  from: number;
  to: number;
  pointer: number;
  handle: HTMLButtonElement;
  x: number;
  y: number;
};
type PressState = {
  id: string;
  pointer: number;
  handle: HTMLButtonElement;
  originX: number;
  originY: number;
  x: number;
  y: number;
  lastY: number;
  lastAt: number;
  velocity: number;
  kind: string;
  mode: 'pending' | 'drag' | 'scroll' | 'held' | 'cancelled';
};

/** Hold a song to move it. Before the hold, a touch swipe scrolls only this list. */
export function useQueueEditing(
  open: boolean,
  pending: boolean,
  tracks: Track[],
  list: { current: HTMLOListElement | null },
  onMove: (id: string, toIndex: number) => void,
) {
  const { t } = useI18n(),
    inputs = useRef({ open, pending, tracks, onMove });
  inputs.current = { open, pending, tracks, onMove };
  const drag = useRef<DragState | null>(null),
    press = useRef<PressState | null>(null),
    frame = useRef<number | null>(null),
    timer = useRef<number | null>(null);
  const suppressed = useRef<{ id: string; until: number } | null>(null);
  const [preview, setPreview] = useState<{ id: string; to: number } | null>(null),
    [pressedId, setPressedId] = useState<string | null>(null),
    [announcementValues, setAnnouncement] = useState<{ title: string; position: number } | null>(
      null,
    );
  const moved = useRef<{ id: string; from: number; focus: HTMLElement | null } | null>(null);
  const key = tracks.map((item) => item.id).join('\0');
  const blockClick = (id: string) => {
    suppressed.current = { id, until: performance.now() + 800 };
  };
  const cancel = useCallback((update = true) => {
    const value = press.current;
    press.current = null;
    drag.current = null;
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
    if (value) {
      suppressed.current = { id: value.id, until: performance.now() + 800 };
      try {
        if (value.handle.hasPointerCapture(value.pointer))
          value.handle.releasePointerCapture(value.pointer);
      } catch {}
    }
    if (update) {
      setPreview(null);
      setPressedId(null);
    }
  }, []);
  const targetAt = (y: number) => {
    const entries = list.current?.querySelectorAll<HTMLElement>('.playback-queue-entry');
    if (!entries?.length) return 0;
    let low = 0,
      high = entries.length - 1;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (y > entries[middle].getBoundingClientRect().bottom) low = middle + 1;
      else high = middle;
    }
    return low;
  };
  const updateTarget = () => {
    const value = drag.current;
    if (!value) return;
    value.to = targetAt(value.y);
    setPreview((previous) =>
      previous?.id === value.id && previous.to === value.to
        ? previous
        : { id: value.id, to: value.to },
    );
  };
  const scrollFrame = () => {
    const value = drag.current,
      container = list.current;
    if (!value || !container) return;
    const rect = container.getBoundingClientRect();
    let delta = 0;
    if (value.x >= rect.left && value.x <= rect.right) {
      if (value.y < rect.top + 40)
        delta = -Math.min(14, Math.max(0, (rect.top + 40 - value.y) / 3));
      else if (value.y > rect.bottom - 40)
        delta = Math.min(14, Math.max(0, (value.y - rect.bottom + 40) / 3));
    }
    if (delta) {
      container.scrollTop += delta;
      updateTarget();
    }
    frame.current = requestAnimationFrame(scrollFrame);
  };
  const move = (id: string, to: number, focus: HTMLElement | null) => {
    const current = inputs.current,
      from = current.tracks.findIndex((item) => item.id === id);
    if (
      !current.open ||
      current.pending ||
      from < 0 ||
      to < 0 ||
      to >= current.tracks.length ||
      from === to
    )
      return;
    moved.current = { id, from, focus };
    current.onMove(id, to);
  };
  const start = (event: ReactPointerEvent<HTMLButtonElement>, id: string) => {
    const current = inputs.current;
    if (
      !current.open ||
      current.pending ||
      !current.tracks.some((item) => item.id === id) ||
      !event.isPrimary ||
      event.button !== 0
    )
      return;
    event.preventDefault();
    cancel();
    suppressed.current = null;
    const handle = event.currentTarget;
    handle.focus({ preventScroll: true });
    const value: PressState = {
      id,
      pointer: event.pointerId,
      handle,
      originX: event.clientX,
      originY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      lastY: event.clientY,
      lastAt: performance.now(),
      velocity: 0,
      kind: event.pointerType,
      mode: 'pending',
    };
    press.current = value;
    setPressedId(id);
    try {
      handle.setPointerCapture(event.pointerId);
    } catch {
      cancel();
      return;
    }
    timer.current = window.setTimeout(() => {
      timer.current = null;
      const latest = inputs.current;
      if (press.current !== value || value.mode !== 'pending' || !latest.open || latest.pending)
        return;
      blockClick(id);
      const from = latest.tracks.findIndex((item) => item.id === id);
      if (from < 0 || latest.tracks.length < 2) {
        value.mode = 'held';
        return;
      }
      value.mode = 'drag';
      drag.current = { id, from, to: from, pointer: value.pointer, handle, x: value.x, y: value.y };
      setPreview({ id, to: from });
    }, HOLD_MS);
  };
  const pointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const value = press.current;
    if (!value || value.pointer !== event.pointerId) return;
    event.preventDefault();
    value.x = event.clientX;
    value.y = event.clientY;
    if (
      value.mode === 'pending' &&
      Math.hypot(value.x - value.originX, value.y - value.originY) > MOVE_PX
    ) {
      if (timer.current !== null) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      value.mode =
        value.kind !== 'mouse' &&
        Math.abs(value.y - value.originY) >= Math.abs(value.x - value.originX)
          ? 'scroll'
          : 'cancelled';
      blockClick(value.id);
      setPressedId(null);
    }
    if (value.mode === 'scroll') {
      const now = performance.now(),
        delta = value.lastY - value.y;
      if (list.current) list.current.scrollTop += delta;
      value.velocity = Math.max(-2.5, Math.min(2.5, delta / Math.max(8, now - value.lastAt)));
      value.lastY = value.y;
      value.lastAt = now;
    } else if (value.mode === 'drag' && drag.current) {
      if (
        frame.current === null &&
        Math.hypot(value.x - value.originX, value.y - value.originY) < MOVE_PX
      )
        return;
      drag.current.x = value.x;
      drag.current.y = value.y;
      updateTarget();
      if (frame.current === null) frame.current = requestAnimationFrame(scrollFrame);
    }
  };
  const momentum = (velocity: number) => {
    let speed = velocity * 16;
    const tick = () => {
      const current = inputs.current,
        container = list.current;
      if (!current.open || current.pending || !container || Math.abs(speed) < 0.5) {
        frame.current = null;
        return;
      }
      const before = container.scrollTop;
      container.scrollTop += speed;
      speed *= 0.9;
      if (before === container.scrollTop) {
        frame.current = null;
        return;
      }
      frame.current = requestAnimationFrame(tick);
    };
    if (Math.abs(speed) >= 0.5) frame.current = requestAnimationFrame(tick);
  };
  const end = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const value = press.current;
    if (!value || value.pointer !== event.pointerId) return;
    const dragging = drag.current,
      rect = list.current?.getBoundingClientRect(),
      quick = value.mode === 'pending';
    const velocity =
      value.mode === 'scroll' && performance.now() - value.lastAt < 100 ? value.velocity : 0;
    cancel();
    if (quick) suppressed.current = null;
    else blockClick(value.id);
    if (
      dragging &&
      rect &&
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom
    )
      move(dragging.id, dragging.to, dragging.handle);
    else if (velocity) momentum(velocity);
  };
  const consumeClick = (id: string, detail: number) => {
    if (detail === 0) {
      suppressed.current = null;
      return false;
    }
    const value = suppressed.current;
    suppressed.current = null;
    return !!value && value.id === id && performance.now() < value.until;
  };
  useEffect(() => {
    cancel();
    if (!open || pending) moved.current = null;
    if (!tracks.length) setAnnouncement(null);
  }, [open, pending, key, cancel]);
  useEffect(() => {
    const intent = moved.current;
    if (!intent) return;
    const index = tracks.findIndex((item) => item.id === intent.id);
    moved.current = null;
    if (index < 0 || index === intent.from) return;
    setAnnouncement({ title: tracks[index].title, position: index + 1 });
    const focus = intent.focus;
    if (
      document.activeElement === document.body &&
      focus?.isConnected &&
      !focus.matches(':disabled') &&
      !focus.closest('[hidden],[inert],[aria-hidden="true"]')
    )
      focus.focus({ preventScroll: true });
    const container = list.current,
      entry = focus?.closest<HTMLElement>('.playback-queue-entry');
    if (container && entry) {
      const top = entry.offsetTop,
        bottom = top + entry.offsetHeight;
      if (top < container.scrollTop) container.scrollTop = top;
      else if (bottom > container.scrollTop + container.clientHeight)
        container.scrollTop = bottom - container.clientHeight;
    }
  }, [key, tracks]);
  useEffect(() => {
    const blur = () => cancel(),
      hidden = () => {
        if (document.hidden) cancel();
      };
    window.addEventListener('blur', blur);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      window.removeEventListener('blur', blur);
      document.removeEventListener('visibilitychange', hidden);
      cancel(false);
    };
  }, [cancel]);
  const announcement = announcementValues
    ? t('Đã chuyển {title} đến vị trí {position}.', announcementValues)
    : '';
  return {
    drag,
    press,
    preview,
    pressedId,
    announcement,
    cancel,
    move,
    start,
    pointerMove,
    end,
    consumeClick,
  };
}
