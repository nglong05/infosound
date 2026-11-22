'use client';
import { createContext, useContext } from 'react';
import type { Track } from '@/lib/api';

export type Player = {
  track: Track | null;
  playing: boolean;
  buffering: boolean;
  motionEnabled: boolean;
  pending: boolean;
  current: number;
  duration: number;
  lyricsOpen: boolean;
  closeLyrics: () => void;
  seekTo: (seconds: number) => void;
  getPlaybackTime: (expectedTrack?: Pick<Track, 'id' | 'sourceVersion'>) => number;
  toggle: () => void;
  nextTrack: () => void;
  previousTrack: () => void;
  adjustVolume: (delta: number) => void;
  toggleMute: () => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  toggleQueue: () => void;
  toggleLyrics: () => void;
  play: (track: Track) => Promise<void>;
  playQueue: (track: Track, queue: Track[]) => Promise<void>;
  enqueue: (track: Track) => void;
  playAt: (track: Track, seconds: number) => Promise<void>;
  stop: () => void;
};

export const PlayerContext = createContext<Player | null>(null);

export const usePlayer = () => {
  const value = useContext(PlayerContext);
  if (!value) throw new Error('Player provider missing');
  return value;
};
