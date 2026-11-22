'use client';
import { useState, type CSSProperties } from 'react';
import type { Track } from '@/lib/api';
import { Icon } from '@/components/icons';
import { useI18n } from '@/components/locale-provider';
import { usePlayer } from './player-context';

export function PlayerArtwork({ track }: { track: Track | null }) {
  const [failed, setFailed] = useState<string | null>(null);
  const src = track?.coverUrl;
  return (
    <div className="mini-art">
      {src && failed !== src ? (
        <img
          crossOrigin="anonymous"
          src={src}
          alt=""
          width={56}
          height={56}
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(src)}
        />
      ) : (
        <Icon name="music" size={24} />
      )}
    </div>
  );
}

export function RecordVisual() {
  const { t } = useI18n();
  const { track, playing, buffering, motionEnabled } = usePlayer();
  const [failed, setFailed] = useState<string | null>(null);
  const cover = track?.coverUrl;
  const hasCover = !!cover && failed !== cover;
  const active = !!track && playing && !buffering;
  return (
    <div
      className="sound-visual"
      data-playing={active ? 'true' : 'false'}
      data-motion={motionEnabled ? 'true' : 'false'}
      role="img"
      aria-label={
        track
          ? t('Đĩa than đang chọn: {title} — {artist}', {
              title: track.title,
              artist: track.author.displayName,
            })
          : t('Đĩa than minh họa InfoSound')
      }
    >
      <div className={'vinyl' + (hasCover ? ' has-cover' : '')} aria-hidden="true">
        {hasCover && (
          <img
            crossOrigin="anonymous"
            className="vinyl-artwork"
            src={cover}
            alt=""
            width={512}
            height={512}
            decoding="async"
            referrerPolicy="no-referrer"
            onError={() => setFailed(cover)}
          />
        )}
        <div className="vinyl-label">{!hasCover && <Icon name="music" size={32} />}</div>
      </div>
      <div className="sound-bars" aria-hidden="true">
        {Array.from({ length: 19 }, (_, index) => (
          <i key={index} style={{ '--bar-index': index } as CSSProperties} />
        ))}
      </div>
      <div className="visual-caption">
        <strong>{track?.title || t('Âm thanh chất lượng.')}</strong>
        <span>{track?.author?.displayName || t('Kết nối thật.')}</span>
      </div>
    </div>
  );
}
