'use client';
import type { ReactNode } from 'react';
import type { Genre } from '@/lib/api';
import { useI18n } from './locale-provider';

/** Genre values are catalog metadata; only the surrounding interface is translated. */
export function GenreTags({
  genres,
  legacyGenre,
  fallback,
  className = '',
}: {
  genres?: readonly Genre[];
  legacyGenre?: string;
  fallback?: ReactNode;
  className?: string;
}) {
  const { t } = useI18n();
  const entries =
    genres === undefined && legacyGenre?.trim()
      ? [{ id: 'legacy', name: legacyGenre }]
      : genres || [];
  if (!entries.length)
    return fallback ? <span className={'genre-tags-empty ' + className}>{fallback}</span> : null;
  return (
    <span className={'genre-tags ' + className} role="list" aria-label={t('Thể loại')}>
      {entries.map((genre) => (
        <span key={genre.id} className="genre-tag" role="listitem" data-genre-id={genre.id}>
          <bdi dir="auto">{genre.name}</bdi>
        </span>
      ))}
    </span>
  );
}
