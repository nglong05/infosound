'use client';
import { useChatbot } from './chatbot-context';

export function ChatbotBubble() {
  const { isOpen, openChat } = useChatbot();
  if (isOpen) return null;
  return (
    <button
      className="chatbot-bubble"
      onClick={openChat}
      aria-label="Mở trò chuyện AI"
      type="button"
    >
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        <path d="M8 10h.01M12 10h.01M16 10h.01" />
      </svg>
    </button>
  );
}
