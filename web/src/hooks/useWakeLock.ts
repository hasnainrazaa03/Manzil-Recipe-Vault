import { useEffect, useRef, useState } from 'react';

/**
 * Holds a screen wake lock while active, so a phone propped against a mixing
 * bowl does not sleep between steps.
 *
 * Support is patchy (no Firefox, no iOS before 16.4), and this is a nicety, so
 * every failure is swallowed — the caller gets `false` and cook mode carries on
 * working exactly as before.
 */
export function useWakeLock(active: boolean): boolean {
  const [held, setHeld] = useState(false);
  const lock = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return;

    let cancelled = false;

    const acquire = async () => {
      try {
        const sentinel = await navigator.wakeLock.request('screen');
        if (cancelled) {
          void sentinel.release();
          return;
        }
        lock.current = sentinel;
        setHeld(true);
        sentinel.addEventListener('release', () => setHeld(false));
      } catch {
        setHeld(false);
      }
    };

    void acquire();

    // The browser drops the lock whenever the tab is hidden; reacquire on
    // return, or the lock is silently gone after the first notification.
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible' && !lock.current) void acquire();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      void lock.current?.release().catch(() => {});
      lock.current = null;
      setHeld(false);
    };
  }, [active]);

  return held;
}
