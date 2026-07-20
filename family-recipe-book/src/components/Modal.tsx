import { useCallback, useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Visually hide the heading while keeping it as the accessible name. */
  hideTitle?: boolean;
  size?: 'default' | 'wide';
}

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A dialog that behaves like one: labelled, focus-trapped, Escape-closable, and
 * it restores focus to whatever opened it. The previous implementation was a
 * bare div with an onClick — unreachable and inescapable by keyboard, and
 * invisible to assistive technology.
 */
export function Modal({ isOpen, onClose, title, children, hideTitle, size = 'default' }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const titleId = useId();

  const trapFocus = useCallback((event: KeyboardEvent) => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    // Deliberately not filtering on `offsetParent`: it is null for any
    // `position: fixed` element, which would silently drop real controls from
    // the trap (and it is null for everything under jsdom). Explicitly hidden
    // elements are what actually need excluding.
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (element) => !element.hasAttribute('hidden') && element.getAttribute('aria-hidden') !== 'true',
    );
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }

    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    const active = document.activeElement;

    if (event.shiftKey && (active === first || active === dialog)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    previouslyFocused.current = document.activeElement as HTMLElement | null;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      } else if (event.key === 'Tab') {
        trapFocus(event);
      }
    };

    document.addEventListener('keydown', onKeyDown, true);

    // Stop the page behind the dialog from scrolling, without the layout shift
    // that removing the scrollbar would otherwise cause.
    const { overflow, paddingRight } = document.body.style;
    const scrollbar = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = 'hidden';
    if (scrollbar > 0) document.body.style.paddingRight = `${scrollbar}px`;

    // Focus the dialog itself so screen readers announce the title first.
    requestAnimationFrame(() => dialogRef.current?.focus());

    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.body.style.overflow = overflow;
      document.body.style.paddingRight = paddingRight;
      previouslyFocused.current?.focus?.();
    };
  }, [isOpen, onClose, trapFocus]);

  if (!isOpen) return null;

  return createPortal(
    <div
      className="modal-overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`modal-content ${size === 'wide' ? 'modal-content--wide' : ''}`}
      >
        <div className="modal-header">
          <h2 id={titleId} className={hideTitle ? 'visually-hidden' : 'modal-title'}>
            {title}
          </h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close dialog">
            <Icon name="close" size={22} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
