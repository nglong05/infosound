'use client';
import { useEffect, useRef, useState, useCallback, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { usePathname } from 'next/navigation';
import Link from '@/components/app-navigation';
import { api, time, type Track, ApiError } from '@/lib/api';
import { Icon } from '@/components/icons';
import { useI18n } from '@/components/locale-provider';
import { PlaybackQueue } from '@/components/playback-queue';
import {
  appendPlaybackOrder,
  reorderPlaybackOrder,
  removePlaybackOrder,
  createPlaybackOrder,
  movePlaybackOrder,
  setPlaybackShuffle,
  type PlaybackOrder,
  type RepeatMode,
} from '@/lib/playback-order';
import { ListeningProgress, type ListenGrant } from '@/lib/listening-progress';
import { useAuth } from '@/features/auth/auth-context';
import { useToast } from '@/shared/feedback/toast-context';
import { PlayerContext } from './player-context';
import { PlayerArtwork } from './player-visuals';
import { usePlaybackMotion } from './use-playback-motion';

export function PlayerProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const pathname = usePathname();
  const authPage = [
    'login',
    'register',
    'verify-email',
    'forgot-password',
    'reset-password',
    'oauth',
  ].includes(pathname.split('/')[1]);
  const motionEnabled = usePlaybackMotion();
  const { user } = useAuth();
  const toast = useToast();
  const queueOwner = useRef(user?.id);
  const audio = useRef<HTMLAudioElement>(null);
  const listening = useRef<ListeningProgress | null>(null);
  const listenRequest = useRef<AbortController | null>(null);
  const [track, setTrack] = useState<Track | null>(null);
  const trackRef = useRef<Track | null>(null);
  const sourceQueue = useRef<Track[]>([]);
  const [order, setOrder] = useState<PlaybackOrder>({ ids: [], index: 0 });
  const orderRef = useRef(order);
  const [shuffle, setShuffle] = useState(false);
  const shuffleRef = useRef(false);
  const [repeat, setRepeat] = useState<RepeatMode>('off');
  const repeatRef = useRef<RepeatMode>('off');
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [lyricsOpen, setLyricsOpen] = useState(false);
  const savedScroll = useRef(0);
  const lyricsOpenRef = useRef(false);
  const closeLyrics = useCallback(() => {
    if (!lyricsOpenRef.current) return;
    lyricsOpenRef.current = false;
    setLyricsOpen(false);
    requestAnimationFrame(() => window.scrollTo({ top: savedScroll.current, behavior: 'instant' }));
  }, []);
  const getPlaybackTime = useCallback((expectedTrack?: Pick<Track, 'id' | 'sourceVersion'>) => {
    const active = trackRef.current;
    if (
      expectedTrack &&
      (active?.id !== expectedTrack.id || active.sourceVersion !== expectedTrack.sourceVersion)
    )
      return 0;
    const seconds = audio.current?.currentTime ?? 0;
    return Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  }, []);
  const seekTo = useCallback((seconds: number) => {
    const el = audio.current;
    if (
      !el ||
      !trackRef.current ||
      pendingRef.current ||
      mediaRequest.current !== request.current ||
      !Number.isFinite(seconds) ||
      !Number.isFinite(el.duration) ||
      el.duration <= 0
    )
      return;
    const value = Math.max(0, Math.min(seconds, el.duration));
    try {
      listening.current?.interrupt();
      el.currentTime = value;
      setCurrent(value);
    } catch {
      setError('Không thể phát tệp. Nhấn thử lại.');
    }
  }, []);
  const [volume, setVolume] = useState(0.75);
  const lastVolume = useRef(0.75);
  const [error, setError] = useState('');
  const [showQueue, setShowQueue] = useState(false);
  const closeQueue = useCallback(() => setShowQueue(false), []);
  const setVolumeLevel = (value: number) => {
    const level = Math.max(0, Math.min(1, value));
    if (level > 0) lastVolume.current = level;
    setVolume(level);
  };
  const adjustVolume = (delta: number) =>
    setVolume((previous) => {
      const level = Math.max(0, Math.min(1, previous + delta));
      if (level > 0) lastVolume.current = level;
      return level;
    });
  const toggleMute = () =>
    setVolume((previous) => {
      if (previous > 0) {
        lastVolume.current = previous;
        return 0;
      }
      return lastVolume.current || 0.75;
    });
  const toggleQueue = () => {
    if (!pendingRef.current && trackRef.current) setShowQueue((value) => !value);
  };
  const toggleLyrics = () => {
    if (pendingRef.current || !trackRef.current) return;
    if (lyricsOpenRef.current) closeLyrics();
    else {
      lyricsOpenRef.current = true;
      savedScroll.current = window.scrollY;
      setShowQueue(false);
      setLyricsOpen(true);
    }
  };
  const request = useRef(0);
  const mediaRequest = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const refreshed = useRef(false);
  const expires = useRef(0);
  const attempt = useRef<{
    track: Track;
    seek: number;
    commit?: () => void;
    expectedSourceVersion?: number;
  } | null>(null);
  const commitOrder = (value: PlaybackOrder) => {
    orderRef.current = value;
    setOrder(value);
  };
  const finishPending = () => {
    pendingRef.current = false;
    setPending(false);
  };
  const stop = () => {
    listenRequest.current?.abort();
    listenRequest.current = null;
    listening.current = null;
    request.current++;
    mediaRequest.current = 0;
    controller.current?.abort();
    controller.current = null;
    const el = audio.current;
    if (el) {
      el.onloadedmetadata = null;
      el.pause();
      el.removeAttribute('src');
      el.load();
    }
    setTrack(null);
    trackRef.current = null;
    sourceQueue.current = [];
    commitOrder({ ids: [], index: 0 });
    attempt.current = null;
    shuffleRef.current = false;
    setShuffle(false);
    repeatRef.current = 'off';
    setRepeat('off');
    closeLyrics();
    setShowQueue(false);
    setBuffering(false);
    finishPending();
    refreshed.current = false;
    expires.current = 0;
    setPlaying(false);
    setCurrent(0);
    setDuration(0);
    setError('');
  };
  // All starts, repeats and signed-URL retries share one guarded media pipeline.
  const loadTrack = async (
    next: Track,
    seek = 0,
    commit?: () => void,
    preserveListen = false,
    expectedSourceVersion?: number,
  ) => {
    if (!preserveListen) {
      listenRequest.current?.abort();
      listenRequest.current = null;
      listening.current = null;
    }
    listening.current?.interrupt();
    const id = ++request.current;
    mediaRequest.current = 0;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    attempt.current = { track: next, seek, commit, expectedSourceVersion };
    pendingRef.current = true;
    setPending(true);
    const previous = audio.current;
    if (previous) {
      previous.onloadedmetadata = null;
      previous.pause();
    }
    setPlaying(false);
    setError('');
    setBuffering(true);
    try {
      const data = await api<{
        url: string;
        expiresAt: string;
        contentType?: string;
        track?: Track;
        listen?: ListenGrant;
      }>(`/tracks/${next.id}/playback`, { signal: abort.signal, auth: !!user });
      if (id !== request.current) return;
      const el = audio.current;
      if (!el) return;
      const latest = data.track?.id === next.id ? { ...next, ...data.track } : next;
      if (
        expectedSourceVersion !== undefined &&
        (data.track?.id !== next.id || data.track.sourceVersion !== expectedSourceVersion)
      )
        throw new Error(
          'Âm thanh đã được thay thế ở phiên khác. Tải lại trang trước khi tiếp tục.',
        );
      if (
        listening.current &&
        (listening.current.trackId !== latest.id ||
          listening.current.sourceVersion !== latest.sourceVersion)
      ) {
        listenRequest.current?.abort();
        listenRequest.current = null;
        listening.current = null;
      }
      if (
        data.listen &&
        typeof data.listen.token === 'string' &&
        Number.isFinite(data.listen.minimumSeconds) &&
        data.listen.minimumSeconds > 0 &&
        Number.isInteger(latest.sourceVersion)
      ) {
        if (listening.current) listening.current.renew(data.listen, performance.now());
        else
          listening.current = new ListeningProgress(
            latest.id,
            latest.sourceVersion!,
            data.listen,
            performance.now(),
          );
      }
      if (latest.outputCodec === 'flac' && !el.canPlayType('audio/flac'))
        throw new Error(
          'Trình duyệt này không hỗ trợ FLAC. Hãy dùng trình duyệt hỗ trợ để nghe tệp gốc.',
        );
      commit?.();
      setTrack(latest);
      trackRef.current = latest;
      expires.current = Date.parse(data.expiresAt);
      attempt.current = { track: latest, seek, expectedSourceVersion };
      setCurrent(seek);
      setDuration(0);
      mediaRequest.current = id;
      el.onloadedmetadata = () => {
        if (id !== request.current) return;
        const length = Number.isFinite(el.duration) ? el.duration : 0;
        el.currentTime = length ? Math.min(seek, length) : seek;
        setCurrent(el.currentTime);
        setDuration(length);
        finishPending();
        void el.play().catch(() => {
          if (id !== request.current) return;
          setPlaying(false);
          setBuffering(false);
          setError('Nhấn Phát để bắt đầu nghe trong trình duyệt.');
        });
      };
      el.crossOrigin = 'anonymous';
      el.src = data.url;
      el.load();
    } catch (e) {
      if (id !== request.current) return;
      finishPending();
      setBuffering(false);
      setPlaying(false);
      setError((e as Error).message);
    }
  };
  const discardFailedQueueTransition = () => {
    const failed = attempt.current;
    if (!failed?.commit) return;
    const active = trackRef.current;
    attempt.current = active
      ? {
          track: active,
          seek: audio.current?.currentTime || 0,
          expectedSourceVersion:
            failed.track.id === active.id ? failed.expectedSourceVersion : undefined,
        }
      : null;
    setError('');
  };
  const startQueue = async (next: Track, list: Track[]) => {
    if (pendingRef.current || next.available === false) return;
    const unique = Array.from(
      new Map(
        list.filter((item) => item.available !== false).map((item) => [item.id, item]),
      ).values(),
    );
    if (!unique.some((item) => item.id === next.id)) unique.unshift(next);
    const selected = unique.slice(0, 500);
    if (!selected.some((item) => item.id === next.id)) {
      selected.pop();
      selected.unshift(next);
    }
    refreshed.current = false;
    return loadTrack(next, 0, () => {
      sourceQueue.current = selected;
      commitOrder(
        createPlaybackOrder(
          selected.map((item) => item.id),
          next.id,
          shuffleRef.current,
        ),
      );
    });
  };
  const play = (next: Track) => startQueue(next, [next]);
  const playQueue = (next: Track, list: Track[]) => startQueue(next, list);
  const enqueue = (next: Track) => {
    if (pendingRef.current || next.available === false || !next.id) return;
    if (sourceQueue.current.some((item) => item.id === next.id)) {
      toast('Bài hát đã có trong hàng đợi.');
      return;
    }
    if (sourceQueue.current.length >= 500) {
      toast(t('Hàng đợi đã đầy. Tối đa {count} bài hát.', { count: 500 }), 'error');
      return;
    }
    discardFailedQueueTransition();
    sourceQueue.current = [...sourceQueue.current, next];
    const value = trackRef.current ? orderRef.current : { ...orderRef.current, index: -1 };
    commitOrder(appendPlaybackOrder(value, next.id));
    toast('Đã thêm vào hàng đợi.');
  };
  const reorderQueue = (id: string, toIndex: number) => {
    if (pendingRef.current) return;
    const value = reorderPlaybackOrder(orderRef.current, id, toIndex);
    if (!value) return;
    discardFailedQueueTransition();
    const byId = new Map(sourceQueue.current.map((item) => [item.id, item]));
    sourceQueue.current = value.ids.flatMap((key) => {
      const item = byId.get(key);
      return item ? [item] : [];
    });
    commitOrder(value);
  };
  const removeQueueTrack = (id: string) => {
    if (pendingRef.current) return;
    const value = removePlaybackOrder(orderRef.current, id);
    if (!value) return;
    if (!value.ids.length) {
      stop();
      return;
    }
    const remaining = sourceQueue.current.filter((item) => item.id !== id);
    if (trackRef.current?.id === id) {
      const next = remaining.find((item) => item.id === value.ids[value.index]);
      if (!next) return;
      refreshed.current = false;
      void loadTrack(next, 0, () => {
        sourceQueue.current = remaining;
        commitOrder(value);
      });
    } else {
      discardFailedQueueTransition();
      sourceQueue.current = remaining;
      commitOrder(value);
    }
  };
  const playAt = async (next: Track, seconds: number) => {
    if (
      !Number.isFinite(seconds) ||
      !Number.isInteger(next.sourceVersion) ||
      (next.sourceVersion ?? 0) < 1
    )
      return;
    if (pendingRef.current) return;
    const active = trackRef.current,
      el = audio.current;
    if (
      active?.id === next.id &&
      active.sourceVersion === next.sourceVersion &&
      mediaRequest.current === request.current &&
      el &&
      Number.isFinite(el.duration) &&
      el.duration > 0
    ) {
      if (attempt.current?.track.id === next.id)
        attempt.current.expectedSourceVersion = next.sourceVersion;
      seekTo(seconds);
      return;
    }
    refreshed.current = false;
    return loadTrack(
      next,
      Math.max(0, seconds),
      () => {
        sourceQueue.current = [next];
        commitOrder(createPlaybackOrder([next.id], next.id, shuffleRef.current));
      },
      false,
      next.sourceVersion,
    );
  };
  const move = (offset: 1 | -1) => {
    if (pendingRef.current || !trackRef.current) return;
    const value = movePlaybackOrder(
      orderRef.current,
      offset,
      repeatRef.current === 'all',
      shuffleRef.current,
    );
    const next = value && sourceQueue.current.find((item) => item.id === value.ids[value.index]);
    if (next && value) {
      refreshed.current = false;
      void loadTrack(next, 0, () => commitOrder(value));
    } else if (offset < 0 && audio.current) {
      listening.current?.interrupt();
      audio.current.currentTime = 0;
      setCurrent(0);
    }
  };
  const selectQueueTrack = (item: Track) => {
    if (pendingRef.current) return;
    const index = orderRef.current.ids.indexOf(item.id);
    const next = sourceQueue.current.find((value) => value.id === item.id);
    if (index < 0 || !next) return;
    refreshed.current = false;
    const value = { ...orderRef.current, index };
    void loadTrack(next, 0, () => commitOrder(value));
  };
  const toggleShuffle = () => {
    if (pendingRef.current || !trackRef.current) return;
    const enabled = !shuffleRef.current;
    shuffleRef.current = enabled;
    setShuffle(enabled);
    commitOrder(
      setPlaybackShuffle(
        orderRef.current,
        sourceQueue.current.map((item) => item.id),
        trackRef.current.id,
        enabled,
      ),
    );
  };
  const cycleRepeat = () => {
    if (pendingRef.current || !trackRef.current) return;
    const value = repeatRef.current === 'off' ? 'all' : repeatRef.current === 'all' ? 'one' : 'off';
    repeatRef.current = value;
    setRepeat(value);
  };
  useEffect(() => {
    if (queueOwner.current === user?.id) return;
    queueOwner.current = user?.id;
    stop();
  }, [user?.id]);
  useEffect(() => {
    window.addEventListener('infosound-logout', stop);
    return () => {
      window.removeEventListener('infosound-logout', stop);
      request.current++;
      mediaRequest.current = 0;
      controller.current?.abort();
      listenRequest.current?.abort();
      listening.current = null;
    };
  }, []);
  useEffect(() => {
    if (audio.current) audio.current.volume = volume;
  }, [volume]);
  const toggle = () => {
    const el = audio.current;
    if (!el || !track || pendingRef.current) return;
    if (playing) {
      el.pause();
      return;
    }
    const seek = el.ended ? 0 : el.currentTime;
    if (mediaRequest.current !== request.current || Date.now() > expires.current - 5000) {
      refreshed.current = false;
      void loadTrack(track, seek, undefined, !el.ended, attempt.current?.expectedSourceVersion);
    } else {
      if (el.ended) {
        refreshed.current = false;
        void loadTrack(track, 0);
        return;
      }
      const id = request.current;
      void el.play().catch(() => {
        if (id === request.current) setError('Không thể phát tệp. Nhấn thử lại.');
      });
    }
  };
  const handleEnded = () => {
    if (pendingRef.current || mediaRequest.current !== request.current || !trackRef.current) return;
    sampleListening(true);
    setPlaying(false);
    setBuffering(false);
    if (repeatRef.current === 'one') {
      refreshed.current = false;
      void loadTrack(trackRef.current);
      return;
    }
    move(1);
  };
  const handleError = () => {
    if (mediaRequest.current !== request.current || !trackRef.current) return;
    if (!refreshed.current) {
      refreshed.current = true;
      void loadTrack(
        trackRef.current,
        audio.current?.currentTime || 0,
        undefined,
        true,
        attempt.current?.expectedSourceVersion,
      );
    } else {
      finishPending();
      setBuffering(false);
      setPlaying(false);
      setError(
        'Không thể giải mã hoặc tải tệp âm thanh. Hãy thử lại hoặc dùng trình duyệt hỗ trợ định dạng này.',
      );
    }
  };
  const retry = () => {
    const value = attempt.current;
    if (!value) return;
    refreshed.current = false;
    const seek =
      mediaRequest.current === request.current &&
      trackRef.current?.id === value.track.id &&
      audio.current?.error
        ? audio.current.currentTime
        : value.seek;
    void loadTrack(value.track, seek, value.commit, true, value.expectedSourceVersion);
  };
  const sampleListening = (ended = false) => {
    const el = audio.current;
    const progress = listening.current;
    if (
      !el ||
      !progress ||
      pendingRef.current ||
      mediaRequest.current !== request.current ||
      progress.trackId !== trackRef.current?.id ||
      progress.sourceVersion !== trackRef.current?.sourceVersion
    )
      return;
    const now = performance.now();
    progress.sample(
      el.currentTime,
      now,
      el.playbackRate,
      ended || (!el.paused && !el.seeking && !el.ended && el.readyState >= 3),
    );
    if (!progress.ready(now)) return;
    progress.inFlight = true;
    progress.attempts++;
    const abort = new AbortController();
    listenRequest.current = abort;
    void api<{ counted: boolean }>(`/tracks/${progress.trackId}/listens`, {
      method: 'POST',
      body: { token: progress.grant.token },
      signal: abort.signal,
      auth: !!user,
    })
      .then((result) => {
        if (listening.current !== progress) return;
        progress.done = true;
        if (user) void queryClient.invalidateQueries({ queryKey: ['history'] });
        if (result.counted) {
          void queryClient.invalidateQueries({ queryKey: ['tracks'] });
          void queryClient.invalidateQueries({ queryKey: ['artists'] });
          void queryClient.invalidateQueries({ queryKey: ['track-community', progress.trackId] });
        }
      })
      .catch((reason) => {
        if (listening.current !== progress || abort.signal.aborted) return;
        const status = reason instanceof ApiError ? reason.status : 0;
        if (status === 0 || status === 409 || status === 429 || status >= 500)
          progress.retryAt = performance.now() + (progress.attempts === 1 ? 2000 : 8000);
        else progress.done = true;
      })
      .finally(() => {
        progress.inFlight = false;
        if (listenRequest.current === abort) listenRequest.current = null;
      });
  };
  const repeatLabel =
    repeat === 'off' ? 'Tắt lặp' : repeat === 'all' ? 'Lặp danh sách' : 'Lặp một bài';
  const nextRepeatLabel =
    repeat === 'off' ? 'Lặp danh sách' : repeat === 'all' ? 'Lặp một bài' : 'Tắt lặp';
  const repeatDescription = t('Chế độ lặp: {mode}. Chuyển sang {next}.', {
    mode: t(repeatLabel),
    next: t(nextRepeatLabel),
  });
  const nextDisabled =
    !track || pending || (repeat !== 'all' && order.index >= order.ids.length - 1);
  const queue = order.ids
    .map((id) => sourceQueue.current.find((item) => item.id === id))
    .filter((item): item is Track => !!item);
  return (
    <PlayerContext.Provider
      value={{
        track,
        playing,
        buffering,
        motionEnabled,
        pending,
        current,
        duration,
        lyricsOpen,
        closeLyrics,
        seekTo,
        getPlaybackTime,
        toggle,
        nextTrack: () => move(1),
        previousTrack: () => move(-1),
        adjustVolume,
        toggleMute,
        toggleShuffle,
        cycleRepeat,
        toggleQueue,
        toggleLyrics,
        play,
        playQueue,
        enqueue,
        playAt,
        stop,
      }}
    >
      {children}
      <audio
        ref={audio}
        crossOrigin="anonymous"
        preload="metadata"
        onPlay={() => {
          if (mediaRequest.current !== request.current) return;
          listening.current?.interrupt();
          setPlaying(true);
          setBuffering(false);
          setError('');
        }}
        onPause={() => {
          listening.current?.interrupt();
          setPlaying(false);
        }}
        onTimeUpdate={() => {
          if (mediaRequest.current === request.current) {
            setCurrent(audio.current?.currentTime || 0);
            sampleListening();
          }
        }}
        onSeeking={() => listening.current?.interrupt()}
        onSeeked={() => listening.current?.interrupt()}
        onPlaying={() => {
          if (mediaRequest.current !== request.current) return;
          listening.current?.interrupt();
          setPlaying(true);
          setBuffering(false);
        }}
        onWaiting={() => {
          if (mediaRequest.current === request.current) {
            listening.current?.interrupt();
            setBuffering(true);
          }
        }}
        onStalled={() => {
          if (mediaRequest.current === request.current) {
            listening.current?.interrupt();
            setBuffering(true);
          }
        }}
        onCanPlay={() => {
          if (mediaRequest.current === request.current) setBuffering(false);
        }}
        onEnded={handleEnded}
        onError={handleError}
      />
      <PlaybackQueue
        open={showQueue && (!!track || !authPage)}
        tracks={queue}
        currentTrackId={track?.id}
        playing={playing}
        pending={pending}
        onClose={closeQueue}
        onSelect={selectQueueTrack}
        onMove={reorderQueue}
        onRemove={removeQueueTrack}
      />
      {(track || !authPage) && (
        <section className={'player ' + (!track ? 'idle' : '')} aria-label={t('Trình phát nhạc')}>
          <div className="player-track">
            <PlayerArtwork track={track} />
            <div>
              {track ? (
                <Link href={'/tracks/' + track.id}>{track.title}</Link>
              ) : (
                <strong>{t('Chưa có bài đang phát')}</strong>
              )}
              <p>{track?.author?.displayName || t('Chọn một giai điệu để bắt đầu')}</p>
            </div>
          </div>
          <div className="player-center">
            <div className="transport">
              <button
                type="button"
                className="icon-button playback-mode"
                data-active={shuffle}
                disabled={!track || pending}
                aria-label={t('Trộn nhạc')}
                title={t('Trộn nhạc')}
                aria-pressed={shuffle}
                onClick={toggleShuffle}
              >
                <Icon name="shuffle" />
                {shuffle && <span className="playback-mode-dot" />}
              </button>
              <button
                className="icon-button"
                disabled={!track || pending}
                aria-label={t('Bài trước')}
                onClick={() => move(-1)}
              >
                <Icon name="previous" size={18} />
              </button>
              <button
                className="play-button"
                disabled={!track || pending}
                aria-label={playing ? t('Tạm dừng') : t('Phát')}
                onClick={toggle}
              >
                <Icon name={playing ? 'pause' : 'play'} size={21} />
              </button>
              <button
                className="icon-button"
                disabled={nextDisabled}
                aria-label={t('Bài tiếp theo')}
                onClick={() => move(1)}
              >
                <Icon name="next" size={18} />
              </button>
              <button
                type="button"
                className="icon-button playback-mode"
                data-active={repeat !== 'off'}
                data-repeat={repeat}
                disabled={!track || pending}
                aria-label={repeatDescription}
                title={repeatDescription}
                aria-pressed={repeat !== 'off'}
                onClick={cycleRepeat}
              >
                <Icon name={repeat === 'one' ? 'repeat-one' : 'repeat'} />
                {repeat !== 'off' && <span className="playback-mode-dot" />}
              </button>
              {buffering && (
                <span role="status" className="player-loading">
                  {t('Đang tải…')}
                </span>
              )}
            </div>
            <div className="seek">
              <span>{time(current)}</span>
              <input
                aria-label={t('Tua bài hát')}
                type="range"
                min={0}
                max={duration || 1}
                step={0.1}
                value={current}
                disabled={!track || !duration || pending}
                onChange={(e) => seekTo(Number(e.target.value))}
              />
              <span>{time(duration)}</span>
            </div>
          </div>
          <div className="player-options">
            <button
              type="button"
              id="lyrics-toggle"
              className="icon-button lyrics-toggle"
              disabled={!track || pending}
              aria-label={t(lyricsOpen ? 'Đóng lời bài hát' : 'Lời bài hát')}
              title={t('Lời bài hát')}
              aria-pressed={lyricsOpen}
              aria-controls="main-content"
              onClick={toggleLyrics}
            >
              <Icon name="microphone" />
            </button>
            <span className="quality-mark">
              {track?.outputCodec?.toUpperCase() || t('NGHE & KHÁM PHÁ')}
            </span>
            <button
              type="button"
              id="queue-toggle"
              className="icon-button"
              aria-label={t('Hàng đợi phát')}
              aria-controls="playback-queue"
              aria-expanded={showQueue}
              onClick={() => setShowQueue((v) => !v)}
            >
              <Icon name="playlist" />
            </button>
            <Icon name="volume" size={18} />
            <input
              aria-label={t('Âm lượng')}
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={volume}
              onChange={(e) => setVolumeLevel(Number(e.target.value))}
            />
          </div>
        </section>
      )}
      {error && (track || !authPage) && (
        <div className="player-error" role="alert">
          {t(error)}
          <button onClick={retry} disabled={pending}>
            {t('Thử lại')}
          </button>
        </div>
      )}
    </PlayerContext.Provider>
  );
}
