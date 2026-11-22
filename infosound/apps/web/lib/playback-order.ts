/** Session-only traversal. Source playlist order is never mutated. */
export type PlaybackOrder = { ids: string[]; index: number };
export type RepeatMode = 'off' | 'all' | 'one';

/** Editing is session-only and preserves the active ID (or -1 for an idle queue). */
export function appendPlaybackOrder(order: PlaybackOrder, id: string): PlaybackOrder {
  if (!id || order.ids.includes(id)) return order;
  return { ids: [...order.ids, id], index: order.index };
}

export function reorderPlaybackOrder(
  order: PlaybackOrder,
  id: string,
  toIndex: number,
): PlaybackOrder | null {
  const from = order.ids.indexOf(id);
  if (
    from < 0 ||
    !Number.isInteger(toIndex) ||
    toIndex < 0 ||
    toIndex >= order.ids.length ||
    from === toIndex
  )
    return null;
  const currentId = order.ids[order.index],
    ids = [...order.ids];
  ids.splice(from, 1);
  ids.splice(toIndex, 0, id);
  return { ids, index: currentId ? ids.indexOf(currentId) : -1 };
}

export function removePlaybackOrder(order: PlaybackOrder, id: string): PlaybackOrder | null {
  const removed = order.ids.indexOf(id);
  if (removed < 0) return null;
  const currentId = order.ids[order.index],
    ids = order.ids.filter((value) => value !== id);
  const index =
    currentId === id ? Math.min(removed, ids.length - 1) : currentId ? ids.indexOf(currentId) : -1;
  return { ids, index };
}

function shuffled(ids: readonly string[], random: () => number): string[] {
  const result = [...ids];
  for (let index = result.length - 1; index > 0; index--) {
    const target = Math.floor(random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

export function createPlaybackOrder(
  source: readonly string[],
  currentId: string,
  shuffle: boolean,
  random: () => number = Math.random,
): PlaybackOrder {
  const ids = Array.from(new Set(source));
  if (!ids.includes(currentId)) ids.unshift(currentId);
  if (shuffle)
    return {
      ids: [
        currentId,
        ...shuffled(
          ids.filter((id) => id !== currentId),
          random,
        ),
      ],
      index: 0,
    };
  return { ids, index: ids.indexOf(currentId) };
}

export function setPlaybackShuffle(
  _order: PlaybackOrder,
  source: readonly string[],
  currentId: string,
  enabled: boolean,
  random: () => number = Math.random,
): PlaybackOrder {
  return createPlaybackOrder(source, currentId, enabled, random);
}

export function movePlaybackOrder(
  order: PlaybackOrder,
  offset: 1 | -1,
  repeatAll: boolean,
  shuffle: boolean,
  random: () => number = Math.random,
): PlaybackOrder | null {
  if (!order.ids.length) return null;
  const index = order.index + offset;
  if (index >= 0 && index < order.ids.length) return { ids: order.ids, index };
  if (!repeatAll) return null;
  if (offset < 0) return { ids: order.ids, index: order.ids.length - 1 };
  const ids = shuffle ? shuffled(order.ids, random) : order.ids;
  // A new shuffled cycle must not immediately repeat the track that just ended.
  if (shuffle && ids.length > 1 && ids[0] === order.ids[order.index]) {
    const target = 1 + Math.floor(random() * (ids.length - 1));
    [ids[0], ids[target]] = [ids[target], ids[0]];
  }
  return { ids, index: 0 };
}
