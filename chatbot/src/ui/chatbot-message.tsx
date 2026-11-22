'use client';
import { Fragment } from 'react';
import type { ChatMessage } from './chatbot-context';
import { ChatbotTrackCard } from './chatbot-track-card';
import { inlineTokens, markdownBlocks, type InlineToken } from './markdown';
import { usePlayer } from '@/features/player/player-context';
import { Icon } from '@/components/icons';
import type { Track } from '@/lib/api';

function PlayAll({ tracks }: { tracks: Track[] }) {
  const player = usePlayer();
  return (
    <button
      className="chatbot-playall"
      type="button"
      onClick={() => void player.playQueue(tracks[0], tracks)}
    >
      <Icon name="play" size={13} />
      Phát tất cả ({tracks.length})
    </button>
  );
}

function Inline({ text }: { text: string }) {
  return (
    <>
      {inlineTokens(text).map((tok: InlineToken, i) => {
        if (tok.type === 'bold') return <strong key={i}>{tok.value}</strong>;
        if (tok.type === 'italic') return <em key={i}>{tok.value}</em>;
        return <Fragment key={i}>{tok.value}</Fragment>;
      })}
    </>
  );
}

function Markdown({ text }: { text: string }) {
  return (
    <div className="chatbot-md">
      {markdownBlocks(text).map((block, i) => {
        if (block.type === 'space') return <div key={i} className="chatbot-md-space" />;
        if (block.type === 'bullet')
          return (
            <div key={i} className="chatbot-md-li">
              <span aria-hidden="true">•</span>
              <span>
                <Inline text={block.content} />
              </span>
            </div>
          );
        return (
          <div key={i}>
            <Inline text={block.content} />
          </div>
        );
      })}
    </div>
  );
}

export function ChatbotMessageItem({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';
  return (
    <div className={'chatbot-msg ' + (isUser ? 'chatbot-msg-user' : 'chatbot-msg-bot')}>
      {!isUser && (
        <span className="chatbot-avatar" aria-hidden="true">
          AI
        </span>
      )}
      <div className="chatbot-msg-content">
        <div className="chatbot-msg-text">
          {message.content ? (
            isUser ? (
              message.content
            ) : (
              <Markdown text={message.content} />
            )
          ) : (
            <span className="chatbot-typing">...</span>
          )}
        </div>
        {message.tracks && message.tracks.length > 0 && (
          <div className="chatbot-tracks">
            {message.tracks.length >= 2 && <PlayAll tracks={message.tracks} />}
            {message.tracks.map((track) => (
              <ChatbotTrackCard key={track.id} track={track} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
