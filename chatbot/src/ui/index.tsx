'use client';
import { useAuth } from '@/features/auth/auth-context';
import { ChatbotProvider } from './chatbot-context';
import { ChatbotBubble } from './chatbot-bubble';
import { ChatbotPanel } from './chatbot-panel';

export function Chatbot() {
  const { user } = useAuth();
  if (!user) return null;
  return (
    <ChatbotProvider>
      <ChatbotBubble />
      <ChatbotPanel />
    </ChatbotProvider>
  );
}
