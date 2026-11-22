'use client';
import { Fragment, useEffect, useId, useRef } from 'react';
import { Icon } from './icons';
import { useI18n } from './locale-provider';
import { lockBodyScroll } from '@/lib/body-scroll-lock';

export type ShortcutHelpRow = {
  id: string;
  label: string;
  keys: readonly string[];
  sequence?: boolean;
};
export type ShortcutHelpGroup = { id: string; items: readonly ShortcutHelpRow[] };
type KeyboardShortcutsProps = {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  groups: readonly ShortcutHelpGroup[];
  charactersEnabled: boolean;
  onCharactersChange: (enabled: boolean) => void;
};
const arrowKeys: Record<string, { symbol: string; label: string }> = {
  ArrowLeft: { symbol: '←', label: 'Mũi tên trái' },
  ArrowRight: { symbol: '→', label: 'Mũi tên phải' },
  ArrowUp: { symbol: '↑', label: 'Mũi tên lên' },
  ArrowDown: { symbol: '↓', label: 'Mũi tên xuống' },
};

function anotherDialogIsOpen(own: HTMLDialogElement | null) {
  return [
    ...document.querySelectorAll<HTMLElement>('dialog[open],[role="dialog"],[role="alertdialog"]'),
  ].some(
    (element) =>
      element !== own && !element.closest('[hidden]') && element.getClientRects().length > 0,
  );
}

/** Static help shares the root shortcut definitions; opening it never touches playback. */
export function KeyboardShortcuts({
  open,
  onOpen,
  onClose,
  groups,
  charactersEnabled,
  onCharactersChange,
}: KeyboardShortcutsProps) {
  const { t: tr } = useI18n();
  const id = useId(),
    dialog = useRef<HTMLDialogElement>(null),
    title = useRef<HTMLHeadingElement>(null),
    trigger = useRef<HTMLButtonElement>(null);
  const closeCallback = useRef(onClose),
    isOpen = useRef(open);
  closeCallback.current = onClose;
  isOpen.current = open;
  useEffect(() => {
    if (!open) return;
    const element = dialog.current;
    if (!element?.isConnected || anotherDialogIsOpen(element)) {
      closeCallback.current();
      return;
    }
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    try {
      if (!element.open) element.showModal();
    } catch {
      closeCallback.current();
      return;
    }
    const unlock = lockBodyScroll();
    title.current?.focus({ preventScroll: true });
    return () => {
      if (element.open) element.close();
      unlock();
      // The prior focus can belong to the still-open lyrics view. Do not move focus into another modal.
      if (anotherDialogIsOpen(element)) return;
      const target =
        previousFocus && previousFocus !== document.body && previousFocus.isConnected
          ? previousFocus
          : trigger.current;
      target?.focus({ preventScroll: true });
    };
  }, [open]);
  return (
    <>
      <button
        ref={trigger}
        type="button"
        id="keyboard-shortcuts-toggle"
        className="keyboard-shortcuts-trigger"
        aria-label={tr('Phím tắt bàn phím')}
        title={tr('Phím tắt bàn phím')}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="keyboard-shortcuts-dialog"
        onClick={() => {
          if (!anotherDialogIsOpen(dialog.current)) onOpen();
        }}
      >
        <Icon name="keyboard" size={22} />
      </button>
      <dialog
        ref={dialog}
        id="keyboard-shortcuts-dialog"
        data-shortcuts-dialog
        className="keyboard-shortcuts-dialog"
        aria-modal="true"
        aria-labelledby={id + '-title'}
        aria-describedby={id + '-description'}
        onCancel={(event) => {
          event.preventDefault();
          closeCallback.current();
        }}
        onClose={() => {
          if (isOpen.current && !dialog.current?.open) closeCallback.current();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') event.stopPropagation();
        }}
        onClick={(event) => {
          if (event.target !== event.currentTarget) return;
          const rect = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom
          )
            closeCallback.current();
        }}
      >
        <header className="keyboard-shortcuts-heading">
          <h2 ref={title} tabIndex={-1} id={id + '-title'}>
            {tr('Phím tắt bàn phím')}
          </h2>
          <button
            type="button"
            className="icon-button keyboard-shortcuts-close"
            aria-label={tr('Đóng phím tắt')}
            onClick={onClose}
          >
            <Icon name="close" size={24} />
          </button>
        </header>
        <div className="keyboard-shortcuts-body">
          <div className="keyboard-shortcuts-grid">
            {groups.map((group) => (
              <dl key={group.id} className="keyboard-shortcut-group">
                {group.items.map((row) => (
                  <div key={row.id} className="keyboard-shortcut-row" data-shortcut-id={row.id}>
                    <dt className="keyboard-shortcut-keys" dir="ltr">
                      {row.keys.map((key, index) => {
                        const arrow = arrowKeys[key];
                        return (
                          <Fragment key={key + '-' + index}>
                            {index > 0 && (
                              <span
                                className={
                                  row.sequence
                                    ? 'keyboard-shortcut-separator is-sequence'
                                    : 'keyboard-shortcut-separator'
                                }
                              >
                                {row.sequence ? tr('rồi') : '+'}
                              </span>
                            )}
                            <kbd
                              aria-label={
                                arrow
                                  ? tr(arrow.label)
                                  : key === 'Space'
                                    ? tr('Phím cách')
                                    : undefined
                              }
                            >
                              {arrow?.symbol ?? (key === 'Space' ? tr('Phím cách') : key)}
                            </kbd>
                          </Fragment>
                        );
                      })}
                    </dt>
                    <dd>{tr(row.label)}</dd>
                  </div>
                ))}
              </dl>
            ))}
          </div>
          <p id={id + '-description'} className="keyboard-shortcuts-note">
            {tr('Phím tắt tạm ngưng khi bạn đang nhập nội dung.')}
          </p>
          <label className="keyboard-shortcuts-option">
            <input
              type="checkbox"
              checked={charactersEnabled}
              onChange={(event) => onCharactersChange(event.target.checked)}
            />
            <span>
              {tr('Bật phím tắt ký tự')}
              <small>{tr('Các phím chữ và số có thể tắt tại đây.')}</small>
            </span>
          </label>
        </div>
      </dialog>
    </>
  );
}
