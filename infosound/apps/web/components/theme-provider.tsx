'use client';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { resolveTheme, themeCookie, type ThemeId } from '@/lib/themes';

type ThemeContextValue = { theme: ThemeId; setTheme: (theme: ThemeId) => void };
const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({
  initialTheme,
  children,
}: {
  initialTheme: ThemeId;
  children: ReactNode;
}) {
  const [theme, setSelected] = useState<ThemeId>(initialTheme);
  // A locale router refresh can return HTML rendered before the latest color change.
  // Reassert the current client choice after a server-layout commit as well.
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  });
  const setTheme = useCallback((value: ThemeId) => {
    const next = resolveTheme(value);
    document.documentElement.dataset.theme = next;
    document.cookie = `${themeCookie}=${next}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
    setSelected(next);
  }, []);
  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('Theme provider missing');
  return value;
}
