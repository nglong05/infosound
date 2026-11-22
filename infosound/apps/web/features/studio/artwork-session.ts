'use client';
import { useRef, useState } from 'react';
import { api, uploadFile, ApiError } from '@/lib/api';

export type Upload = {
  uploadId: string;
  trackId: string;
  url: string;
  expiresAt: string;
  headers: Record<string, string>;
};

export type ArtworkOperation = { signal?: AbortSignal; isActive?: () => boolean };

export function checkArtworkOperation(operation?: ArtworkOperation) {
  if (operation?.signal?.aborted || operation?.isActive?.() === false)
    throw new DOMException('Aborted', 'AbortError');
}

export function useArtworkSession() {
  const active = useRef<Upload | null>(null);
  const uploaded = useRef(false);
  const [session, setSession] = useState<Upload | null>(null);
  const reset = () => {
    active.current = null;
    uploaded.current = false;
    setSession(null);
  };
  const cancel = async (operation?: ArtworkOperation) => {
    checkArtworkOperation(operation);
    if (active.current)
      await api('/uploads/' + active.current.uploadId, {
        method: 'DELETE',
        signal: operation?.signal,
      });
    checkArtworkOperation(operation);
    reset();
  };
  const upload = async (
    trackId: string,
    file: File,
    progress: (value: number) => void,
    operation?: ArtworkOperation,
  ) => {
    checkArtworkOperation(operation);
    if (active.current && !uploaded.current && Date.now() >= Date.parse(active.current.expiresAt)) {
      try {
        await api('/uploads/' + active.current.uploadId + '/complete', {
          method: 'POST',
          body: {},
          signal: operation?.signal,
        });
        checkArtworkOperation(operation);
        reset();
        return;
      } catch (error) {
        checkArtworkOperation(operation);
        if (
          !(error instanceof ApiError) ||
          !['UPLOAD_MISSING', 'UPLOAD_EXPIRED', 'UPLOAD_CANCELED'].includes(error.code)
        )
          throw error;
        await cancel(operation);
      }
    }
    if (!active.current) {
      const value = await api<Upload>('/tracks/' + trackId + '/artwork/uploads', {
        method: 'POST',
        body: {
          filename: file.name,
          contentType: file.type,
          size: file.size,
          idempotencyKey: crypto.randomUUID(),
        },
        signal: operation?.signal,
      });
      checkArtworkOperation(operation);
      active.current = value;
      setSession(value);
    }
    const current = active.current;
    if (!uploaded.current) {
      await uploadFile(current.url, file, current.headers, progress, 60_000, true);
      checkArtworkOperation(operation);
      uploaded.current = true;
    }
    await api('/uploads/' + current.uploadId + '/complete', {
      method: 'POST',
      body: {},
      signal: operation?.signal,
    });
    checkArtworkOperation(operation);
    reset();
  };
  return { session, upload, cancel };
}
