'use client';
import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { pageDescriptionKey, pageTitleKey } from '@/lib/page-metadata';
import { useI18n } from './locale-provider';

/** Keep the same localized metadata as a direct server-rendered visit. */
export function NavigationMetadata() {
  const pathname = usePathname(),
    { t, locale } = useI18n();
  useEffect(() => {
    document.title = t(pageTitleKey(pathname)) + ' | InfoSound';
    document
      .querySelector<HTMLMetaElement>('meta[name="description"]')
      ?.setAttribute('content', t(pageDescriptionKey));
  }, [pathname, t, locale]);
  return null;
}
