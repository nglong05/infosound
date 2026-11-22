'use client';
import { createContext, useContext } from 'react';
import type { User } from '@/lib/api';

export type Session = {
  user: User | null;
  loading: boolean;
  reload: () => Promise<void>;
  completeOAuth: () => Promise<boolean>;
  login: (token: string, user: User) => void;
  logout: (all?: boolean) => Promise<void>;
};

export const AuthContext = createContext<Session | null>(null);

export const useAuth = () => {
  const value = useContext(AuthContext);
  if (!value) throw new Error('Auth provider missing');
  return value;
};
