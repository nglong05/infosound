import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Providers } from '@/components/providers';
import { NavigationMetadata } from '@/components/navigation-metadata';
import { LocaleProvider } from '@/components/locale-provider';
import { ThemeProvider } from '@/components/theme-provider';
import { getThemePreference } from '@/lib/server-theme';
import { getLocaleState } from '@/lib/server-locale';
import { getLanguage } from '@/lib/languages';
import { translate } from '@/lib/i18n';
import './globals.css';
import './oauth.css';
import './music.css';
import './i18n.css';
import './themes.css';
import './theme-selector.css';
import './genre-tags.css';
import './genre-picker.css';
import './player-modes.css';
import './lyrics.css';
import './lyrics-editor.css';
import './lyric-search.css';
import './discovery-catalog.css';
import './music-survey.css';
import './trending-artists.css';
import './track-detail.css';
import './keyboard-shortcuts.css';
import './refinement.css';
import './studio-polish.css';
import './notification-feed.css';
import './playback-queue.css';
import './track-options.css';
import './navigation-actions.css';
import './chatbot.css';
import '@infosound/comment-moderation/styles.css';
export async function generateMetadata(): Promise<Metadata> {
  const { locale, messages } = await getLocaleState();
  return {
    title: {
      default: 'InfoSound — ' + translate(locale, 'Không gian âm nhạc của bạn', {}, messages),
      template: '%s | InfoSound',
    },
    description: translate(
      locale,
      'Lắng nghe âm nhạc độc lập, kết nối nghệ sĩ và lưu những giai điệu yêu thích trên InfoSound.',
      {},
      messages,
    ),
    applicationName: 'InfoSound',
    manifest: '/manifest.webmanifest',
    robots: { index: false, follow: false },
  };
}
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [{ locale, messages }, theme] = await Promise.all([getLocaleState(), getThemePreference()]);
  return (
    <html lang={locale} dir={getLanguage(locale).direction} data-theme={theme}>
      <body>
        <ThemeProvider initialTheme={theme}>
          <LocaleProvider initialLocale={locale} initialMessages={messages}>
            <Suspense
              fallback={
                <div className="initial-loading">
                  {translate(locale, 'Đang mở InfoSound…', {}, messages)}
                </div>
              }
            >
              <NavigationMetadata />
              <Providers>{children}</Providers>
            </Suspense>
          </LocaleProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
