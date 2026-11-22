import { cookies } from 'next/headers';
import { cache } from 'react';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { localeCookie, resolveLocale, isMessages, type Locale, type Messages } from './i18n';
export async function getLocale() {
  return resolveLocale((await cookies()).get(localeCookie)?.value);
}
const readMessages = cache(async (locale: Locale): Promise<Messages | undefined> => {
  if (locale === 'vi' || locale === 'en') return undefined;
  const value: unknown = JSON.parse(
    await readFile(join(process.cwd(), 'public', 'locales', locale + '.json'), 'utf8'),
  );
  if (!isMessages(value)) throw new Error('Invalid language catalog');
  return value;
});
export const getLocaleState = cache(async () => {
  const requested = await getLocale();
  try {
    return { locale: requested, messages: await readMessages(requested) };
  } catch {
    return { locale: 'vi' as Locale, messages: undefined };
  }
});
