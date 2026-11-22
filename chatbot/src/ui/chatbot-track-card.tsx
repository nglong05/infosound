'use client';
import type { Track } from '@/lib/api';
import { usePlayer } from '@/features/player/player-context';
import { Icon } from '@/components/icons';

export function ChatbotTrackCard({ track }: { track: Track }) {
  const player = usePlayer();
  return (
    <button
      className="chatbot-track"
      type="button"
      onClick={() => void player.play(track)}
    >
      <span className="chatbot-track-art">
        {track.coverUrl ? (
          <img crossOrigin="anonymous" src={track.coverUrl} alt="" width={40} height={40} />
        ) : (
          <Icon name="music" size={18} />
        )}
      </span>
      <span className="chatbot-track-info">
        <strong>{track.title}</strong>
        <span>{track.author?.displayName}</span>
      </span>
      <span className="chatbot-track-play">
        <Icon name="play" size={16} />
      </span>
    </button>
  );
}
