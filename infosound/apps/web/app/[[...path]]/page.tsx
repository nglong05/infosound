import { Suspense } from 'react';
import type { Metadata } from 'next';
import { Screen } from '@/components/screens';
import { getLocaleState } from '@/lib/server-locale';
import { translate } from '@/lib/i18n';
import { pageTitleKey } from '@/lib/page-metadata';
export const dynamic = 'force-dynamic';
export async function generateMetadata({
  params,
}: {
  params: Promise<{ path?: string[] }>;
}): Promise<Metadata> {
  const { path } = await params;
  const { locale, messages } = await getLocaleState();
  return { title: translate(locale, pageTitleKey('/' + (path ?? []).join('/')), {}, messages) };
}
export default async function Page() {
  const { locale, messages } = await getLocaleState();
  return (
    <Suspense
      fallback={<p role="status">{translate(locale, 'Đang tải InfoSound…', {}, messages)}</p>}
    >
      <Screen />
    </Suspense>
  );
}
