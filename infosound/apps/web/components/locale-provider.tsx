'use client';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  formatDateTime,
  isMessages,
  localeCookie,
  resolveLocale,
  translate,
  type Locale,
  type Messages,
} from '@/lib/i18n';
import { getLanguage } from '@/lib/languages';
import { catalogVersion } from '@/lib/catalog-version';

type LocaleContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => Promise<void>;
  pending: boolean;
  error: string;
  t: (source: string, values?: Record<string, string | number>) => string;
  formatDateTime: (value: string) => string;
};
const LocaleContext = createContext<LocaleContextValue | null>(null);
export function LocaleProvider({
  initialLocale,
  initialMessages,
  children,
}: {
  initialLocale: Locale;
  initialMessages?: Messages;
  children: ReactNode;
}) {
  const [{ locale, messages }, updateLocale] = useState({
    locale: initialLocale,
    messages: initialMessages,
  });
  const [pending, setPending] = useState(false),
    [error, setError] = useState('');
  const request = useRef(0),
    controller = useRef<AbortController | null>(null);
  const loaded = useRef(
    new Map<Locale, Messages>(initialMessages ? [[initialLocale, initialMessages]] : []),
  );
  const setLocale = useCallback(async (value: Locale) => {
    const next = resolveLocale(value),
      id = ++request.current;
    controller.current?.abort();
    const active = new AbortController();
    controller.current = active;
    const timeout = setTimeout(() => active.abort(), 15000);
    setPending(true);
    setError('');
    try {
      let catalog = loaded.current.get(next);
      if (next !== 'vi' && next !== 'en' && !catalog) {
        const response = await fetch(
          '/locales/' + encodeURIComponent(next) + '.json?v=' + catalogVersion,
          { signal: active.signal, credentials: 'same-origin', cache: 'no-cache' },
        );
        if (!response.ok) throw new Error('Catalog unavailable');
        const value: unknown = await response.json();
        if (!isMessages(value)) throw new Error('Catalog invalid');
        catalog = value;
        loaded.current.set(next, value);
        if (loaded.current.size > 8) loaded.current.delete(loaded.current.keys().next().value!);
      }
      if (id !== request.current) throw new DOMException('Superseded', 'AbortError');
      document.cookie =
        localeCookie +
        '=' +
        next +
        '; Path=/; Max-Age=31536000; SameSite=Lax' +
        (location.protocol === 'https:' ? '; Secure' : '');
      document.documentElement.lang = next;
      document.documentElement.dir = getLanguage(next).direction;
      updateLocale({ locale: next, messages: catalog });
    } catch (reason) {
      if (id === request.current && !active.signal.aborted)
        setError('Không thể đổi ngôn ngữ. Vui lòng thử lại.');
      throw reason;
    } finally {
      clearTimeout(timeout);
      if (id === request.current) setPending(false);
    }
  }, []);
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = getLanguage(locale).direction;
  }, [locale]);
  useEffect(
    () => () => {
      request.current++;
      controller.current?.abort();
    },
    [],
  );
  const context = useMemo(
    () => ({
      locale,
      setLocale,
      pending,
      error,
      t: (source: string, values?: Record<string, string | number>) =>
        translate(locale, source, values, messages),
      formatDateTime: (value: string) => formatDateTime(locale, value),
    }),
    [locale, messages, setLocale, pending, error],
  );
  return <LocaleContext.Provider value={context}>{children}</LocaleContext.Provider>;
}
export function useI18n() {
  const context = useContext(LocaleContext);
  if (!context) throw new Error('Locale provider missing');
  return context;
}
