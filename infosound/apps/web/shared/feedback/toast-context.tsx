'use client';
import { createContext, useContext } from 'react';

export type Toast = { message: string; kind: 'success' | 'error' };

export const ToastContext = createContext<(message: string, kind?: Toast['kind']) => void>(
  () => {},
);

export const useToast = () => useContext(ToastContext);
