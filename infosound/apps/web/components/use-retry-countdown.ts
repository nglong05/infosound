'use client';

import { useCallback, useEffect, useState } from 'react';

const deadlines = new Map<string, number>();
const listeners = new Set<() => void>();
export function remainingRetrySeconds(deadline: number, now = Date.now()): number {
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}
function remaining(userId: string | null): number {
  if (!userId) return 0;
  const deadline = deadlines.get(userId) || 0;
  const seconds = remainingRetrySeconds(deadline);
  return seconds;
}

/** Share the user's short Studio retry deadline across routes, without persistent storage. */
export function useRetryCountdown(userId: string | null) {
  const [, refreshClock] = useState(0);
  const seconds = remaining(userId),
    running = seconds > 0;
  useEffect(() => {
    const update = () => {
      const now = Date.now();
      for (const [id, deadline] of deadlines) if (deadline <= now) deadlines.delete(id);
      refreshClock((revision) => revision + 1);
    };
    update();
    listeners.add(update);
    const timer = running ? window.setInterval(update, 250) : undefined;
    window.addEventListener('focus', update);
    document.addEventListener('visibilitychange', update);
    return () => {
      if (timer !== undefined) window.clearInterval(timer);
      listeners.delete(update);
      window.removeEventListener('focus', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, [userId, running]);
  const wait = useCallback(
    (value: number) => {
      if (!userId) return;
      const duration = Number.isFinite(value) && value > 0 ? Math.ceil(value) : 0;
      if (duration) deadlines.set(userId, Date.now() + duration * 1000);
      else deadlines.delete(userId);
      for (const listener of listeners) listener();
    },
    [userId],
  );
  const waiting = useCallback(() => remaining(userId) > 0, [userId]);
  // Read the current clock: tab suspension or a route change must not add waiting time.
  return { seconds, wait, waiting };
}
