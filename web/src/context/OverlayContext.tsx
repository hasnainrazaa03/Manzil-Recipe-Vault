import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

interface OverlayContextValue {
  /** How many modal overlays are currently open. */
  count: number;
  open: () => void;
  close: () => void;
}

const OverlayContext = createContext<OverlayContextValue | null>(null);

/**
 * Tracks how many modal overlays are open.
 *
 * The global keyboard shortcuts listen on `window`, and a dialog only
 * intercepts Escape and Tab — so every other key propagated straight through.
 * Pressing `?` for the shortcut list and then `n` opened the recipe editor
 * *behind* the still-open help dialog, leaving two `aria-modal="true"` dialogs
 * stacked; `g h` navigated the page out from under an open confirmation.
 */
export function OverlayProvider({ children }: { children: ReactNode }) {
  const [count, setCount] = useState(0);

  const open = useCallback(() => setCount((current) => current + 1), []);
  const close = useCallback(() => setCount((current) => Math.max(0, current - 1)), []);

  const value = useMemo(() => ({ count, open, close }), [count, open, close]);

  return <OverlayContext.Provider value={value}>{children}</OverlayContext.Provider>;
}

/**
 * Registers an overlay as open for as long as `isOpen` holds. Safe to call
 * outside a provider, so a component using it stays independently testable.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useOverlay(isOpen: boolean): void {
  const context = useContext(OverlayContext);

  useEffect(() => {
    if (!isOpen || !context) return;
    context.open();
    return () => context.close();
    // `open`/`close` are stable; depending on `context` itself would re-run on
    // every count change and double-count.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);
}

/** True when nothing modal is open, so global shortcuts may fire. */
// eslint-disable-next-line react-refresh/only-export-components
export function useNoOverlayOpen(): boolean {
  const context = useContext(OverlayContext);
  return (context?.count ?? 0) === 0;
}
