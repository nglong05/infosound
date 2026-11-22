'use client';
import { createContext, useContext, useState, useCallback, useRef, type ReactNode } from 'react';
import { getAccessToken, refreshSession } from '@/lib/api';
import type { Track } from '@/lib/api';

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  tracks?: Track[];
};

export type ConversationSummary = {
  id: string;
  title: string;
  messageCount: number;
  updatedAt: string;
};

type ChatbotView = 'chat' | 'history';

type ChatbotState = {
  isOpen: boolean;
  view: ChatbotView;
  messages: ChatMessage[];
  conversations: ConversationSummary[];
  isLoading: boolean;
  conversationId: string | null;
  openChat: () => void;
  closeChat: () => void;
  sendMessage: (text: string) => Promise<void>;
  clearChat: () => void;
  showHistory: () => Promise<void>;
  showChat: () => void;
  openConversation: (id: string) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
};

const ChatbotContext = createContext<ChatbotState | null>(null);

export const useChatbot = () => {
  const value = useContext(ChatbotContext);
  if (!value) throw new Error('ChatbotProvider missing');
  return value;
};

function chatHeaders() {
  const token = getAccessToken();
  return {
    'Content-Type': 'application/json',
    'X-Requested-With': 'InfoSound',
    'X-InfoSound-CSRF': '1',
    ...(token ? { Authorization: 'Bearer ' + token } : {}),
  };
}

// fetch that transparently retries once after a token refresh on 401.
async function authedFetch(input: string, init: RequestInit) {
  let res = await fetch(input, { ...init, credentials: 'same-origin', headers: chatHeaders() });
  if (res.status === 401 && (await refreshSession())) {
    res = await fetch(input, { ...init, credentials: 'same-origin', headers: chatHeaders() });
  }
  return res;
}

export function ChatbotProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [view, setView] = useState<ChatbotView>('chat');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const openChat = useCallback(() => setIsOpen(true), []);
  const closeChat = useCallback(() => setIsOpen(false), []);
  const showChat = useCallback(() => setView('chat'), []);

  const clearChat = useCallback(() => {
    setMessages([]);
    setConversationId(null);
    setView('chat');
  }, []);

  const showHistory = useCallback(async () => {
    setView('history');
    const res = await authedFetch('/api/v1/chat/conversations', { method: 'GET' });
    if (res.ok) {
      const body = await res.json().catch(() => ({ items: [] }));
      setConversations(body.items ?? []);
    }
  }, []);

  const openConversation = useCallback(async (id: string) => {
    const res = await authedFetch(`/api/v1/chat/conversations/${id}/messages`, { method: 'GET' });
    if (!res.ok) return;
    const body = await res.json().catch(() => ({ items: [] }));
    setMessages(
      (body.items ?? []).map((m: { id: string; role: string; content: string }) => ({
        id: m.id,
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.content,
      })),
    );
    setConversationId(id);
    setView('chat');
  }, []);

  const deleteConversation = useCallback(
    async (id: string) => {
      await authedFetch(`/api/v1/chat/conversations/${id}`, { method: 'DELETE' });
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (id === conversationId) clearChat();
    },
    [conversationId, clearChat],
  );

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isLoading) return;
      setView('chat');

      const userMsg: ChatMessage = { id: crypto.randomUUID(), role: 'user', content: trimmed };
      setMessages((prev) => [...prev, userMsg]);
      setIsLoading(true);

      const assistantId = crypto.randomUUID();
      setMessages((prev) => [...prev, { id: assistantId, role: 'assistant', content: '' }]);

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const doFetch = () =>
          fetch('/api/v1/chat/messages', {
            method: 'POST',
            credentials: 'same-origin',
            signal: controller.signal,
            headers: chatHeaders(),
            body: JSON.stringify({ message: trimmed, conversationId }),
          });

        let response = await doFetch();
        if (response.status === 401 && (await refreshSession())) {
          response = await doFetch();
        }

        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.message || 'Không thể gửi tin nhắn');
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error('Không nhận được phản hồi');

        const decoder = new TextDecoder();
        let accumulated = '';
        let buffer = '';

        while (true) {
          const { done, value: chunk } = await reader.read();
          if (done) break;

          buffer += decoder.decode(chunk, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
              const parsed = JSON.parse(line.slice(6));
              if (parsed.type === 'meta' && parsed.conversationId) {
                setConversationId(parsed.conversationId);
              } else if (parsed.type === 'text' && parsed.text) {
                accumulated += parsed.text;
                setMessages((prev) =>
                  prev.map((m) => (m.id === assistantId ? { ...m, content: accumulated } : m)),
                );
              } else if (parsed.type === 'tracks' && Array.isArray(parsed.tracks)) {
                setMessages((prev) =>
                  prev.map((m) => (m.id === assistantId ? { ...m, tracks: parsed.tracks } : m)),
                );
              } else if (parsed.type === 'error') {
                accumulated = parsed.message || 'Đã có lỗi xảy ra.';
                setMessages((prev) =>
                  prev.map((m) => (m.id === assistantId ? { ...m, content: accumulated } : m)),
                );
              }
            } catch {
              // skip malformed SSE lines
            }
          }
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: m.content || 'Xin lỗi, đã có lỗi xảy ra. Vui lòng thử lại.' }
              : m,
          ),
        );
      } finally {
        setIsLoading(false);
        abortRef.current = null;
      }
    },
    [isLoading, conversationId],
  );

  return (
    <ChatbotContext.Provider
      value={{
        isOpen,
        view,
        messages,
        conversations,
        isLoading,
        conversationId,
        openChat,
        closeChat,
        sendMessage,
        clearChat,
        showHistory,
        showChat,
        openConversation,
        deleteConversation,
      }}
    >
      {children}
    </ChatbotContext.Provider>
  );
}
