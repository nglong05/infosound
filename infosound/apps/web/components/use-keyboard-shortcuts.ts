'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppRouter as useRouter } from './app-navigation';
import { shortcuts, type ShortcutAction } from '@/lib/keyboard-shortcuts';
import { useAuth } from '@/features/auth/auth-context';
import { usePlayer } from '@/features/player/player-context';

const preferenceKey = 'infosound.keyboard.characters.v1';
const interactive =
  'input,textarea,select,button,a,summary,[contenteditable]:not([contenteditable="false"]),[role="button"],[role="link"],[role="slider"],[role="combobox"],[role="listbox"],[role="menu"],[role="textbox"],[role="checkbox"],[role="radio"],[role="switch"],[role="tab"],[role="tree"]';
const visible = (element: Element) =>
  !element.closest('[hidden],[inert]') && element.getClientRects().length > 0;
function blocked(event: KeyboardEvent) {
  if (
    event.defaultPrevented ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    event.getModifierState('AltGraph') ||
    event.isComposing ||
    event.keyCode === 229 ||
    event.key === 'Process' ||
    event.repeat
  )
    return true;
  if (
    event.composedPath().some((target) => target instanceof Element && target.closest(interactive))
  )
    return true;
  return [
    ...document.querySelectorAll(
      'dialog[open],[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"]',
    ),
  ].some(visible);
}
function eventCode(event: KeyboardEvent) {
  if (event.code) return event.code;
  if (/^[a-z]$/i.test(event.key)) return 'Key' + event.key.toUpperCase();
  if (/^\d$/.test(event.key)) return 'Digit' + event.key;
  return event.key === ' ' ? 'Space' : event.key;
}

/** One root listener dispatches to the same guarded player actions as the controls. */
export function useKeyboardShortcuts(onOpenHelp: () => void) {
  const player = usePlayer(),
    { user, loading } = useAuth(),
    router = useRouter();
  const [charactersEnabled, setEnabled] = useState(true);
  const state = useRef({ player, user, loading, router, onOpenHelp, charactersEnabled });
  state.current = { player, user, loading, router, onOpenHelp, charactersEnabled };
  const setCharactersEnabled = useCallback((enabled: boolean) => {
    setEnabled(enabled);
    try {
      localStorage.setItem(preferenceKey, enabled ? '1' : '0');
    } catch {}
  }, []);
  useEffect(() => {
    try {
      setEnabled(localStorage.getItem(preferenceKey) !== '0');
    } catch {}
  }, []);
  useEffect(() => {
    let prefixUntil = 0,
      focusFrame = 0;
    const reset = () => {
      prefixUntil = 0;
      cancelAnimationFrame(focusFrame);
    };
    const focusSearch = () => {
      state.current.player.closeLyrics();
      const find = () =>
        ['search-query', 'global-query']
          .map((id) => document.getElementById(id))
          .find((element) => element instanceof HTMLInputElement && visible(element)) as
          | HTMLInputElement
          | undefined;
      const existing = find();
      if (existing) {
        existing.focus();
        return;
      }
      state.current.router.push('/search');
      let attempts = 0;
      const wait = () => {
        const input = find();
        if (input) {
          input.focus();
          return;
        }
        if (++attempts < 120) focusFrame = requestAnimationFrame(wait);
      };
      focusFrame = requestAnimationFrame(wait);
    };
    const dispatch = (action: ShortcutAction, digit: number) => {
      const { player: p, user: u, router: r, onOpenHelp: help } = state.current;
      const navigate = (path: string) => {
        p.closeLyrics();
        r.push(path);
      };
      switch (action) {
        case 'play':
          p.toggle();
          break;
        case 'next':
          p.nextTrack();
          break;
        case 'previous':
          p.previousTrack();
          break;
        case 'forward':
          p.seekTo(p.getPlaybackTime() + 5);
          break;
        case 'backward':
          p.seekTo(p.getPlaybackTime() - 5);
          break;
        case 'position':
          p.seekTo((p.duration * digit) / 10);
          break;
        case 'volumeUp':
          p.adjustVolume(0.1);
          break;
        case 'volumeDown':
          p.adjustVolume(-0.1);
          break;
        case 'mute':
          p.toggleMute();
          break;
        case 'shuffle':
          p.toggleShuffle();
          break;
        case 'repeat':
          p.cycleRepeat();
          break;
        case 'queue':
          p.toggleQueue();
          break;
        case 'lyrics':
          p.toggleLyrics();
          break;
        case 'currentTrack':
          navigate('/tracks/' + p.track!.id);
          break;
        case 'search':
          focusSearch();
          break;
        case 'help':
          help();
          break;
        case 'liked':
          navigate('/library/liked');
          break;
        case 'library':
          navigate('/library');
          break;
        case 'history':
          navigate('/history');
          break;
        case 'profile':
          navigate(u ? '/profiles/' + u.id : '/login');
          break;
        case 'home':
          navigate('/');
          break;
      }
    };
    const keydown = (event: KeyboardEvent) => {
      if (blocked(event)) {
        reset();
        return;
      }
      const code = eventCode(event),
        characters = /^(Key|Digit|Numpad)/.test(code);
      if (characters && !state.current.charactersEnabled) {
        reset();
        return;
      }
      cancelAnimationFrame(focusFrame);
      const sequence = prefixUntil > performance.now() && !event.shiftKey;
      prefixUntil = 0;
      if (code === 'KeyG' && !event.shiftKey) {
        event.preventDefault();
        prefixUntil = performance.now() + 1200;
        return;
      }
      const digit = /^Digit[0-9]$/.test(code) ? Number(code.slice(-1)) : -1;
      const row = shortcuts.find(
        (item) =>
          !!item.sequence === sequence &&
          !!item.shift === event.shiftKey &&
          (item.code === code || (item.code === 'Digit' && digit >= 0)),
      );
      if (!row) return;
      if (row.id === 'profile' && state.current.loading) return;
      const p = state.current.player;
      if (row.track && (!p.track || p.pending)) return;
      if (['forward', 'backward', 'position'].includes(row.id) && p.duration <= 0) return;
      event.preventDefault();
      dispatch(row.id, digit);
    };
    const onFocus = (event: FocusEvent) => {
      prefixUntil = 0;
      const target = event.target;
      if (!(target instanceof HTMLElement && ['main-content', 'page-content'].includes(target.id)))
        cancelAnimationFrame(focusFrame);
    };
    window.addEventListener('keydown', keydown);
    window.addEventListener('blur', reset);
    document.addEventListener('focusin', onFocus);
    document.addEventListener('pointerdown', reset);
    document.addEventListener('visibilitychange', reset);
    return () => {
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('blur', reset);
      document.removeEventListener('focusin', onFocus);
      document.removeEventListener('pointerdown', reset);
      document.removeEventListener('visibilitychange', reset);
      cancelAnimationFrame(focusFrame);
    };
  }, []);
  return { charactersEnabled, setCharactersEnabled };
}
