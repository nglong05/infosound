import { authEnglish } from './translations/auth';
import { screensEnglish } from './translations/screens';
import { studioEnglish } from './translations/studio';
import { shellEnglish } from './translations/shell';
import { globalLabels } from './translations/global-labels';
import { themeEnglish } from './translations/themes';
import { genresEnglish } from './translations/genres';
import { lyricsEnglish } from './translations/lyrics';
import { discoveryEnglish } from './translations/discovery';
import { recommendationsEnglish } from './translations/recommendations';
import { historyEnglish } from './translations/history';
import { surveyEnglish } from './translations/survey';
import { trackDetailEnglish } from './translations/track-detail';
import { shortcutsEnglish } from './translations/shortcuts';
import { queueEnglish } from './translations/queue';
import { getLanguage, type Locale } from './languages';
export { languages, resolveLocale, localeCookie, type Locale } from './languages';
export type Messages = Readonly<Record<string, string>>;
export const english: Readonly<Record<string, string>> = {
  ...shellEnglish,
  ...authEnglish,
  ...screensEnglish,
  ...studioEnglish,
  ...globalLabels,
  ...themeEnglish,
  ...genresEnglish,
  ...lyricsEnglish,
  ...discoveryEnglish,
  ...recommendationsEnglish,
  ...historyEnglish,
  ...surveyEnglish,
  ...trackDetailEnglish,
  ...shortcutsEnglish,
  ...queueEnglish,
};
const placeholders = (message: string) =>
  [...message.matchAll(/\{(\w+)\}/g)]
    .map((match) => match[1])
    .sort()
    .join(',');
export function isMessages(value: unknown): value is Messages {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entries = value as Record<string, unknown>;
  return (
    Object.keys(entries).length === Object.keys(english).length &&
    Object.entries(english).every(
      ([key, source]) =>
        Object.hasOwn(entries, key) &&
        typeof entries[key] === 'string' &&
        entries[key].length > 0 &&
        entries[key].length < 10000 &&
        !(entries[key].includes('\n') && !source.includes('\n')) &&
        !/\[\s*\d{2,5}/.test(entries[key]) &&
        placeholders(entries[key]) === placeholders(source),
    )
  );
}
function buildIndex(messages: Messages) {
  const reverse = new Map(Object.entries(messages).map(([key, message]) => [message, key]));
  const templates = Object.entries(messages)
    .flatMap(([key, message]) => (/\{\w+\}/.test(message) ? [{ key, message }] : []))
    .map(({ key, message }) => {
      const names: string[] = [];
      const escaped = message
        .split(/(\{\w+\})/g)
        .map((part) => {
          if (/^\{\w+\}$/.test(part)) {
            const name = part.slice(1, -1);
            names.push(name);
            return ['seconds', 'minutes', 'count'].includes(name) ? '(\\d+)' : '(.+?)';
          }
          return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        })
        .join('');
      return { key, names, pattern: new RegExp('^' + escaped + '$', 'u') };
    });
  return { reverse, templates };
}
const baseIndex = buildIndex(english);
const sourceIndex = buildIndex(Object.fromEntries(Object.keys(english).map((key) => [key, key])));
const indexes = new WeakMap<Messages, ReturnType<typeof buildIndex>>();
const recentIndexes: ReturnType<typeof buildIndex>[] = [];
function remember(messages: Messages) {
  let index = indexes.get(messages);
  if (!index) {
    index = buildIndex(messages);
    indexes.set(messages, index);
  }
  const previous = recentIndexes.indexOf(index);
  if (previous >= 0) recentIndexes.splice(previous, 1);
  recentIndexes.unshift(index);
  if (recentIndexes.length > 8) recentIndexes.pop();
  return index;
}
export function translate(
  locale: Locale,
  source: string,
  values: Record<string, string | number> = {},
  messages?: Messages,
): string {
  const current = messages ? remember(messages) : undefined;
  const candidates = [
    baseIndex,
    sourceIndex,
    ...(current ? [current] : []),
    ...recentIndexes.filter((index) => index !== current),
  ];
  let key = Object.hasOwn(english, source) ? source : undefined;
  if (key === undefined)
    for (const index of candidates) {
      key = index.reverse.get(source);
      if (key !== undefined) break;
    }
  if (key === undefined) {
    outer: for (const index of candidates)
      for (const template of index.templates) {
        const match = template.pattern.exec(source);
        if (match) {
          key = template.key;
          values = {
            ...Object.fromEntries(template.names.map((name, index) => [name, match[index + 1]])),
            ...values,
          };
          break outer;
        }
      }
  }
  key ??= source;
  const message =
    locale === 'vi'
      ? key
      : messages && Object.hasOwn(messages, key)
        ? messages[key]
        : Object.hasOwn(english, key)
          ? english[key]
          : source;
  return message.replace(/\{(\w+)\}/g, (match, key: string) =>
    Object.hasOwn(values, key) ? String(values[key]) : match,
  );
}
export function formatDateTime(locale: Locale, value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '—';
  const language = getLanguage(locale);
  const tag = Intl.DateTimeFormat.supportedLocalesOf([language.tag]).length
    ? language.tag
    : 'en-US';
  return new Intl.DateTimeFormat(tag, {
    timeZone: language.timeZone,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  }).format(date);
}
