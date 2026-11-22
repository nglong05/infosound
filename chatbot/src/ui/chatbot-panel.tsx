'use client';
import { useEffect, useRef } from 'react';
import { useChatbot } from './chatbot-context';
import { ChatbotMessageItem } from './chatbot-message';
import { ChatbotInput } from './chatbot-input';
import { ChatbotHistory } from './chatbot-history';
import { Icon } from '@/components/icons';

export function ChatbotPanel() {
  const { isOpen, view, closeChat, messages, clearChat, showHistory, showChat } = useChatbot();
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (view === 'chat' && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, view]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeChat();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, closeChat]);

  if (!isOpen) return null;

  return (
    <div className="chatbot-panel" role="dialog" aria-label="Trò chuyện AI">
      <div className="chatbot-header">
        <div className="chatbot-header-left">
          <span className="chatbot-header-icon" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </span>
          <span className="chatbot-header-title">
            {view === 'history' ? 'Lịch sử trò chuyện' : 'InfoSound AI'}
          </span>
        </div>
        <div className="chatbot-header-actions">
          {view === 'history' ? (
            <button
              className="chatbot-clear"
              type="button"
              onClick={showChat}
              aria-label="Quay lại"
              title="Quay lại"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
          ) : (
            <>
              <button
                className="chatbot-clear"
                type="button"
                onClick={() => void showHistory()}
                aria-label="Lịch sử"
                title="Lịch sử trò chuyện"
              >
                <Icon name="history" size={16} />
              </button>
              <button
                className="chatbot-clear"
                type="button"
                onClick={clearChat}
                aria-label="Cuộc trò chuyện mới"
                title="Cuộc trò chuyện mới"
              >
                <Icon name="plus" size={16} />
              </button>
            </>
          )}
          <button className="chatbot-close" type="button" onClick={closeChat} aria-label="Đóng">
            <Icon name="close" size={16} />
          </button>
        </div>
      </div>

      {view === 'history' ? (
        <div className="chatbot-messages">
          <ChatbotHistory />
        </div>
      ) : (
        <>
          <div className="chatbot-messages" ref={listRef}>
            {messages.length === 0 ? (
              <div className="chatbot-welcome">
                <div className="chatbot-welcome-icon" aria-hidden="true">
                  <Icon name="music" size={28} />
                </div>
                <strong>Xin chào!</strong>
                <p>Hỏi tôi về bài hát, nghệ sĩ, hoặc khám phá âm nhạc trên InfoSound.</p>
                <div className="chatbot-suggestions">
                  <ChatSuggestion text="Bài hát nào đang hot?" />
                  <ChatSuggestion text="Sơn Tùng M-TP có bài gì?" />
                  <ChatSuggestion text="Gợi ý cho tôi nhạc buồn" />
                </div>
              </div>
            ) : (
              messages.map((msg) => <ChatbotMessageItem key={msg.id} message={msg} />)
            )}
          </div>
          <ChatbotInput />
        </>
      )}
    </div>
  );
}

function ChatSuggestion({ text }: { text: string }) {
  const { sendMessage } = useChatbot();
  return (
    <button className="chatbot-suggestion" type="button" onClick={() => void sendMessage(text)}>
      {text}
    </button>
  );
}
