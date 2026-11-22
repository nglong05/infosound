'use client';
import { useI18n } from '@/components/locale-provider';
import { useEffect, useRef, type ReactNode } from 'react';
import { Icon } from '@/components/icons';

export function StudioLyricsDisclosure({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const disclosure = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const element = disclosure.current;
    if (!element) return;
    const selector = '[role="alert"],.form-error';
    const reveal = () => {
      if (element.querySelector(selector)) element.open = true;
    };
    reveal();
    const observer = new MutationObserver((records) => {
      if (
        records.some(
          (record) =>
            (record.target instanceof Element && !!record.target.closest(selector)) ||
            [...record.addedNodes].some(
              (node) =>
                node instanceof Element &&
                (node.matches(selector) || !!node.querySelector(selector)),
            ),
        )
      )
        reveal();
    });
    observer.observe(element, { subtree: true, childList: true });
    return () => observer.disconnect();
  }, []);
  return (
    <details
      ref={disclosure}
      className="studio-disclosure studio-lyrics-disclosure"
      onInvalidCapture={(event) => {
        event.currentTarget.open = true;
      }}
    >
      <summary>
        <span>{t('Lời bài hát đồng bộ')}</span>
        <Icon name="down" size={18} />
      </summary>
      {children}
    </details>
  );
}
