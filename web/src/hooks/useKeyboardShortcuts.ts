import { useEffect, useRef } from 'react';

type Handler = (event: KeyboardEvent) => void;

interface Shortcuts {
  /** Single keys, e.g. `{ '/': fn, '?': fn, n: fn }`. */
  keys?: Record<string, Handler>;
  /** Two-key chords, e.g. `{ g: { h: fn, s: fn } }` for "g then h". */
  chords?: Record<string, Record<string, Handler>>;
  /** `⌘`/`Ctrl` combinations, e.g. `{ k: fn }`. */
  meta?: Record<string, Handler>;
}

const CHORD_TIMEOUT_MS = 1200;

/**
 * True when the user is typing, in which case a bare letter is text, not a
 * command. Covers the rich-text editor too, which is a contenteditable div
 * rather than an input.
 */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

export function useKeyboardShortcuts({ keys, chords, meta }: Shortcuts, enabled = true): void {
  // Held in a ref so changing handlers each render does not tear down and
  // rebind the listener, which would drop a chord mid-sequence.
  const config = useRef({ keys, chords, meta });
  config.current = { keys, chords, meta };

  const pendingChord = useRef<{ key: string; at: number } | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (event: KeyboardEvent) => {
      const { keys: single, chords: chordMap, meta: metaMap } = config.current;

      if ((event.metaKey || event.ctrlKey) && metaMap) {
        const handler = metaMap[event.key.toLowerCase()];
        if (handler) {
          event.preventDefault();
          handler(event);
        }
        return;
      }

      // Any other modifier means this is someone else's shortcut.
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;

      const key = event.key;

      const pending = pendingChord.current;
      if (pending && Date.now() - pending.at < CHORD_TIMEOUT_MS) {
        pendingChord.current = null;
        const handler = chordMap?.[pending.key]?.[key.toLowerCase()];
        if (handler) {
          event.preventDefault();
          handler(event);
          return;
        }
        // Not a chord after all — fall through and treat it as a single key.
      }

      if (chordMap?.[key.toLowerCase()]) {
        pendingChord.current = { key: key.toLowerCase(), at: Date.now() };
        return;
      }

      const handler = single?.[key];
      if (handler) {
        event.preventDefault();
        handler(event);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}
