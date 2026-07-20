import { useCallback, useEffect, type RefObject } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Keeps Tab inside a dialog and restores focus to whatever opened it.
 *
 * Extracted from `Modal` so `CookMode` can share it. Cook mode declares itself
 * `role="dialog" aria-modal="true"` — which tells assistive technology the rest
 * of the page is inert — while the page behind remains fully tabbable. A
 * sighted keyboard user could tab straight into controls they cannot see.
 */
export function useFocusTrap(
  ref: RefObject<HTMLElement | null>,
  isOpen: boolean,
  { autoFocus = true }: { autoFocus?: boolean } = {},
): void {
  const trap = useCallback(
    (event: KeyboardEvent) => {
      const container = ref.current;
      if (!container) return;

      // Deliberately not filtering on `offsetParent`: it is null for any
      // `position: fixed` element, which would silently drop real controls.
      const focusable = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (element) =>
          !element.hasAttribute('hidden') && element.getAttribute('aria-hidden') !== 'true',
      );

      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }

      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement;

      if (event.shiftKey && (active === first || active === container)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [ref],
  );

  useEffect(() => {
    if (!isOpen) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Tab') trap(event);
    };
    document.addEventListener('keydown', onKeyDown, true);

    if (autoFocus) requestAnimationFrame(() => ref.current?.focus());

    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      previouslyFocused?.focus?.();
    };
  }, [isOpen, autoFocus, trap, ref]);
}
