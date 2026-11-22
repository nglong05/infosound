'use client';
import { useChatbot } from './chatbot-context';
import { Icon } from '@/components/icons';

export function ChatbotHistory() {
  const { conversations, openConversation, deleteConversation, conversationId } = useChatbot();

  if (conversations.length === 0) {
    return (
      <div className="chatbot-history-empty">
        <Icon name="music" size={28} />
        <p>Chưa có cuộc trò chuyện nào.</p>
      </div>
    );
  }

  return (
    <div className="chatbot-history">
      {conversations.map((c) => (
        <div
          key={c.id}
          className={'chatbot-history-item' + (c.id === conversationId ? ' is-active' : '')}
        >
          <button
            className="chatbot-history-open"
            type="button"
            onClick={() => void openConversation(c.id)}
          >
            <strong>{c.title || 'Cuộc trò chuyện'}</strong>
            <span>{c.messageCount} tin nhắn</span>
          </button>
          <button
            className="chatbot-history-delete"
            type="button"
            aria-label="Xoá"
            title="Xoá"
            onClick={() => void deleteConversation(c.id)}
          >
            <Icon name="trash" size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
