'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, time } from '@/lib/api';
import { activeLyricIndex, type TrackLyricsResponse } from '@/lib/lyrics';
import { useI18n } from './locale-provider';
import { usePlayer } from '@/features/player/player-context';
import { Icon } from './icons';
import { Artwork } from './common';
import { lockBodyScroll } from '@/lib/body-scroll-lock';

export function LyricsScreen() {
  const { t } = useI18n();
  const {
    track,
    playing,
    pending,
    current,
    duration,
    motionEnabled,
    seekTo,
    getPlaybackTime,
    closeLyrics,
  } = usePlayer();
  const title = useRef<HTMLHeadingElement>(null);
  const screen = useRef<HTMLElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const lineButtons = useRef(new Map<number, HTMLButtonElement>());
  const [active, setActive] = useState(-1);
  const [following, setFollowing] = useState(true);
  const [activeVisible, setActiveVisible] = useState(true);
  const [syncLeft, setSyncLeft] = useState<number | null>(null);
  const activeRef = useRef(-1);
  activeRef.current = active;
  const scrollFrame = useRef(0);
  const positioned = useRef(false);
  const query = useQuery({
    queryKey: ['track-lyrics', track?.id],
    queryFn: ({ signal }) =>
      api<TrackLyricsResponse>(`/tracks/${track!.id}/lyrics`, { auth: !!track, signal }),
    enabled: !!track,
    staleTime: 0,
    refetchInterval: 30_000,
  });
  // A cached/signed old audio version must never follow lyrics for a replacement.
  const lines =
    query.data?.sourceVersion === track?.sourceVersion ? query.data?.lyrics?.lines : undefined;
  const checkActiveVisible = useCallback(() => {
    const container = viewport.current,
      button = lineButtons.current.get(activeRef.current);
    if (!container || !button) {
      setActiveVisible(true);
      return;
    }
    const bounds = container.getBoundingClientRect(),
      line = button.getBoundingClientRect();
    setActiveVisible(line.bottom > bounds.top + 16 && line.top < bounds.bottom - 16);
  }, []);
  const onScroll = () => {
    if (scrollFrame.current) return;
    scrollFrame.current = requestAnimationFrame(() => {
      scrollFrame.current = 0;
      checkActiveVisible();
    });
  };
  const resumeFollowing = () => {
    if (lines) setActive(activeLyricIndex(lines, getPlaybackTime() * 1000));
    setFollowing(true);
  };

  useEffect(() => {
    title.current?.focus({ preventScroll: true });
    const unlock = lockBodyScroll();
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault();
        closeLyrics();
      }
    };
    window.addEventListener('keydown', escape);
    return () => {
      unlock();
      window.removeEventListener('keydown', escape);
      cancelAnimationFrame(scrollFrame.current);
      requestAnimationFrame(() => {
        if (
          !document.querySelector('dialog[open]') &&
          (!document.activeElement || document.activeElement === document.body)
        )
          document.getElementById('lyrics-toggle')?.focus({ preventScroll: true });
      });
    };
  }, [closeLyrics]);
  useEffect(() => {
    positioned.current = false;
    setFollowing(true);
    setActive(-1);
    setActiveVisible(true);
  }, [track?.id]);
  useEffect(() => {
    setActive(lines ? activeLyricIndex(lines, current * 1000) : -1);
  }, [lines, current]);
  // Read the existing audio clock; update React only when the active cue changes.
  // Browser rAF pauses in background tabs; the next frame catches up on return.
  useEffect(() => {
    if (!playing || !lines) return;
    let frame = 0,
      lastSample = 0;
    const sample = (now: number) => {
      if (now - lastSample >= 50) {
        lastSample = now;
        const index = activeLyricIndex(lines, getPlaybackTime() * 1000);
        setActive((previous) => (previous === index ? previous : index));
      }
      frame = requestAnimationFrame(sample);
    };
    frame = requestAnimationFrame(sample);
    return () => cancelAnimationFrame(frame);
  }, [lines, playing, getPlaybackTime]);
  useEffect(() => {
    if (!following || !lines) return;
    const container = viewport.current;
    const button = lineButtons.current.get(Math.max(0, active));
    if (!container || !button) return;
    const target =
      container.scrollTop +
      button.getBoundingClientRect().top -
      container.getBoundingClientRect().top -
      container.clientHeight * 0.42 +
      button.clientHeight / 2;
    container.scrollTo({
      top: Math.max(0, target),
      behavior: positioned.current && motionEnabled ? 'smooth' : 'auto',
    });
    positioned.current = true;
  }, [active, following, lines, motionEnabled]);
  useEffect(() => {
    checkActiveVisible();
    const container = viewport.current,
      button = lineButtons.current.get(active);
    const observer = new ResizeObserver(checkActiveVisible);
    if (container) observer.observe(container);
    if (button) observer.observe(button);
    return () => observer.disconnect();
  }, [active, lines, checkActiveVisible]);
  useEffect(() => {
    const play = document.querySelector('.player .play-button');
    if (!play) return;
    const align = () => {
      if (!screen.current) return;
      const bounds = play.getBoundingClientRect();
      setSyncLeft(bounds.left + bounds.width / 2 - screen.current.getBoundingClientRect().left);
    };
    align();
    const observer = new ResizeObserver(align);
    observer.observe(play);
    if (play.parentElement) observer.observe(play.parentElement);
    if (screen.current) observer.observe(screen.current);
    window.addEventListener('resize', align);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', align);
    };
  }, []);

  return (
    <main
      ref={screen}
      id="main-content"
      className="lyrics-screen"
      tabIndex={-1}
      aria-labelledby="lyrics-heading"
      style={
        syncLeft === null ? undefined : ({ '--lyrics-sync-left': `${syncLeft}px` } as CSSProperties)
      }
    >
      <header className="lyrics-heading">
        <span className="lyrics-view-label">
          <Icon name="microphone" size={16} />
          {t('Lời bài hát')}
        </span>
        <div className="lyrics-actions">
          <button
            type="button"
            className="icon-button"
            aria-label={t('Đóng lời bài hát')}
            title={t('Đóng lời bài hát')}
            onClick={closeLyrics}
          >
            <Icon name="close" />
          </button>
        </div>
      </header>
      <div className="lyrics-content">
        <figure className="lyrics-artwork">
          <div className="lyrics-cover">
            <Artwork track={track || undefined} large />
          </div>
          <figcaption className="lyrics-song-info">
            <h1 ref={title} id="lyrics-heading" tabIndex={-1} dir="auto" title={track?.title}>
              {track?.title || t('Lời bài hát')}
            </h1>
            <p dir="auto">{track?.author?.displayName}</p>
          </figcaption>
        </figure>
        {query.isPending ? (
          <div className="lyrics-state" role="status">
            <Icon name="microphone" size={40} />
            <p>{t('Đang tải lời bài hát…')}</p>
          </div>
        ) : query.isError ? (
          <div className="lyrics-state" role="alert">
            <Icon name="microphone" size={40} />
            <h2>{t('Chưa thể tải lời bài hát.')}</h2>
            <button type="button" className="button secondary" onClick={() => void query.refetch()}>
              {t('Thử lại')}
            </button>
          </div>
        ) : !lines?.length ? (
          <div className="lyrics-state">
            <Icon name="microphone" size={44} />
            <h2>{t('Chưa có lời bài hát')}</h2>
            <p>{t('Bài hát này chưa có lời đồng bộ.')}</p>
          </div>
        ) : (
          <>
            <p className="sr-only" id="lyrics-seek-help">
              {t('Bấm vào một dòng để tua đến đoạn đó.')}
            </p>
            <div
              ref={viewport}
              className="lyrics-scroll"
              role="region"
              tabIndex={0}
              aria-label={t('Lời bài hát đồng bộ')}
              aria-describedby="lyrics-seek-help"
              onScroll={onScroll}
              onWheel={() => setFollowing(false)}
              onTouchStart={() => setFollowing(false)}
              onPointerDown={(event) => {
                if (event.target === event.currentTarget) setFollowing(false);
              }}
              onKeyDown={(event) => {
                if (
                  ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)
                )
                  setFollowing(false);
              }}
              onFocusCapture={(event) => {
                const index = event.target.getAttribute('data-lyric-line');
                if (index !== null && Number(index) !== active) setFollowing(false);
              }}
            >
              <div className="lyrics-lines">
                {lines.map((line, index) => (
                  <button
                    type="button"
                    key={line.startMs}
                    ref={(element) => {
                      if (element) lineButtons.current.set(index, element);
                      else lineButtons.current.delete(index);
                    }}
                    data-lyric-line={index}
                    className={
                      'lyric-line ' +
                      (index === active ? 'is-current' : index < active ? 'is-past' : 'is-upcoming')
                    }
                    aria-current={index === active ? 'true' : undefined}
                    aria-label={t('Tua đến {time}: {line}', {
                      time: time(line.startMs / 1000),
                      line: line.text || t('Đang phát nhạc dạo'),
                    })}
                    disabled={pending || !duration || line.startMs > duration * 1000}
                    onClick={() => {
                      seekTo(line.startMs / 1000);
                      setActive(index);
                      setFollowing(true);
                    }}
                  >
                    <span dir="auto">
                      {line.text || (
                        <span className="lyric-instrumental">
                          <Icon name="music" size={32} />
                          <span className="sr-only">{t('Đang phát nhạc dạo')}</span>
                        </span>
                      )}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
      <div className="lyrics-follow-dock">
        {!following && !activeVisible && active >= 0 && !!lines?.length && (
          <button type="button" className="button small lyrics-follow" onClick={resumeFollowing}>
            <Icon name="refresh" size={16} />
            {t('Theo dõi lời bài hát')}
          </button>
        )}
      </div>
    </main>
  );
}
