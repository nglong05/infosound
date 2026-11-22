'use client';
import { useState, useRef, useEffect } from 'react';
import { useChatbot } from './chatbot-context';

export function ChatbotInput() {
  const { sendMessage, isLoading } = useChatbot();
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = () => {
    if (!text.trim() || isLoading) return;
    void sendMessage(text);
    setText('');
  };

  return (
    <div className="chatbot-input-bar">
      <textarea
        ref={inputRef}
        className="chatbot-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder="Hỏi về bài hát, nghệ sĩ..."
        rows={1}
        disabled={isLoading}
        maxLength={500}
      />
      <button
        className="chatbot-send"
        type="button"
        onClick={submit}
        disabled={isLoading || !text.trim()}
        aria-label="Gửi"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m5 12 14-7-4 7 4 7z" />
        </svg>
      </button>
    </div>
  );
}
